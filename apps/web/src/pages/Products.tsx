/**
 * Products & Inventory — handoff screen 08.
 *
 * **One catalogue, four tabs.** Products, Services, Packages and Gift cards are the
 * tabs handoff screen 08 draws, and all four are here. The last two were held back
 * until the phase that needed them, because an empty tab reads to a salon as "this
 * salon has none" — a different and wrong statement (`PROJECT.md#design-6`
 * checklist). They are **add-on modules**, so a salon that has not bought one gets a
 * 403 `MODULE_NOT_ENTITLED` from the API and the tab says so, rather than showing a
 * list that is empty for a reason the screen cannot see. There is no Services entry
 * on the rail for the same reason the tab exists (ADR 0005).
 *
 * **The Cost column and the "Inventory value" tile are absent.** Neither the schema
 * nor the legacy database the schema was derived from ever held a cost, so both
 * numbers would be invented — the checklist's rule again: the screen changes where
 * it disagrees with the real model, and a fabricated figure is worse than a missing
 * one. They return when there is a cost to show.
 *
 * **Every tile is a server-side count, not a sum over the rows on screen.** The
 * salon's whole catalogue is the question and one page of it is not the answer
 * (ADR 0010), which is why the tiles call `?lowStock=true` with `pageSize=1` rather
 * than counting what happens to be loaded. They sit above the tab row exactly as
 * drawn, because they describe the shelf rather than the table below: switching to
 * Services does not change how many products are low on stock. As the handoff draws
 * them, they are informative — not filters.
 *
 * The search box matches the name **or the description**, which is the API's rule
 * for `?search=` (`catalogueWhere`), so one box serves both tabs.
 */
import { useEffect, useState } from "react";

import type {
  CatalogStatusValue,
  GiftCardDetail,
  GiftCardSummary,
  PackageDetail,
  PackageSummary,
  ProductDetail,
  ProductSummary,
  ServiceDetail,
  ServiceSummary,
} from "@glampro_suite/shared";

import GiftCardFormDrawer from "@/components/catalogue/GiftCardFormDrawer";
import PackageFormDrawer from "@/components/catalogue/PackageFormDrawer";
import ProductFormDrawer from "@/components/catalogue/ProductFormDrawer";
import ServiceFormDrawer from "@/components/catalogue/ServiceFormDrawer";
import { AlertTriangle, Gift, Grid, Package, Scissors, Search } from "@/components/icons";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import Pagination from "@/components/ui/Pagination";
import Skeleton from "@/components/ui/Skeleton";
import StatTile from "@/components/ui/StatTile";
import Table, { type TableColumn } from "@/components/ui/Table";
import Tabs, { type TabItem } from "@/components/ui/Tabs";
import { useAuth } from "@/contexts/AuthContext";
import { useGiftCardList } from "@/hooks/useGiftCards";
import { useModules } from "@/hooks/useSettings";
import { usePackageList } from "@/hooks/usePackages";
import { useProductCount, useProductList } from "@/hooks/useProducts";
import { useServiceCount, useServiceList } from "@/hooks/useServices";
import { get, getErrorCode, getErrorMessage } from "@/lib/api";
import { cn, formatDuration } from "@/lib/utils";
import { useSalonFormatting } from "@/contexts/SalonFormattingContext";

const PAGE_SIZE = 20;

type CatalogueTab = "products" | "services" | "packages" | "gift-cards";

/**
 * What each tab's rows are called, and what to say when there are none.
 *
 * One record rather than a chain of ternaries in the panel: four tabs of copy is
 * past the point where a nested conditional stays readable, and the empty state's
 * sentence is specific to the kind of row it is about.
 */
const NOUNS: Record<
  CatalogueTab,
  {
    noun: string;
    icon: React.ReactNode;
    addLabel: string;
    empty: string;
    /** The add-on's display name, for a tab the salon may not have bought. */
    addOn?: string;
  }
> = {
  products: {
    noun: "product",
    icon: <Package />,
    addLabel: "Add product",
    empty: "Add your first product to start tracking what is on the shelf.",
  },
  services: {
    noun: "service",
    icon: <Scissors />,
    addLabel: "Add service",
    empty: "Add a service so it can be booked and sold.",
  },
  packages: {
    noun: "package",
    icon: <Grid />,
    addLabel: "Add package",
    empty: "Add a bundle of sessions a client can pay for up front.",
    addOn: "Packages",
  },
  "gift-cards": {
    noun: "gift card",
    icon: <Gift />,
    addLabel: "Add gift card",
    empty: "Add a gift card so the salon can sell prepaid value.",
    addOn: "Gift cards",
  },
};

export default function Products() {
  const { formatDate, formatPrice } = useSalonFormatting();
  const { isReadOnly } = useAuth();
  const modules = useModules();

  const [tab, setTab] = useState<CatalogueTab>("products");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [editingProduct, setEditingProduct] = useState<ProductDetail | null>(null);
  const [editingService, setEditingService] = useState<ServiceDetail | null>(null);
  const [editingPackage, setEditingPackage] = useState<PackageDetail | null>(null);
  const [editingGiftCard, setEditingGiftCard] = useState<GiftCardDetail | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Typing should not fire a query per keystroke, but the box must still feel
  // immediate, so the term is debounced rather than submitted.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const products = useProductList({ page, pageSize: PAGE_SIZE, search: search || undefined });
  const services = useServiceList({ page, pageSize: PAGE_SIZE, search: search || undefined });
  const packages = usePackageList({ page, pageSize: PAGE_SIZE, search: search || undefined });
  const giftCards = useGiftCardList({ page, pageSize: PAGE_SIZE, search: search || undefined });

  // Tiles. Each number is a server-side count over the whole catalogue (ADR 0010):
  // "Total items" adds the two catalogue counts together, and the low-stock count is
  // literally the rail badge's own query, so the rail and the tile cannot disagree.
  const productTotal = useProductCount();
  const lowStock = useProductCount({ lowStock: true });
  const outOfStock = useProductCount({ lowStock: true, threshold: 0 });
  const serviceTotal = useServiceCount();

  function openCreate() {
    setEditingProduct(null);
    setEditingService(null);
    setEditingPackage(null);
    setEditingGiftCard(null);
    setDrawerOpen(true);
  }

  async function openEditProduct(product: ProductSummary) {
    // A list row is a summary and the form needs the whole record, so opening the
    // editor is a second read rather than a re-use of the row.
    setEditingProduct(await get<ProductDetail>(`/products/${product.id}`));
    setDrawerOpen(true);
  }

  async function openEditService(service: ServiceSummary) {
    setEditingService(await get<ServiceDetail>(`/services/${service.id}`));
    setDrawerOpen(true);
  }

  async function openEditPackage(bundle: PackageSummary) {
    setEditingPackage(await get<PackageDetail>(`/packages/${bundle.id}`));
    setDrawerOpen(true);
  }

  async function openEditGiftCard(card: GiftCardSummary) {
    setEditingGiftCard(await get<GiftCardDetail>(`/gift-cards/${card.id}`));
    setDrawerOpen(true);
  }

  // Kept in tab order: Item / Price / Member price / Stock / Status, which is the
  // handoff's own row minus the Cost column it draws and the model cannot fill.
  const productColumns: TableColumn<ProductSummary>[] = [
    {
      key: "item",
      header: "Item",
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-bold text-ink">{row.name}</p>
          <p className="truncate text-xs text-ink-muted">{row.departmentName ?? "Unassigned"}</p>
        </div>
      ),
    },
    {
      key: "price",
      header: "Price",
      align: "right",
      cell: (row) => formatPrice(row.nonmemberPrice),
    },
    {
      key: "memberPrice",
      header: "Member price",
      align: "right",
      cell: (row) => formatPrice(row.memberPrice),
    },
    {
      key: "barcode",
      header: "Barcode",
      cell: (row) =>
        row.barcode ? (
          <span className="font-mono text-xs text-ink-body">{row.barcode}</span>
        ) : (
          <span className="text-ink-muted">—</span>
        ),
    },
    { key: "stock", header: "Stock", align: "right", cell: (row) => <StockCell product={row} /> },
    { key: "status", header: "Status", cell: (row) => <StatusCell status={row.status} /> },
    // A suspended salon may look but not change (TENANCY.md §6), so the shell's
    // banner is not the only place that has to say so.
    ...(isReadOnly
      ? []
      : [
          {
            key: "actions",
            header: "Edit",
            align: "right" as const,
            cell: (row: ProductSummary) => (
              <Button variant="secondary" size="sm" onClick={() => void openEditProduct(row)}>
                Edit
              </Button>
            ),
          },
        ]),
  ];

  // The services row is the handoff's service shape: the same prices, a duration a
  // product has no use for, and no stock column because a service is not stock.
  const serviceColumns: TableColumn<ServiceSummary>[] = [
    {
      key: "item",
      header: "Item",
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-bold text-ink">{row.name}</p>
          <p className="truncate text-xs text-ink-muted">{row.departmentName ?? "Unassigned"}</p>
        </div>
      ),
    },
    {
      key: "price",
      header: "Price",
      align: "right",
      cell: (row) => formatPrice(row.nonmemberPrice),
    },
    {
      key: "memberPrice",
      header: "Member price",
      align: "right",
      cell: (row) => formatPrice(row.memberPrice),
    },
    {
      key: "duration",
      header: "Duration",
      align: "right",
      cell: (row) => formatDuration(row.durationMinutes),
    },
    { key: "status", header: "Status", cell: (row) => <StatusCell status={row.status} /> },
    ...(isReadOnly
      ? []
      : [
          {
            key: "actions",
            header: "Edit",
            align: "right" as const,
            cell: (row: ServiceSummary) => (
              <Button variant="secondary" size="sm" onClick={() => void openEditService(row)}>
                Edit
              </Button>
            ),
          },
        ]),
  ];

  /**
   * A bundle row: what it holds and what it may be spent on. There is no stock
   * column and no branch, because a package has neither — and no loyalty points,
   * which the model does not carry for a bundle either.
   */
  const packageColumns: TableColumn<PackageSummary>[] = [
    {
      key: "item",
      header: "Item",
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-bold text-ink">{row.name}</p>
          <p className="truncate text-xs text-ink-muted">{row.description ?? "No description"}</p>
        </div>
      ),
    },
    { key: "sessions", header: "Sessions", align: "right", cell: (row) => row.sessionCount },
    {
      key: "price",
      header: "Price",
      align: "right",
      cell: (row) => formatPrice(row.nonmemberPrice),
    },
    {
      key: "memberPrice",
      header: "Member price",
      align: "right",
      cell: (row) => formatPrice(row.memberPrice),
    },
    {
      key: "services",
      header: "Covers",
      align: "right",
      cell: (row) =>
        row.serviceCount === 0
          ? "Any service"
          : `${row.serviceCount} ${row.serviceCount === 1 ? "service" : "services"}`,
    },
    { key: "status", header: "Status", cell: (row) => <StatusCell status={row.status} /> },
    ...(isReadOnly
      ? []
      : [
          {
            key: "actions",
            header: "Edit",
            align: "right" as const,
            cell: (row: PackageSummary) => (
              <Button variant="secondary" size="sm" onClick={() => void openEditPackage(row)}>
                Edit
              </Button>
            ),
          },
        ]),
  ];

  /**
   * A gift-card row.
   *
   * **There is no Status column**, and that is a decision rather than an oversight:
   * the handoff draws one for this tab and `GiftCard` has no status column, so a
   * badge here would be an invented state. The same rule keeps the Cost column off
   * the Products tab and the Shifts column off screen 09, and
   * `catalogue.test.ts` asserts the field is absent so a later "fix" cannot add one
   * back.
   */
  const giftCardColumns: TableColumn<GiftCardSummary>[] = [
    {
      key: "item",
      header: "Item",
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-bold text-ink">{row.name}</p>
          <p className="truncate text-xs text-ink-muted">{row.remark ?? "No remark"}</p>
        </div>
      ),
    },
    { key: "value", header: "Value", align: "right", cell: (row) => formatPrice(row.value) },
    {
      key: "expires",
      header: "Expires",
      align: "right",
      // "Never" rather than a dash: no expiry is a product decision, not missing data.
      cell: (row) => (row.expiresAt === null ? "Never" : formatDate(row.expiresAt)),
    },
    ...(isReadOnly
      ? []
      : [
          {
            key: "actions",
            header: "Edit",
            align: "right" as const,
            cell: (row: GiftCardSummary) => (
              <Button variant="secondary" size="sm" onClick={() => void openEditGiftCard(row)}>
                Edit
              </Button>
            ),
          },
        ]),
  ];

  // Each panel renders only while its tab is the active one, so the four lists are
  // never asked for at once and each panel is handed its own tab's state.
  const tabs: TabItem[] = [
    {
      id: "products",
      label: "Products",
      content: (
        <CataloguePanel<ProductSummary>
          tab="products"
          caption="Products in this salon"
          columns={productColumns}
          rows={products.data?.data ?? []}
          search={search}
          isReadOnly={isReadOnly}
          isPending={products.isPending}
          isFetching={products.isFetching}
          isError={products.isError}
          error={products.error}
          total={products.data?.total ?? 0}
          page={products.data?.page ?? page}
          pageCount={products.data?.pageCount ?? 1}
          onAdd={openCreate}
          onPageChange={setPage}
          onClearSearch={() => setSearchInput("")}
        />
      ),
    },
    {
      id: "services",
      label: "Services",
      content: (
        <CataloguePanel<ServiceSummary>
          tab="services"
          caption="Services in this salon"
          columns={serviceColumns}
          rows={services.data?.data ?? []}
          search={search}
          isReadOnly={isReadOnly}
          isPending={services.isPending}
          isFetching={services.isFetching}
          isError={services.isError}
          error={services.error}
          total={services.data?.total ?? 0}
          page={services.data?.page ?? page}
          pageCount={services.data?.pageCount ?? 1}
          onAdd={openCreate}
          onPageChange={setPage}
          onClearSearch={() => setSearchInput("")}
        />
      ),
    },
    {
      id: "packages",
      label: "Packages",
      content: (
        <CataloguePanel<PackageSummary>
          tab="packages"
          caption="Packages in this salon"
          columns={packageColumns}
          rows={packages.data?.data ?? []}
          search={search}
          isReadOnly={isReadOnly}
          isPending={packages.isPending}
          isFetching={packages.isFetching}
          isError={packages.isError}
          error={packages.error}
          total={packages.data?.total ?? 0}
          page={packages.data?.page ?? page}
          pageCount={packages.data?.pageCount ?? 1}
          onAdd={openCreate}
          onPageChange={setPage}
          onClearSearch={() => setSearchInput("")}
        />
      ),
    },
    {
      id: "gift-cards",
      label: "Gift cards",
      content: (
        <CataloguePanel<GiftCardSummary>
          tab="gift-cards"
          caption="Gift cards in this salon"
          columns={giftCardColumns}
          rows={giftCards.data?.data ?? []}
          search={search}
          isReadOnly={isReadOnly}
          isPending={giftCards.isPending}
          isFetching={giftCards.isFetching}
          isError={giftCards.isError}
          error={giftCards.error}
          total={giftCards.data?.total ?? 0}
          page={giftCards.data?.page ?? page}
          pageCount={giftCards.data?.pageCount ?? 1}
          onAdd={openCreate}
          onPageChange={setPage}
          onClearSearch={() => setSearchInput("")}
        />
      ),
    },
  ];

  /** Hide the Add action for an add-on tab this salon has not bought. While the
   * module list is still loading the button stays (we cannot tell yet); once it
   * has loaded, an unentitled add-on's tab still opens — its EmptyState names the
   * add-on — but there is nothing to add until the salon buys it. Read-only
   * (suspended salon) keeps disabling the button rather than removing it. */
  const entitled = new Set(
    (modules.data ?? []).filter((module) => module.entitled).map((module) => module.code),
  );
  const TAB_MODULE: Record<CatalogueTab, string> = {
    products: "catalogue",
    services: "catalogue",
    packages: "packages",
    "gift-cards": "giftCards",
  };
  const moduleEntitled = modules.isPending || entitled.has(TAB_MODULE[tab]);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg text-ink">Products &amp; Inventory</h2>
          <p className="text-sm text-ink-muted">
            Everything the salon sells. Search by name or description.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor="catalogue-search">
            Search items
          </label>
          <div className="relative">
            <Search
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-ink-muted"
            />
            <input
              id="catalogue-search"
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search items…"
              className="h-control w-64 rounded-md border border-line bg-surface pr-3 pl-9 text-sm text-ink transition-colors placeholder:text-ink-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-purple"
            />
          </div>

          {moduleEntitled && (
            <Button onClick={openCreate} disabled={isReadOnly}>
              {NOUNS[tab].addLabel}
            </Button>
          )}
        </div>
      </header>

      {/* Above the tab row, as drawn: these are facts about the shelf rather than
          about the table, so they do not change when the tabs do. */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile
          icon={<Package />}
          value={
            productTotal.data && serviceTotal.data
              ? productTotal.data.total + serviceTotal.data.total
              : undefined
          }
          label="Total items"
        />
        <StatTile
          icon={<AlertTriangle />}
          value={lowStock.data?.total}
          label="Low stock"
          tone="warning"
        />
        <StatTile
          icon={<AlertTriangle />}
          value={outOfStock.data?.total}
          label="Out of stock"
          tone="danger"
        />
      </div>

      <Tabs
        label="Catalogue"
        items={tabs}
        activeId={tab}
        onChange={(id) => {
          setTab(id as CatalogueTab);
          // A page number only means something for the list it belongs to.
          setPage(1);
        }}
      />

      {/* One drawer at a time, chosen by the active tab. The `key` remounting on
          open and on record change is what clears the form — an effect copying props
          into state would render twice on every open, and resetting the record alone
          would leave a stale edit behind on reopen. */}
      {tab === "products" ? (
        <ProductFormDrawer
          key={`product:${editingProduct?.id ?? "new"}:${drawerOpen}`}
          open={drawerOpen}
          product={editingProduct}
          onClose={() => setDrawerOpen(false)}
        />
      ) : tab === "services" ? (
        <ServiceFormDrawer
          key={`service:${editingService?.id ?? "new"}:${drawerOpen}`}
          open={drawerOpen}
          service={editingService}
          onClose={() => setDrawerOpen(false)}
        />
      ) : tab === "packages" ? (
        <PackageFormDrawer
          key={`package:${editingPackage?.id ?? "new"}:${drawerOpen}`}
          open={drawerOpen}
          bundle={editingPackage}
          onClose={() => setDrawerOpen(false)}
        />
      ) : (
        <GiftCardFormDrawer
          key={`gift-card:${editingGiftCard?.id ?? "new"}:${drawerOpen}`}
          open={drawerOpen}
          card={editingGiftCard}
          onClose={() => setDrawerOpen(false)}
        />
      )}
    </div>
  );
}

/**
 * Stock reads as a number, not as a colour: the count is the message and the tint
 * only repeats it. Zero and low are different states — the screen has a tile for
 * each — so they do not share a colour.
 */
function StockCell({ product }: { product: ProductSummary }) {
  const tone =
    product.quantity === 0
      ? "text-danger"
      : product.lowStock
        ? "text-warning"
        : "text-success-text";
  const units = `${product.quantity} ${product.quantity === 1 ? "unit" : "units"}`;

  return <span className={cn("font-bold", tone)}>{units}</span>;
}

/**
 * The handoff draws a toggle switch in this column. A switch is a write, and this
 * table is read-only for a suspended salon (`TENANCY.md` §6), so the state is shown
 * as a badge and changed where every other field is — in the drawer.
 */
function StatusCell({ status }: { status: CatalogStatusValue }) {
  const isActive = status === "ACTIVE";

  return (
    <Badge variant={isActive ? "success" : "neutral"} dot>
      {isActive ? "Active" : "Inactive"}
    </Badge>
  );
}

/**
 * One tab's list: the count line, the table and the pager.
 *
 * Shared by both tabs because that chrome is identical — only the columns, the rows
 * and the noun differ — which keeps the page's own body down to what is specific to
 * screen 08.
 */
interface CataloguePanelProps<T extends { id: string }> {
  /** Which tab this is, for the row's noun, its icon and the empty-state copy. */
  tab: CatalogueTab;
  /** Accessible name for the table and its pager. */
  caption: string;
  columns: TableColumn<T>[];
  rows: T[];
  search: string;
  isReadOnly: boolean;
  isPending: boolean;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
  total: number;
  page: number;
  pageCount: number;
  onAdd: () => void;
  onPageChange: (page: number) => void;
  onClearSearch: () => void;
}

function CataloguePanel<T extends { id: string }>({
  tab,
  caption,
  columns,
  rows,
  search,
  isReadOnly,
  isPending,
  isFetching,
  isError,
  error,
  total,
  page,
  pageCount,
  onAdd,
  onPageChange,
  onClearSearch,
}: CataloguePanelProps<T>) {
  const { noun, icon, addLabel, empty, addOn } = NOUNS[tab];
  const plural = `${noun}s`;
  /**
   * An add-on tab this salon has not bought answers `403 MODULE_NOT_ENTITLED`.
   * "The list could not be loaded" would name the wrong problem — nothing failed —
   * and an empty list would claim the salon has none, which is a different and false
   * statement. The API's own message says which add-on to enable.
   */
  const needsAddOn = getErrorCode(error) === "MODULE_NOT_ENTITLED";

  return (
    <section
      aria-busy={isPending || isFetching}
      aria-label={caption}
      className="rounded-card border border-line bg-surface"
    >
      <div className="flex items-center justify-between border-b border-line-soft px-5 py-3.5">
        <p className="text-sm text-ink-muted">
          {isPending ? `Loading ${plural}…` : `${total} ${total === 1 ? noun : plural}`}
          {search ? ` matching “${search}”` : ""}
        </p>
      </div>

      {isPending ? (
        <div className="flex flex-col gap-3 p-5">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-9" />
          ))}
        </div>
      ) : isError ? (
        <EmptyState
          title={
            needsAddOn
              ? `The ${addOn ?? plural} add-on is not enabled`
              : `The ${plural} list could not be loaded`
          }
          description={getErrorMessage(error)}
          icon={icon}
          // A refusal is not a failure to retry: reloading asks the same question and
          // gets the same answer until the salon buys the module.
          action={
            needsAddOn ? undefined : (
              <Button onClick={() => window.location.reload()}>Try again</Button>
            )
          }
        />
      ) : (
        <>
          <Table
            caption={caption}
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            className="rounded-none border-0"
            empty={
              search ? (
                <EmptyState
                  title={`No ${plural} match that search`}
                  description={`Nothing matches “${search}”. Try a different name.`}
                  icon={<Search />}
                  action={
                    <Button variant="secondary" onClick={onClearSearch}>
                      Clear search
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  title={`No ${plural} yet`}
                  description={empty}
                  icon={icon}
                  action={
                    <Button onClick={onAdd} disabled={isReadOnly}>
                      {addLabel}
                    </Button>
                  }
                />
              )
            }
          />

          <div className="flex items-center justify-between gap-3 border-t border-line-soft px-5 py-3">
            <p className="text-xs text-ink-muted">
              Page {page} of {Math.max(pageCount, 1)}
            </p>
            <Pagination
              page={page}
              pageCount={pageCount}
              onPageChange={onPageChange}
              label={`${caption} pages`}
            />
          </div>
        </>
      )}
    </section>
  );
}
