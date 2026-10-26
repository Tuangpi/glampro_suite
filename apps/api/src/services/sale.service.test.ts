/**
 * The POS item search **and** the sale write, against the real database.
 *
 * The search half (5b.1) asserts three things that can only be shown here rather than in
 * the route test:
 *
 * - **An unentitled kind is omitted, not refused.** The salon's own gift-card row exists
 *   and stays invisible while the add-on is unpaid, and `searchableKinds` says so —
 *   which is what lets the picker draw four tabs instead of five or, worse, five tabs
 *   one of which is always empty.
 * - **A lapsed grant is not a grant.** The same row with `expiresAt` in the past must
 *   behave like no row at all, because that is what `requireModule` does and the two
 *   must not disagree.
 * - **`lowStock` is this salon's judgement.** The two tenants are seeded with the same
 *   quantities and different thresholds, so a hard-coded five would fail here.
 *
 * The write half (5b.2) asserts the rules a browser cannot be trusted with: that the
 * price came from the catalogue, that a replayed idempotency key does not charge twice,
 * that the ledgers are filled, and that nothing crosses a tenant. Two of them are the
 * point of the whole slice:
 *
 * - **An expired gift card is refused by the write but still offered by the search.**
 *   `GiftCard` has no status column, so 5b.1 could not hide it; if the write did not
 *   refuse it either, the two halves of the till would disagree about what is for sale.
 * - **The write refuses an unentitled kind where the search omitted it.** Omission is
 *   right for a tab and wrong for a line: dropping the line would sell a haircut and
 *   lose a shampoo, then report success.
 *
 * Everything is namespaced by tenant, so a leak shows up as a foreign name in the list
 * rather than as a passing count.
 *
 * Skipped with a clear message when `DATABASE_URL` is absent, so `npm run verify` still
 * passes on a machine with no database running.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import {
  CORE_MODULE_CODES,
  DEFAULT_SALE_ITEM_LIMIT,
  MODULE_CODES,
  SALE_ITEM_KINDS,
  type SaleItem,
  type SaleItemKind,
} from "@glampro_suite/shared";

import { SaleLineItemType } from "../../generated/prisma/enums.js";
import { prisma } from "../lib/prisma.js";
import { runAsPlatform, runAsTenant } from "../lib/tenant-context.js";
import { listDirectTips, recordDirectTip, returnDirectTip } from "./direct-tip.service.js";
import { randomUUID } from "node:crypto";
import {
  completeSale,
  createSale,
  getSale,
  previewVoucher,
  refundSale,
  searchSaleItems,
  voidSale,
} from "./sale.service.js";

const databaseUrl = process.env["DATABASE_URL"];

const TENANT_A = "sale-search-a";
const TENANT_B = "sale-search-b";
const TENANT_IDS = [TENANT_A, TENANT_B];

/**
 * No filters — the query contract makes `search` and `kind` optional, and a caller that
 * omits them wants everything the salon can sell.
 */
const NO_FILTERS = {
  search: undefined,
  kind: undefined,
  limit: DEFAULT_SALE_ITEM_LIMIT,
} as const;

/** A name is `Shampoo <tenant>`, so two salons both holding "Shampoo" stay tellable apart. */
function nameOf(tenantId: string, name: string): string {
  return `${name} ${tenantId}`;
}

async function purge(): Promise<void> {
  await runAsPlatform(async () => {
    await prisma.tenantModule.deleteMany({ where: { tenantId: { in: TENANT_IDS } } });
    await prisma.packageService.deleteMany({ where: { tenantId: { in: TENANT_IDS } } });
    await prisma.valuePackageService.deleteMany({ where: { tenantId: { in: TENANT_IDS } } });
    await prisma.package.deleteMany({ where: { tenantId: { in: TENANT_IDS } } });
    await prisma.valuePackage.deleteMany({ where: { tenantId: { in: TENANT_IDS } } });
    await prisma.giftCard.deleteMany({ where: { tenantId: { in: TENANT_IDS } } });
    await prisma.product.deleteMany({ where: { tenantId: { in: TENANT_IDS } } });
    await prisma.service.deleteMany({ where: { tenantId: { in: TENANT_IDS } } });

    // Children first: the sale-ledgers rows hang off the sale, and the sale's own
    // child rows off it, so a partial tree from a failed run still clears.
    await prisma.customerOutstandingPayment.deleteMany({ where: { tenantId: { in: TENANT_IDS } } });
    await prisma.customerOutstanding.deleteMany({ where: { tenantId: { in: TENANT_IDS } } });
    await prisma.customerRedemption.deleteMany({ where: { tenantId: { in: TENANT_IDS } } });
    await prisma.customerPoint.deleteMany({ where: { tenantId: { in: TENANT_IDS } } });
    await prisma.customerPackageHolding.deleteMany({ where: { tenantId: { in: TENANT_IDS } } });
    await prisma.customerValuePackageHolding.deleteMany({
      where: { tenantId: { in: TENANT_IDS } },
    });
    await prisma.customerGiftCardHolding.deleteMany({ where: { tenantId: { in: TENANT_IDS } } });
    await prisma.employeePerformance.deleteMany({ where: { tenantId: { in: TENANT_IDS } } });
    await prisma.employeeCommission.deleteMany({ where: { tenantId: { in: TENANT_IDS } } });
    await prisma.salePayment.deleteMany({ where: { tenantId: { in: TENANT_IDS } } });
    await prisma.saleLine.deleteMany({ where: { tenantId: { in: TENANT_IDS } } });
    await prisma.sale.deleteMany({ where: { tenantId: { in: TENANT_IDS } } });
    await prisma.customer.deleteMany({ where: { tenantId: { in: TENANT_IDS } } });
    await prisma.user.deleteMany({ where: { email: { contains: "@sale-write.test" } } });
    await prisma.tenant.deleteMany({ where: { id: { in: TENANT_IDS } } });
  });
}

/**
 * The module catalogue, upserted the way the real seed and `staff.routes.test.ts` do
 * it — `isCore` derived from the shared constant, so the two cannot disagree.
 *
 * `Module` is platform data, so it is never purged: the other suites read these rows.
 */
async function seedModules(): Promise<void> {
  for (const [index, code] of MODULE_CODES.entries()) {
    const isCore = (CORE_MODULE_CODES as readonly string[]).includes(code);
    await prisma.module.upsert({
      where: { code },
      update: { isCore },
      create: {
        code,
        name: code,
        category: isCore ? "Core" : "Add-on",
        isCore,
        sortOrder: index,
      },
    });
  }
}

/**
 * Two salons with the same catalogue and different low-stock thresholds, and **no
 * add-ons granted**: this search may sell services and products and nothing else until a
 * test pays for something.
 */
async function seed(): Promise<void> {
  await purge();

  await runAsPlatform(async () => {
    await seedModules();

    await prisma.tenant.create({
      data: { id: TENANT_A, name: "Sale Search A", slug: TENANT_A, lowStockThreshold: 2 },
    });
    await prisma.tenant.create({
      data: { id: TENANT_B, name: "Sale Search B", slug: TENANT_B, lowStockThreshold: 50 },
    });

    for (const tenantId of TENANT_IDS) {
      const cut = await prisma.service.create({
        data: {
          tenantId,
          name: nameOf(tenantId, "Cut"),
          memberPrice: "40.00",
          nonmemberPrice: "50.00",
          points: 5,
          durationMinutes: 45,
        },
      });

      // Archived: still on screen 08, no longer on the till.
      await prisma.service.create({
        data: {
          tenantId,
          name: nameOf(tenantId, "Colour"),
          status: "INACTIVE",
          memberPrice: "80.00",
          nonmemberPrice: "95.00",
        },
      });

      // The threshold boundary from both sides: below A's 2 is low, and 50 is low for B
      // because "at or below" includes the threshold itself.
      await prisma.product.create({
        data: {
          tenantId,
          name: nameOf(tenantId, "Shampoo"),
          memberPrice: "12.50",
          nonmemberPrice: "15.00",
          quantity: 3,
          points: 2,
        },
      });
      await prisma.product.create({
        data: {
          tenantId,
          name: nameOf(tenantId, "Serum"),
          memberPrice: "30.00",
          nonmemberPrice: "35.00",
          quantity: 50,
        },
      });
      await prisma.product.create({
        data: {
          tenantId,
          name: nameOf(tenantId, "Retired Cream"),
          status: "INACTIVE",
          memberPrice: "1.00",
          nonmemberPrice: "2.00",
          quantity: 0,
        },
      });

      const bundle = await prisma.package.create({
        data: {
          tenantId,
          name: nameOf(tenantId, "Aloha Bundle"),
          sessionCount: 10,
          memberPrice: "250.00",
          nonmemberPrice: "300.00",
        },
      });
      await prisma.packageService.create({
        data: { tenantId, packageId: bundle.id, serviceId: cut.id },
      });

      const prepaid = await prisma.valuePackage.create({
        data: {
          tenantId,
          name: nameOf(tenantId, "Prepaid Credit"),
          price: "100.00",
          credit: "120.00",
        },
      });
      await prisma.valuePackageService.create({
        data: { tenantId, valuePackageId: prepaid.id, serviceId: cut.id },
      });

      // No expiry: the wire has to keep "never expires" distinct from "expired".
      await prisma.giftCard.create({
        data: { tenantId, name: nameOf(tenantId, "Aloha Card"), value: "150.00" },
      });

      // Expired in the past. The search still shows it (`GiftCard` has no status
      // column), so this is the row that proves the **write** refuses it — the rule
      // `sale.service.ts` says 5b.1 had to leave open.
      await prisma.giftCard.create({
        data: {
          tenantId,
          name: nameOf(tenantId, "Lapsed Card"),
          value: "50.00",
          expiresAt: new Date("2020-01-01T00:00:00Z"),
        },
      });

      // Two staff to attribute lines to, so per-line credit is testable.
      await prisma.user.create({
        data: {
          tenantId,
          email: `staff-${tenantId}@sale-write.test`,
          name: `Staff ${tenantId}`,
          passwordHash: "not-a-real-hash",
        },
      });

      // An ordinary customer and a member. The member carries `memberId`, which is
      // the whole membership rule legacy left behind (free text, no tier table).
      await prisma.customer.create({
        data: { tenantId, name: `Walk In ${tenantId}`, email: `plain-${tenantId}@sale-write.test` },
      });
      await prisma.customer.create({
        data: {
          tenantId,
          name: `Member ${tenantId}`,
          email: `member-${tenantId}@sale-write.test`,
          memberId: "GOLD",
        },
      });
    }
  });
}

/** Grants an add-on outright, which is the state a paid-for module is in. */
async function grant(tenantId: string, code: string, expiresAt: Date | null = null): Promise<void> {
  await runAsPlatform(async () => {
    const module = await prisma.module.findUniqueOrThrow({
      where: { code },
      select: { id: true },
    });

    await prisma.tenantModule.upsert({
      where: { tenantId_moduleId: { tenantId, moduleId: module.id } },
      update: { expiresAt },
      create: { tenantId, moduleId: module.id, expiresAt },
    });
  });
}

/** Removes the row entirely — the state of a salon that never bought it. */
async function revoke(tenantId: string, code: string): Promise<void> {
  await runAsPlatform(async () => {
    const module = await prisma.module.findUniqueOrThrow({
      where: { code },
      select: { id: true },
    });

    await prisma.tenantModule.deleteMany({ where: { tenantId, moduleId: module.id } });
  });
}

/** The item with this name, or a failure that names what *was* returned. */
function itemNamed(items: SaleItem[], name: string): SaleItem {
  const found = items.find((item) => item.name === name);
  if (!found) {
    throw new Error(`no item named "${name}"; got ${items.map((item) => item.name).join(", ")}`);
  }
  return found;
}

/** Narrows to one kind, so a test can read the columns only that kind has. */
function asKind<K extends SaleItemKind>(item: SaleItem, kind: K): Extract<SaleItem, { kind: K }> {
  if (item.kind !== kind) throw new Error(`expected ${kind}, got ${item.kind}`);
  return item as Extract<SaleItem, { kind: K }>;
}

describe(
  "sale.service item search, against the database",
  { skip: databaseUrl ? false : "DATABASE_URL is not set" },
  () => {
    before(seed);
    after(purge);

    it("keeps the five kinds and the cart's discriminator in step", () => {
      // The cart stores `SaleLine.itemType`, so a kind this list knows and the schema
      // does not — or the reverse — is a row the till could search and never save.
      assert.deepEqual([...SALE_ITEM_KINDS], Object.keys(SaleLineItemType));
    });

    it("offers only services and products while no add-on is paid for", async () => {
      await revoke(TENANT_A, "packages");
      await revoke(TENANT_A, "giftCards");

      const result = await runAsTenant(TENANT_A, () => searchSaleItems(NO_FILTERS));

      assert.deepEqual(result.searchableKinds, ["SERVICE", "PRODUCT"]);
      // Sorted by name rather than by kind — Cut, Serum, Shampoo — so the two archived
      // rows ("Colour" and "Retired Cream") are the ones that are absent.
      assert.deepEqual(
        result.items.map((item) => item.name),
        [nameOf(TENANT_A, "Cut"), nameOf(TENANT_A, "Serum"), nameOf(TENANT_A, "Shampoo")],
      );
      assert.deepEqual(
        result.items.map((item) => item.kind),
        ["SERVICE", "PRODUCT", "PRODUCT"],
      );
    });

    it("omits an unentitled kind rather than refusing or emptying the screen", async () => {
      // The salon *has* a card and a bundle; without the add-ons it may not sell them,
      // so the rows stay out and `searchableKinds` is what lets the picker say why.
      const result = await runAsTenant(TENANT_A, () => searchSaleItems(NO_FILTERS));

      assert.equal(
        result.items.some((item) => item.kind === "GIFT_CARD"),
        false,
      );
      assert.equal(
        result.items.some((item) => item.kind === "PACKAGE"),
        false,
      );
    });

    it("adds both bundle kinds at once when the packages add-on is granted", async () => {
      await grant(TENANT_A, "packages");

      const result = await runAsTenant(TENANT_A, () => searchSaleItems(NO_FILTERS));

      assert.deepEqual(result.searchableKinds, ["SERVICE", "PRODUCT", "PACKAGE", "VALUE_PACKAGE"]);

      const bundle = asKind(itemNamed(result.items, nameOf(TENANT_A, "Aloha Bundle")), "PACKAGE");
      assert.equal(bundle.sessionCount, 10);
      assert.equal(bundle.serviceCount, 1, "the relation's length, not a second read");
      assert.equal(bundle.price, "300.00", "the non-member price is what a line starts at");
      assert.equal(bundle.memberPrice, "250.00");

      const prepaid = asKind(
        itemNamed(result.items, nameOf(TENANT_A, "Prepaid Credit")),
        "VALUE_PACKAGE",
      );
      assert.equal(prepaid.price, "100.00", "what the customer pays");
      assert.equal(prepaid.credit, "120.00", "what they receive");
      assert.equal(prepaid.memberPrice, null, "one price, so there is no member price");

      // Still the salon's to see on screen 08, still not the till's.
      assert.equal(
        result.items.some((item) => item.kind === "GIFT_CARD"),
        false,
      );
    });

    it("treats a lapsed grant as no grant, exactly as the route guard does", async () => {
      await grant(TENANT_A, "packages", new Date(Date.now() - 60_000));

      const lapsed = await runAsTenant(TENANT_A, () => searchSaleItems(NO_FILTERS));
      assert.deepEqual(lapsed.searchableKinds, ["SERVICE", "PRODUCT"]);
      assert.equal(
        lapsed.items.some((item) => item.kind === "PACKAGE"),
        false,
      );

      // Restored, so the tests after this one still have a bundle to sell.
      await grant(TENANT_A, "packages");
    });

    it("sells a card template once the gift-cards add-on is granted", async () => {
      await grant(TENANT_A, "giftCards");

      const result = await runAsTenant(TENANT_A, () => searchSaleItems(NO_FILTERS));

      assert.deepEqual(result.searchableKinds, [
        "SERVICE",
        "PRODUCT",
        "PACKAGE",
        "VALUE_PACKAGE",
        "GIFT_CARD",
      ]);

      const card = asKind(itemNamed(result.items, nameOf(TENANT_A, "Aloha Card")), "GIFT_CARD");
      // One money column, so the face value is the price — and `expiresAt: null` has to
      // survive as "never", not as a date somebody guessed.
      assert.equal(card.price, "150.00");
      assert.equal(card.expiresAt, null);
    });

    it("narrows the rows by kind without shrinking the kinds it reports", async () => {
      const onlyProducts = await runAsTenant(TENANT_A, () =>
        searchSaleItems({ ...NO_FILTERS, kind: "PRODUCT" }),
      );

      assert.deepEqual(
        onlyProducts.items.map((item) => item.kind),
        ["PRODUCT", "PRODUCT"],
      );
      // Switching tabs must not watch the salon's capabilities shrink request by
      // request, so the full list comes back with every answer.
      assert.deepEqual(onlyProducts.searchableKinds, [
        "SERVICE",
        "PRODUCT",
        "PACKAGE",
        "VALUE_PACKAGE",
        "GIFT_CARD",
      ]);
    });

    it("answers with nothing for a kind the add-on does not cover, rather than refusing", async () => {
      await revoke(TENANT_A, "giftCards");

      const cards = await runAsTenant(TENANT_A, () =>
        searchSaleItems({ ...NO_FILTERS, kind: "GIFT_CARD" }),
      );

      assert.deepEqual(cards.items, []);
      assert.equal(cards.searchableKinds.includes("GIFT_CARD"), false);

      await grant(TENANT_A, "giftCards");
    });

    it("matches the name loosely and keeps archived rows off the till", async () => {
      const result = await runAsTenant(TENANT_A, () =>
        searchSaleItems({ ...NO_FILTERS, search: "shamP" }),
      );

      assert.deepEqual(
        result.items.map((item) => item.name),
        [nameOf(TENANT_A, "Shampoo")],
      );
      assert.equal(
        result.items.some((item) => item.name === nameOf(TENANT_A, "Retired Cream")),
        false,
      );
    });

    it("resolves exact barcodes beyond the name limit without leaking foreign or inactive products", async () => {
      await runAsTenant(TENANT_A, () =>
        prisma.product.updateMany({
          where: { name: nameOf(TENANT_A, "Shampoo") },
          data: { barcode: "001ABC" },
        }),
      );
      await runAsTenant(TENANT_B, () =>
        prisma.product.updateMany({
          where: { name: nameOf(TENANT_B, "Shampoo") },
          data: { barcode: "FOREIGN" },
        }),
      );
      await runAsTenant(TENANT_A, () =>
        prisma.product.updateMany({
          where: { name: nameOf(TENANT_A, "Retired Cream") },
          data: { barcode: "RETIRED" },
        }),
      );
      const search = (barcode: string) =>
        runAsTenant(TENANT_A, () =>
          searchSaleItems({
            ...NO_FILTERS,
            kind: "PRODUCT",
            search: "no-name-match",
            barcode,
            limit: 1,
          }),
        );
      const result = await search(" 001abc ");
      assert.equal(result.items.length, 1);
      assert.equal(result.items[0]?.name, nameOf(TENANT_A, "Shampoo"));
      for (const code of ["001AB", "FOREIGN", "RETIRED", "UNKNOWN"]) {
        assert.deepEqual((await search(code)).items, []);
      }
    });

    it("caps each kind rather than the list, so one big kind cannot crowd out the rest", async () => {
      const result = await runAsTenant(TENANT_A, () =>
        searchSaleItems({ ...NO_FILTERS, limit: 1 }),
      );

      // One row per searchable kind and nothing else, which a single shared budget could
      // not have guaranteed. Compared sorted, because the list itself is ordered by name
      // rather than by kind.
      assert.deepEqual(
        result.items.map((item) => item.kind).sort(),
        [...result.searchableKinds].sort(),
      );
    });

    it("sorts the merged list by name, so one search twice reads the same", async () => {
      const first = await runAsTenant(TENANT_A, () => searchSaleItems(NO_FILTERS));
      const second = await runAsTenant(TENANT_A, () => searchSaleItems(NO_FILTERS));

      const names = first.items.map((item) => item.name);
      assert.deepEqual(
        names,
        [...names].sort((a, b) => a.localeCompare(b)),
      );
      assert.deepEqual(second.items, first.items);
    });

    it("pages products in the database with a stable order and an accurate last page", async () => {
      const page = (number: number) =>
        runAsTenant(TENANT_A, () =>
          searchSaleItems({ ...NO_FILTERS, kind: "PRODUCT", limit: 1, page: number }),
        );
      const first = await page(1);
      const second = await page(2);
      const beyond = await page(3);
      assert.equal(first.hasMore, true);
      assert.equal(second.hasMore, false);
      assert.deepEqual(
        first.items.map((item) => item.name),
        [nameOf(TENANT_A, "Serum")],
      );
      assert.deepEqual(
        second.items.map((item) => item.name),
        [nameOf(TENANT_A, "Shampoo")],
      );
      assert.deepEqual(beyond.items, []);
      assert.equal(beyond.hasMore, false);
    });

    it("judges low stock against this salon's own threshold", async () => {
      const forA = await runAsTenant(TENANT_A, () =>
        searchSaleItems({ ...NO_FILTERS, kind: "PRODUCT" }),
      );
      const forB = await runAsTenant(TENANT_B, () =>
        searchSaleItems({ ...NO_FILTERS, kind: "PRODUCT" }),
      );

      // Same quantities, different thresholds: A holds 3 as plenty, B counts 50 as low.
      const shampooOfA = asKind(itemNamed(forA.items, nameOf(TENANT_A, "Shampoo")), "PRODUCT");
      const shampooOfB = asKind(itemNamed(forB.items, nameOf(TENANT_B, "Shampoo")), "PRODUCT");
      assert.equal(shampooOfA.lowStock, false);
      assert.equal(shampooOfB.lowStock, true);

      const serumOfB = asKind(itemNamed(forB.items, nameOf(TENANT_B, "Serum")), "PRODUCT");
      assert.equal(serumOfB.quantity, 50);
      assert.equal(serumOfB.lowStock, true, "at the threshold counts as low");
    });

    it("never returns another salon's rows", async () => {
      const result = await runAsTenant(TENANT_A, () => searchSaleItems(NO_FILTERS));

      assert.ok(result.items.length > 0);
      for (const item of result.items) {
        assert.ok(
          item.name.endsWith(TENANT_A),
          `"${item.name}" belongs to the other salon, which this search must not read`,
        );
      }
    });

    it("refuses to run outside a tenant scope, where it would read every salon's grants", async () => {
      await assert.rejects(
        runAsPlatform(() => searchSaleItems(NO_FILTERS)),
        /tenant scope/,
      );
    });
  },
);

/** A catalogue row's id in this salon, by the name the seed gave it. */
async function idOf(tenantId: string, name: string): Promise<string> {
  const rows = await runAsTenant(tenantId, () =>
    prisma.service.findMany({ where: { name }, select: { id: true } }),
  );
  const found = rows[0];
  if (!found) throw new Error(`no service named "${name}"`);
  return found.id;
}

/** One of this salon's customers, preferring the one carrying `memberId`. */
async function customerIdOf(tenantId: string, member: boolean): Promise<string> {
  const rows = await runAsTenant(tenantId, () =>
    prisma.customer.findMany({
      where: member ? { memberId: { not: null } } : { memberId: null },
      select: { id: true },
    }),
  );
  const found = rows[0];
  if (!found) throw new Error(`no ${member ? "member" : "ordinary"} customer for ${tenantId}`);
  return found.id;
}

async function staffIdOf(tenantId: string): Promise<string> {
  const rows = await runAsTenant(tenantId, () =>
    prisma.user.findMany({
      where: { email: `staff-${tenantId}@sale-write.test` },
      select: { id: true },
    }),
  );
  const found = rows[0];
  if (!found) throw new Error(`no staff for ${tenantId}`);
  return found.id;
}

/** A catalogue id by name, for the tables that are not `service`. */
async function productIdOf(tenantId: string, name: string): Promise<string> {
  const rows = await runAsTenant(tenantId, () =>
    prisma.product.findMany({ where: { name }, select: { id: true } }),
  );
  const found = rows[0];
  if (!found) throw new Error(`no product named "${name}"`);
  return found.id;
}

async function packageIdOf(tenantId: string, name: string): Promise<string> {
  const rows = await runAsTenant(tenantId, () =>
    prisma.package.findMany({ where: { name }, select: { id: true } }),
  );
  const found = rows[0];
  if (!found) throw new Error(`no package named "${name}"`);
  return found.id;
}

async function giftCardIdOf(tenantId: string, name: string): Promise<string> {
  const rows = await runAsTenant(tenantId, () =>
    prisma.giftCard.findMany({ where: { name }, select: { id: true } }),
  );
  const found = rows[0];
  if (!found) throw new Error(`no gift card named "${name}"`);
  return found.id;
}

/** The value package a redemption spends credit from (TK2610-0011). */
async function valuePackageIdOf(tenantId: string, name: string): Promise<string> {
  const rows = await runAsTenant(tenantId, () =>
    prisma.valuePackage.findMany({ where: { name }, select: { id: true } }),
  );
  const found = rows[0];
  if (!found) throw new Error(`no value package named "${name}"`);
  return found.id;
}

/** The error's `code`, so a refusal asserts *which* refusal it was. */
function hasCode(code: string) {
  return (error: unknown) =>
    typeof error === "object" && error !== null && "code" in error && error.code === code;
}

describe(
  "sale.service the write, against the database",
  { skip: databaseUrl ? false : "DATABASE_URL is not set" },
  () => {
    before(seed);
    after(purge);

    it("snapshots discounted tax-exclusive service commission once and reverses it on refund", async () => {
      await runAsTenant(TENANT_A, async () => {
        const staffId = await staffIdOf(TENANT_A);
        const itemId = await idOf(TENANT_A, nameOf(TENANT_A, "Cut"));
        const originalTenant = await runAsPlatform(() =>
          prisma.tenant.findUniqueOrThrow({ where: { id: TENANT_A } }),
        );
        await prisma.user.update({ where: { id: staffId }, data: { commissionRate: 12.5 } });
        await runAsPlatform(() =>
          prisma.tenant.update({
            where: { id: TENANT_A },
            data: { gstEnabled: true, gstRegistrationNumber: "M12345678X" },
          }),
        );
        try {
          const input = {
            idempotencyKey: randomUUID(),
            lines: [
              { itemType: "SERVICE" as const, itemId, quantity: 1, staffId, discountPercent: 10 },
            ],
            payments: [{ method: "CASH" as const, amount: 45 }],
          };
          const sale = await createSale(input);
          await createSale(input);
          const rows = await prisma.employeeCommission.findMany({ where: { saleId: sale.id } });
          assert.equal(rows.length, 1);
          assert.equal(rows[0]?.rate.toFixed(2), "12.50");
          assert.equal(rows[0]?.amount.toFixed(2), "5.16");
          await prisma.user.update({ where: { id: staffId }, data: { commissionRate: 50 } });
          assert.equal(
            (
              await prisma.employeeCommission.findFirstOrThrow({ where: { saleId: sale.id } })
            ).amount.toFixed(2),
            "5.16",
          );
          await refundSale(
            sale.id,
            {
              payouts: [{ method: "CASH", amount: 45 }],
              reason: "Commission regression",
              restock: false,
            },
            staffId,
          );
          const refunded = await prisma.employeeCommission.findMany({ where: { saleId: sale.id } });
          assert.equal(refunded.length, 2);
          assert.equal(refunded.find((row) => row.refundAdjustment)?.amount.toFixed(2), "-5.16");
        } finally {
          await prisma.user.update({ where: { id: staffId }, data: { commissionRate: 0 } });
          await runAsPlatform(() =>
            prisma.tenant.update({
              where: { id: TENANT_A },
              data: {
                gstEnabled: originalTenant.gstEnabled,
                gstRegistrationNumber: originalTenant.gstRegistrationNumber,
              },
            }),
          );
        }
      });
    });

    it("retains explicit attribution through hold/resume/completion and rejects foreign credit atomically", async () => {
      const staffId = await staffIdOf(TENANT_A);
      const foreignId = await staffIdOf(TENANT_B);
      const itemId = await idOf(TENANT_A, nameOf(TENANT_A, "Cut"));
      const attribution = {
        sellers: [{ staffId, share: 10000 }],
        performers: [{ staffId, share: 10000 }],
      };
      await runAsTenant(TENANT_A, async () => {
        const held = await createSale({
          idempotencyKey: randomUUID(),
          hold: true,
          lines: [{ itemType: "SERVICE", itemId, quantity: 1, attribution }],
          payments: [],
        });
        assert.deepEqual(held.lines[0]?.attribution, attribution);
        const completed = await completeSale(held.id, {
          lines: [{ itemType: "SERVICE", itemId, quantity: 1, attribution }],
          payments: [{ method: "CASH", amount: 50 }],
        });
        assert.deepEqual(completed.lines[0]?.attribution, attribution);
        assert.equal(completed.lines[0]?.staffId, null);
        assert.equal(await prisma.employeeCommission.count({ where: { saleId: completed.id } }), 0);
        await assert.rejects(
          prisma.saleLine.update({
            where: { id: completed.lines[0]!.id },
            data: { attribution: { sellers: [{ staffId: foreignId, share: 10000 }] } },
          }),
        );
        const count = await prisma.sale.count();
        await assert.rejects(
          createSale({
            idempotencyKey: randomUUID(),
            lines: [
              {
                itemType: "SERVICE",
                itemId,
                quantity: 1,
                attribution: { sellers: [{ staffId: foreignId, share: 10000 }] },
              },
            ],
            payments: [{ method: "CASH", amount: 50 }],
          }),
        );
        assert.equal(await prisma.sale.count(), count);
      });
    });

    it("records direct staff tips once, without changing sale accounting, and preserves return history after void", async () => {
      const actor = await staffIdOf(TENANT_A);
      const foreign = await staffIdOf(TENANT_B);
      await runAsTenant(TENANT_A, async () => {
        const itemId = await idOf(TENANT_A, nameOf(TENANT_A, "Cut"));
        const sale = await createSale({
          staffId: actor,
          lines: [{ itemType: "SERVICE", itemId, quantity: 1 }],
          payments: [{ method: "CASH", amount: 50 }],
        });
        const input = { staffId: actor, amount: 3.25, idempotencyKey: randomUUID() };
        await assert.rejects(
          recordDirectTip(sale.id, { ...input, staffId: foreign }, actor),
          hasCode("TIP_STAFF_NOT_FOUND"),
        );
        const results = await Promise.all([
          recordDirectTip(sale.id, input, actor),
          recordDirectTip(sale.id, input, actor),
        ]);
        assert.equal(results[1]?.items.length, 1);
        assert.deepEqual(
          await getSale(sale.id),
          sale,
          "all sale/tender/GST/loyalty/commission receipt fields remain identical",
        );
        await assert.rejects(
          recordDirectTip(sale.id, { ...input, amount: 4 }, actor),
          hasCode("TIP_RETRY_MISMATCH"),
        );
        await runAsTenant(TENANT_B, async () => {
          await assert.rejects(listDirectTips(sale.id), hasCode("SALE_NOT_FOUND"));
          await assert.rejects(
            returnDirectTip(sale.id, results[0]!.items[0]!.id, "Foreign return", foreign),
            hasCode("TIP_NOT_FOUND"),
          );
        });
        await voidSale(sale.id, { reason: "Separate sale void" }, actor);
        assert.equal((await listDirectTips(sale.id)).items[0]?.returnedAt, null);
        await assert.rejects(
          recordDirectTip(sale.id, { ...input, idempotencyKey: randomUUID() }, actor),
          hasCode("TIP_SALE_NOT_ELIGIBLE"),
        );
        const tipId = results[0]!.items[0]!.id;
        const returned = await returnDirectTip(sale.id, tipId, "Staff returned full tip", actor);
        assert.ok(returned.items[0]?.returnedAt);
        assert.equal(returned.items[0]?.amount, "3.25");
        assert.deepEqual(
          await returnDirectTip(sale.id, tipId, "Retry must not replace reason", actor),
          returned,
        );
      });
    });

    it("prices from the catalogue, not from the request", async () => {
      // The contract has no price field at all, so this can only pass if the server read
      // the catalogue — a hand-posted `unitPrice` is not even accepted.
      const cutId = await idOf(TENANT_A, nameOf(TENANT_A, "Cut"));
      const receipt = await runAsTenant(TENANT_A, () =>
        createSale({
          lines: [{ itemType: "SERVICE", itemId: cutId, quantity: 2 }],
          payments: [{ method: "CASH", amount: 100 }],
        }),
      );

      // 50.00 non-member × 2.
      assert.equal(receipt.totalAmount, "100.00");
      assert.equal(receipt.lines[0]?.unitPrice, "50.00");
      assert.equal(receipt.lines[0]?.lineTotal, "100.00");
      assert.equal(receipt.paymentStatus, "PAID");
    });

    it("previews a voucher without consuming it, and snapshots the discount on completion", async () => {
      await runAsTenant(TENANT_A, async () => {
        const itemId = await idOf(TENANT_A, nameOf(TENANT_A, "Cut"));
        const voucher = await prisma.voucher.create({
          data: {
            tenantId: TENANT_A,
            code: "POS-TEN",
            discountType: "PERCENTAGE",
            value: 10,
            startsAt: new Date(Date.now() - 60_000),
            endsAt: new Date(Date.now() + 3_600_000),
          },
        });
        const lines = [{ itemType: "SERVICE" as const, itemId, quantity: 2 }];
        const preview = await previewVoucher({ voucherCode: voucher.code, lines });
        assert.equal(preview.totalAmount, "90.00");
        assert.equal(preview.discountAmount, "10.00");
        assert.equal(
          (await prisma.voucher.findFirstOrThrow({ where: { id: voucher.id } })).redeemedCount,
          0,
        );
        const sale = await createSale({
          voucherCode: voucher.code,
          customerId: await customerIdOf(TENANT_A, false),
          lines,
          payments: [{ method: "CASH", amount: 90 }],
        });
        assert.equal(sale.voucherCode, voucher.code);
        assert.equal(sale.totalAmount, "90.00");
        assert.equal(sale.pointsEarned, 9, "voucher allocation scales the catalogue points");
        assert.equal(sale.lines[0]?.netLineTotal, "90.00");
        assert.equal(sale.lines[0]?.lineTotal, "100.00");
        assert.equal(
          (await prisma.voucher.findFirstOrThrow({ where: { id: voucher.id } })).redeemedCount,
          1,
        );
        await voidSale(sale.id, { reason: "Voucher test reversal" }, await staffIdOf(TENANT_A));
        assert.equal(
          (await prisma.voucher.findFirstOrThrow({ where: { id: voucher.id } })).redeemedCount,
          0,
        );
      });
    });

    it("refuses mixed discounts in both direct sales and held-sale completion", async () => {
      await runAsTenant(TENANT_A, async () => {
        const itemId = await idOf(TENANT_A, nameOf(TENANT_A, "Cut"));
        const lines = [{ itemType: "SERVICE" as const, itemId, quantity: 1, discountPercent: 10 }];
        const input = {
          lines,
          voucherCode: "POS-TEN",
          payments: [{ method: "CASH" as const, amount: 45 }],
        };
        await assert.rejects(createSale(input), hasCode("VOUCHER_WITH_MANUAL_DISCOUNT"));
        const held = await createSale({ lines, payments: [], hold: true });
        await assert.rejects(completeSale(held.id, input), hasCode("VOUCHER_WITH_MANUAL_DISCOUNT"));
        assert.equal((await getSale(held.id)).status, "HELD");
      });
    });

    it("allows only one sale to consume a campaign's final redemption", async () => {
      await runAsTenant(TENANT_A, async () => {
        const itemId = await idOf(TENANT_A, nameOf(TENANT_A, "Cut"));
        const voucher = await prisma.voucher.create({
          data: {
            tenantId: TENANT_A,
            code: "POS-LAST",
            discountType: "FIXED",
            value: 5,
            maxRedemptions: 1,
            startsAt: new Date(Date.now() - 60_000),
            endsAt: new Date(Date.now() + 3_600_000),
          },
        });
        const input = {
          voucherCode: voucher.code,
          lines: [{ itemType: "SERVICE" as const, itemId, quantity: 1 }],
          payments: [{ method: "CASH" as const, amount: 45 }],
        };
        const attempts = await Promise.allSettled([createSale(input), createSale(input)]);
        assert.equal(attempts.filter((result) => result.status === "fulfilled").length, 1);
        const rejected = attempts.find((result) => result.status === "rejected");
        assert.ok(rejected?.status === "rejected");
        assert.ok(hasCode("VOUCHER_REDEMPTION_LIMIT_REACHED")(rejected.reason));
        assert.equal(
          (await prisma.voucher.findFirstOrThrow({ where: { id: voucher.id } })).redeemedCount,
          1,
        );
        assert.equal(await prisma.voucherRedemption.count({ where: { voucherId: voucher.id } }), 1);
      });
    });

    it("replays concurrent voids once and preserves the first audit and receipt", async () => {
      await runAsTenant(TENANT_A, async () => {
        const customerId = await customerIdOf(TENANT_A, false);
        const actor = await staffIdOf(TENANT_A);
        const product = await prisma.product.create({
          data: {
            tenantId: TENANT_A,
            name: "Void race fixture",
            quantity: 5,
            memberPrice: 10,
            nonmemberPrice: 10,
            points: 3,
          },
        });
        const sale = await createSale({
          customerId,
          staffId: actor,
          lines: [{ itemType: "PRODUCT", itemId: product.id, quantity: 2 }],
          payments: [{ method: "CASH", amount: 20 }],
        });
        const results = await Promise.all([
          voidSale(sale.id, { reason: "First attempt" }, actor),
          voidSale(sale.id, { reason: "Retry attempt" }, actor),
        ]);
        assert.equal(results[0]!.status, "VOID");
        assert.equal(results[1]!.voidReason, results[0]!.voidReason);
        assert.equal(results[1]!.voidedAt, results[0]!.voidedAt);
        assert.equal(results[0]!.receiptNumber, sale.receiptNumber);
        assert.deepEqual(results[0]!.lines, sale.lines);
        assert.deepEqual(results[0]!.payments, sale.payments);
        assert.equal(
          (await prisma.product.findFirstOrThrow({ where: { id: product.id } })).quantity,
          5,
        );
        const points = await prisma.customerPoint.findMany({ where: { saleId: sale.id } });
        assert.equal(points.length, 2);
        assert.equal(
          points.reduce((sum, row) => sum + row.point, 0),
          0,
        );
      });
    });

    it("rolls back void and restocking refund when a sold product was removed", async () => {
      await runAsTenant(TENANT_A, async () => {
        const customerId = await customerIdOf(TENANT_A, false);
        const actor = await staffIdOf(TENANT_A);
        const product = await prisma.product.create({
          data: {
            tenantId: TENANT_A,
            name: "Missing reversal fixture",
            quantity: 5,
            memberPrice: 10,
            nonmemberPrice: 10,
            points: 3,
          },
        });
        const sale = await createSale({
          customerId,
          lines: [{ itemType: "PRODUCT", itemId: product.id, quantity: 1 }],
          payments: [{ method: "CASH", amount: 10 }],
        });
        await prisma.product.delete({ where: { id: product.id } });
        for (const reverse of [
          () => voidSale(sale.id, { reason: "Missing product" }, actor),
          () =>
            refundSale(
              sale.id,
              {
                reason: "Missing product",
                restock: true,
                payouts: [{ method: "CASH", amount: 10 }],
              },
              actor,
            ),
        ]) {
          await assert.rejects(
            reverse,
            (error: unknown) => (error as { code?: string }).code === "REVERSAL_PRODUCT_MISSING",
          );
          const unchanged = await getSale(sale.id);
          assert.equal(unchanged.status, "COMPLETED");
          assert.equal(unchanged.refundedAt, null);
          assert.equal(unchanged.pointsEarned, sale.pointsEarned);
          assert.deepEqual(unchanged.lines, sale.lines);
        }
        const refunded = await refundSale(
          sale.id,
          {
            reason: "Goods not returned",
            restock: false,
            payouts: [{ method: "CASH", amount: 10 }],
          },
          actor,
        );
        assert.equal(refunded.refundRestocked, false);
      });
    });

    it("retains completed/voided receipts when customer, cashier or performer deletion is attempted", async () => {
      await runAsTenant(TENANT_A, async () => {
        const customerId = await customerIdOf(TENANT_A, false);
        const actor = await staffIdOf(TENANT_A);
        const performer = await prisma.user.create({
          data: {
            tenantId: TENANT_A,
            email: "receipt-performer@sale-write.test",
            name: "Receipt performer",
            passwordHash: "test-only",
          },
        });
        const sale = await createSale({
          customerId,
          staffId: actor,
          lines: [
            {
              itemType: "SERVICE",
              itemId: await idOf(TENANT_A, nameOf(TENANT_A, "Cut")),
              quantity: 1,
              staffId: performer.id,
            },
          ],
          payments: [{ method: "CASH", amount: 50 }],
        });
        for (const status of ["COMPLETED", "VOID"]) {
          if (status === "VOID") await voidSale(sale.id, { reason: "Retain audit" }, actor);
          for (const remove of [
            () => prisma.customer.delete({ where: { id: customerId } }),
            () => prisma.user.delete({ where: { id: actor } }),
            () => prisma.user.delete({ where: { id: performer.id } }),
          ])
            await assert.rejects(
              remove,
              (error: unknown) => (error as { code?: string }).code === "P2003",
            );
          const retained = await getSale(sale.id);
          assert.equal(retained.status, status);
          assert.deepEqual(retained.lines, sale.lines);
          assert.deepEqual(retained.payments, sale.payments);
          assert.equal(retained.receiptNumber, sale.receiptNumber);
        }
      });
    });

    it("never consumes a holding while its granting sale is successfully voided", async () => {
      await grant(TENANT_A, "packages");
      await runAsTenant(TENANT_A, async () => {
        const customerId = await customerIdOf(TENANT_A, false);
        const actor = await staffIdOf(TENANT_A);
        const serviceId = await idOf(TENANT_A, nameOf(TENANT_A, "Cut"));
        for (const kind of ["PACKAGE", "VALUE_PACKAGE"] as const) {
          const itemId =
            kind === "PACKAGE"
              ? await packageIdOf(TENANT_A, nameOf(TENANT_A, "Aloha Bundle"))
              : await valuePackageIdOf(TENANT_A, nameOf(TENANT_A, "Prepaid Credit"));
          const issued = await createSale({
            customerId,
            lines: [{ itemType: kind, itemId, quantity: 1 }],
            payments: [{ method: "CASH", amount: 1000 }],
          });
          const holding =
            kind === "PACKAGE"
              ? await prisma.customerPackageHolding.findFirstOrThrow({
                  where: { saleLineId: issued.lines[0]!.id },
                })
              : await prisma.customerValuePackageHolding.findFirstOrThrow({
                  where: { saleLineId: issued.lines[0]!.id },
                });
          const outcomes = await Promise.allSettled([
            voidSale(issued.id, { reason: "Grant reversal race" }, actor),
            createSale({
              customerId,
              lines: [{ itemType: "SERVICE", itemId: serviceId, quantity: 1 }],
              payments: [
                {
                  method: kind === "PACKAGE" ? "PACKAGE" : "PREPAID_CREDIT",
                  holdingId: holding.id,
                  amount: 50,
                },
              ],
            }),
          ]);
          assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
          const current = await getSale(issued.id);
          const remaining =
            kind === "PACKAGE"
              ? await prisma.customerPackageHolding.findFirst({ where: { id: holding.id } })
              : await prisma.customerValuePackageHolding.findFirst({ where: { id: holding.id } });
          assert.equal(current.status === "VOID", remaining === null);
          const redemptions = await prisma.customerRedemption.count({
            where: { holdingId: holding.id, revertedAt: null },
          });
          assert.equal(redemptions, current.status === "VOID" ? 0 : 1);
        }
      });
    });

    it("never records both a void and a refund when they race", async () => {
      await runAsTenant(TENANT_A, async () => {
        const itemId = await idOf(TENANT_A, nameOf(TENANT_A, "Cut"));
        const actor = await staffIdOf(TENANT_A);
        const sale = await createSale({
          lines: [{ itemType: "SERVICE", itemId, quantity: 1 }],
          payments: [{ method: "CASH", amount: 50 }],
        });
        const results = await Promise.allSettled([
          refundSale(
            sale.id,
            { payouts: [{ method: "CASH", amount: 50 }], reason: "Refund race", restock: false },
            actor,
          ),
          voidSale(sale.id, { reason: "Void race" }, actor),
        ]);
        assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
        const current = await getSale(sale.id);
        assert.ok(
          current.status === "VOID" ? current.refundedAt === null : current.refundedAt !== null,
        );
      });
    });

    it("records a refund once under concurrent retries, offsets points and preserves the receipt", async () => {
      await runAsTenant(TENANT_A, async () => {
        const customerId = await customerIdOf(TENANT_A, false);
        const actorId = await staffIdOf(TENANT_A);
        const product = await prisma.product.create({
          data: {
            tenantId: TENANT_A,
            name: "Refund fixture",
            quantity: 4,
            memberPrice: 10,
            nonmemberPrice: 10,
            points: 3,
          },
        });
        const sale = await createSale({
          customerId,
          lines: [{ itemType: "PRODUCT", itemId: product.id, quantity: 2 }],
          payments: [{ method: "CASH", amount: 20 }],
        });
        const results = await Promise.all(
          [1, 2].map(() =>
            refundSale(
              sale.id,
              {
                payouts: [{ method: "CASH", amount: 20 }],
                reason: "Goods returned",
                restock: true,
              },
              actorId,
            ),
          ),
        );
        for (const refunded of results) {
          assert.equal(refunded.status, "COMPLETED");
          assert.equal(refunded.receiptNumber, sale.receiptNumber);
          assert.deepEqual(refunded.payments, sale.payments);
          assert.equal(refunded.refundAmount, "20.00");
          assert.equal(refunded.pointsEarned, 0);
        }
        assert.equal(
          (await prisma.product.findFirstOrThrow({ where: { id: product.id } })).quantity,
          4,
        );
        assert.equal(await prisma.saleRefund.count({ where: { saleId: sale.id } }), 1);
        assert.deepEqual(
          (
            await prisma.customerPoint.findMany({
              where: { saleId: sale.id },
              orderBy: { createdAt: "asc" },
            })
          ).map((row) => row.point),
          [6, -6],
        );
        const retry = await refundSale(
          sale.id,
          {
            payouts: [{ method: "CASH", amount: 20 }],
            reason: "A different reason",
            restock: false,
          },
          actorId,
        );
        assert.equal(retry.refundReason, "Goods returned");
        await assert.rejects(
          voidSale(sale.id, { reason: "Cannot reverse twice" }, actorId),
          hasCode("SALE_ALREADY_REFUNDED"),
        );
        await assert.rejects(
          runAsTenant(TENANT_B, () =>
            refundSale(
              sale.id,
              { payouts: [{ method: "CASH", amount: 20 }], reason: "Foreign sale", restock: false },
              actorId,
            ),
          ),
          hasCode("SALE_NOT_FOUND"),
        );
      });
    });

    it("snapshots per-line discounted points, floors after quantity, and preserves history", async () => {
      await runAsTenant(TENANT_A, async () => {
        const customerId = await customerIdOf(TENANT_A, true);
        const product = await prisma.product.create({
          data: {
            tenantId: TENANT_A,
            name: "L2 points snapshot",
            quantity: 20,
            memberPrice: 10,
            nonmemberPrice: 20,
            points: 5,
          },
        });
        const sale = await createSale({
          customerId,
          lines: [{ itemType: "PRODUCT", itemId: product.id, quantity: 3, discountPercent: 50 }],
          payments: [],
        });
        assert.equal(sale.pointsEarned, 7);
        assert.equal(sale.outstandingAmount, "15.00", "E1 awards points even on debt");
        const line = await prisma.saleLine.findFirstOrThrow({ where: { saleId: sale.id } });
        assert.equal(line.loyaltyBasePoints, 15);
        assert.equal(line.loyaltyOriginalAmount?.toFixed(2), "30.00");
        assert.equal(line.loyaltyNetAmount?.toFixed(2), "15.00");
        assert.equal(line.loyaltyAwardedPoints, 7);
        await prisma.product.update({
          where: { id: product.id },
          data: { points: 100, memberPrice: 30 },
        });
        assert.equal((await getSale(sale.id)).pointsEarned, 7);
        assert.equal(
          (await voidSale(sale.id, { reason: "Snapshot reversal" }, await staffIdOf(TENANT_A)))
            .pointsEarned,
          0,
        );
        const free = await createSale({
          customerId,
          lines: [{ itemType: "PRODUCT", itemId: product.id, quantity: 1, discountPercent: 100 }],
          payments: [],
        });
        assert.equal(free.pointsEarned, 0);
        await prisma.product.update({ where: { id: product.id }, data: { memberPrice: 0 } });
        const zero = await createSale({
          customerId,
          lines: [{ itemType: "PRODUCT", itemId: product.id, quantity: 1 }],
          payments: [],
        });
        assert.equal(zero.pointsEarned, 0);
      });
    });

    it("rejects debt, non-money funding and grants, and validates exact split payouts", async () => {
      await runAsTenant(TENANT_A, async () => {
        const itemId = await idOf(TENANT_A, nameOf(TENANT_A, "Cut"));
        const customerId = await customerIdOf(TENANT_A, false);
        const actor = await staffIdOf(TENANT_A);
        const input = {
          reason: "Returned money",
          restock: false,
          payouts: [{ method: "CASH" as const, amount: 50 }],
        };
        const debt = await createSale({
          customerId,
          lines: [{ itemType: "SERVICE", itemId, quantity: 1 }],
          payments: [{ method: "CASH", amount: 20 }],
        });
        await assert.rejects(refundSale(debt.id, input, actor), hasCode("SALE_NOT_REFUNDABLE"));
        const sale = await createSale({
          lines: [{ itemType: "SERVICE", itemId, quantity: 1 }],
          payments: [{ method: "CARD", amount: 50 }],
        });
        await assert.rejects(
          refundSale(sale.id, { ...input, payouts: [{ method: "CASH", amount: 49.99 }] }, actor),
          hasCode("REFUND_PAYOUT_MISMATCH"),
        );
        assert.equal(await prisma.saleRefund.count({ where: { saleId: sale.id } }), 0);
        await prisma.salePayment.updateMany({
          where: { saleId: sale.id },
          data: { method: "PREPAID_CREDIT" },
        });
        await assert.rejects(refundSale(sale.id, input, actor), hasCode("SALE_NOT_REFUNDABLE"));
        await prisma.salePayment.updateMany({
          where: { saleId: sale.id },
          data: { method: "CARD" },
        });
        await prisma.saleLine.updateMany({
          where: { saleId: sale.id },
          data: { itemType: "GIFT_CARD" },
        });
        await assert.rejects(refundSale(sale.id, input, actor), hasCode("SALE_NOT_REFUNDABLE"));
        await prisma.saleLine.updateMany({
          where: { saleId: sale.id },
          data: { itemType: "SERVICE" },
        });
        const refunded = await refundSale(
          sale.id,
          {
            ...input,
            payouts: [
              { method: "CASH", amount: 20 },
              { method: "CARD", amount: 30 },
            ],
          },
          actor,
        );
        assert.deepEqual(refunded.refundPayouts, [
          { method: "CASH", amount: "20.00" },
          { method: "CARD", amount: "30.00" },
        ]);
      });
    });

    it("appends performance and unpaid commission reversals, flags paid commission, and reports on refund date", async () => {
      await runAsTenant(TENANT_A, async () => {
        const itemId = await idOf(TENANT_A, nameOf(TENANT_A, "Cut"));
        const actor = await staffIdOf(TENANT_A);
        const sale = await createSale({
          lines: [{ itemType: "SERVICE", itemId, quantity: 1, staffId: actor }],
          payments: [{ method: "CASH", amount: 50 }],
        });
        await prisma.sale.update({
          where: { id: sale.id },
          data: { soldAt: new Date("2020-01-01T12:00:00Z") },
        });
        await prisma.employeeCommission.create({
          data: { tenantId: TENANT_A, saleId: sale.id, userId: actor, rate: 10, amount: 5 },
        });
        const paid = await prisma.employeeCommission.create({
          data: {
            tenantId: TENANT_A,
            saleId: sale.id,
            userId: actor,
            rate: 10,
            amount: 5,
            paidAt: new Date(),
          },
        });
        const input = {
          reason: "Money returned",
          restock: false,
          payouts: [{ method: "CASH" as const, amount: 50 }],
        };
        const refund = await refundSale(sale.id, input, actor);
        await refundSale(sale.id, input, actor);
        const performance = await prisma.employeePerformance.findMany({
          where: { saleId: sale.id },
        });
        assert.equal(performance.length, 2);
        assert.equal(
          performance.reduce((sum, row) => sum + Number(row.amount), 0),
          0,
        );
        const commissions = await prisma.employeeCommission.findMany({
          where: { saleId: sale.id },
        });
        assert.equal(commissions.length, 3);
        assert.equal(commissions.find((row) => row.refundAdjustment)?.amount.toFixed(2), "-5.00");
        assert.equal(commissions.find((row) => row.id === paid.id)?.reconciliationRequired, true);
        const { reportOverview, zReport } = await import("./report.service.js");
        const day = refund.refundedAt!.slice(0, 10);
        const report = await reportOverview({
          from: `${day}T00:00:00Z`,
          to: `${day}T23:59:59.999Z`,
          timeZone: "UTC",
        });
        assert.ok(Number(report.totals.refunds) >= 50);
        assert.equal(report.totals.commissionReconciliation, 1);
        assert.ok(report.refundTenders.some((row) => row.method === "CASH"));
        assert.ok(
          report.staffPerformance.some((row) => row.userId === actor && Number(row.revenue) < 0),
        );
        const close = await zReport({ date: day, timeZone: "UTC" });
        assert.equal(close.totals.refunds, report.totals.refunds);
        const historical = await reportOverview({
          from: "2020-01-01T00:00:00Z",
          to: "2020-01-01T23:59:59Z",
          timeZone: "UTC",
        });
        assert.equal(historical.totals.revenue, "50.00");
        assert.equal(historical.totals.refunds, "0.00");
      });
    });

    for (const paymentState of ["unpaid", "paid", "mixed"] as const) {
      it(`void removes unpaid commissions and preserves paid reconciliation (${paymentState})`, async () => {
        await runAsTenant(TENANT_A, async () => {
          const actor = await staffIdOf(TENANT_A);
          const sale = await createSale({
            lines: [
              {
                itemType: "SERVICE",
                itemId: await idOf(TENANT_A, nameOf(TENANT_A, "Cut")),
                quantity: 1,
                staffId: actor,
              },
            ],
            payments: [{ method: "CASH", amount: 50 }],
          });
          await prisma.sale.update({
            where: { id: sale.id },
            data: { soldAt: new Date("2020-01-01T12:00:00Z") },
          });
          if (paymentState !== "paid") {
            await prisma.employeeCommission.create({
              data: { tenantId: TENANT_A, saleId: sale.id, userId: actor, rate: 10, amount: 5 },
            });
          }
          const paid =
            paymentState === "unpaid"
              ? null
              : await prisma.employeeCommission.create({
                  data: {
                    tenantId: TENANT_A,
                    saleId: sale.id,
                    userId: actor,
                    rate: 12.5,
                    amount: 6.25,
                    paidAt: new Date("2020-01-02T12:00:00Z"),
                  },
                });
          const { reportOverview } = await import("./report.service.js");
          const reportInput = {
            from: new Date(Date.now() - 60_000).toISOString(),
            to: new Date(Date.now() + 60_000).toISOString(),
            timeZone: "UTC",
          };
          const before = await reportOverview(reportInput);
          const results = await Promise.all([
            voidSale(sale.id, { reason: "Commission void" }, actor),
            voidSale(sale.id, { reason: "Concurrent retry" }, actor),
          ]);
          assert.equal(results[0]!.status, "VOID");
          assert.equal(results[1]!.voidedAt, results[0]!.voidedAt);
          assert.equal(results[1]!.voidReason, results[0]!.voidReason);
          const commissions = await prisma.employeeCommission.findMany({
            where: { saleId: sale.id },
          });
          assert.deepEqual(
            commissions,
            paid === null ? [] : [{ ...paid, reconciliationRequired: true }],
          );
          await voidSale(sale.id, { reason: "Later retry" }, actor);
          assert.deepEqual(
            await prisma.employeeCommission.findMany({ where: { saleId: sale.id } }),
            commissions,
          );
          const after = await reportOverview(reportInput);
          assert.equal(
            after.totals.commissionReconciliation,
            before.totals.commissionReconciliation + (paid === null ? 0 : 1),
          );
          assert.deepEqual(
            after.staffPerformance.map((row) => row.commission),
            before.staffPerformance.map((row) => row.commission),
          );
          const historical = await reportOverview({
            from: "2020-01-01T00:00:00Z",
            to: "2020-01-02T23:59:59Z",
            timeZone: "UTC",
          });
          assert.equal(historical.totals.commissionReconciliation, 0);
        });
      });
    }

    it("gives a member the member price and an ordinary customer the other one", async () => {
      const cutId = await idOf(TENANT_A, nameOf(TENANT_A, "Cut"));
      const memberId = await customerIdOf(TENANT_A, true);
      const plainId = await customerIdOf(TENANT_A, false);

      const forMember = await runAsTenant(TENANT_A, () =>
        createSale({
          customerId: memberId,
          lines: [{ itemType: "SERVICE", itemId: cutId, quantity: 1 }],
          payments: [{ method: "CASH", amount: 40 }],
        }),
      );
      const forPlain = await runAsTenant(TENANT_A, () =>
        createSale({
          customerId: plainId,
          lines: [{ itemType: "SERVICE", itemId: cutId, quantity: 1 }],
          payments: [{ method: "CASH", amount: 50 }],
        }),
      );

      assert.equal(forMember.lines[0]?.unitPrice, "40.00");
      assert.equal(forPlain.lines[0]?.unitPrice, "50.00");
    });

    it("gives each salon its own receipt numbers, in order, with no repeats", async () => {
      const cutId = await idOf(TENANT_A, nameOf(TENANT_A, "Cut"));
      const cutIdB = await idOf(TENANT_B, nameOf(TENANT_B, "Cut"));

      // Read each counter first rather than assuming it starts at zero: earlier tests in
      // this suite have already rung sales up for A, and the assertion is about the
      // *sequence*, not about a fresh database.
      const counterOf = (tenantId: string) =>
        runAsTenant(tenantId, () =>
          prisma.tenant.findFirstOrThrow({
            where: { id: tenantId },
            select: { receiptCounter: true },
          }),
        );

      const counterA = (await counterOf(TENANT_A)).receiptCounter;
      const counterB = (await counterOf(TENANT_B)).receiptCounter;

      const first = await runAsTenant(TENANT_A, () =>
        createSale({
          lines: [{ itemType: "SERVICE", itemId: cutId, quantity: 1 }],
          payments: [{ method: "CASH", amount: 50 }],
        }),
      );
      const second = await runAsTenant(TENANT_A, () =>
        createSale({
          lines: [{ itemType: "SERVICE", itemId: cutId, quantity: 1 }],
          payments: [{ method: "CASH", amount: 50 }],
        }),
      );
      const other = await runAsTenant(TENANT_B, () =>
        createSale({
          lines: [{ itemType: "SERVICE", itemId: cutIdB, quantity: 1 }],
          payments: [{ method: "CASH", amount: 50 }],
        }),
      );

      // Consecutive and gap-free within a salon, and **independent across salons** —
      // B's first sale is numbered from B's own counter, not from a global sequence
      // (ADR 0011). Legacy's `random_int(100000, 999999)` had neither property, and no
      // uniqueness at all, so two sales could print the same reference.
      assert.equal(first.receiptNumber, counterA + 1);
      assert.equal(second.receiptNumber, counterA + 2);
      assert.equal(other.receiptNumber, counterB + 1);
    });

    it("returns the same sale for a repeated idempotency key instead of charging twice", async () => {
      const cutId = await idOf(TENANT_A, nameOf(TENANT_A, "Cut"));
      const key = "double-tap-key-0001";
      const body = {
        lines: [{ itemType: "SERVICE" as const, itemId: cutId, quantity: 1 }],
        payments: [{ method: "CASH" as const, amount: 50 }],
        idempotencyKey: key,
      };

      const first = await runAsTenant(TENANT_A, () => createSale(body));
      const second = await runAsTenant(TENANT_A, () => createSale(body));

      // Q16. Legacy's `pay-by-cash` had no key anywhere, so this double-charged.
      assert.equal(second.id, first.id);
      assert.equal(second.receiptNumber, first.receiptNumber);

      const sales = await runAsTenant(TENANT_A, () =>
        prisma.sale.findMany({ where: { idempotencyKey: key }, select: { id: true } }),
      );
      assert.equal(sales.length, 1, "a replay must not write a second sale");
    });

    it("records a split as two tenders a report can sum", async () => {
      const cutId = await idOf(TENANT_A, nameOf(TENANT_A, "Cut"));
      const receipt = await runAsTenant(TENANT_A, () =>
        createSale({
          lines: [{ itemType: "SERVICE", itemId: cutId, quantity: 1 }],
          payments: [
            { method: "CASH", amount: 20 },
            { method: "CARD", amount: 30, sessionId: "cs_test_123" },
          ],
        }),
      );

      assert.equal(receipt.totalAmount, "50.00");
      assert.equal(receipt.paidAmount, "50.00");
      assert.equal(receipt.payments.length, 2);

      // Legacy stored this as the free text `"cash_20_card_30"`, which no query can sum.
      // `CASH` before `CARD` because Postgres orders an enum by **declaration** order
      // (`CASH` is declared first), not alphabetically.
      const stored = await runAsTenant(TENANT_A, () =>
        prisma.salePayment.findMany({
          where: { saleId: receipt.id },
          select: { method: true, amount: true, sessionId: true },
          orderBy: { method: "asc" },
        }),
      );
      assert.deepEqual(
        stored.map((row) => [row.method, row.amount.toFixed(2)]),
        [
          ["CASH", "20.00"],
          ["CARD", "30.00"],
        ],
      );
      // The gateway session belongs to the card half, which is the point of moving it
      // off the sale row.
      assert.equal(stored.find((row) => row.method === "CARD")?.sessionId, "cs_test_123");
    });

    it("takes stock off the product and refuses to oversell it", async () => {
      await grant(TENANT_A, "catalogue");
      const shampoo = await productIdOf(TENANT_A, nameOf(TENANT_A, "Shampoo"));

      const before = await runAsTenant(TENANT_A, () =>
        prisma.product.findFirstOrThrow({ where: { id: shampoo }, select: { quantity: true } }),
      );

      await runAsTenant(TENANT_A, () =>
        createSale({
          lines: [{ itemType: "PRODUCT", itemId: shampoo, quantity: 2 }],
          payments: [{ method: "CASH", amount: 30 }],
        }),
      );

      const after = await runAsTenant(TENANT_A, () =>
        prisma.product.findFirstOrThrow({ where: { id: shampoo }, select: { quantity: true } }),
      );
      assert.equal(after.quantity, before.quantity - 2);

      // One more than remains: refused, and nothing written.
      await assert.rejects(
        runAsTenant(TENANT_A, () =>
          createSale({
            lines: [{ itemType: "PRODUCT", itemId: shampoo, quantity: after.quantity + 1 }],
            payments: [{ method: "CASH", amount: 99 }],
          }),
        ),
        /in stock/,
      );

      const unchanged = await runAsTenant(TENANT_A, () =>
        prisma.product.findFirstOrThrow({ where: { id: shampoo }, select: { quantity: true } }),
      );
      assert.equal(unchanged.quantity, after.quantity, "a refused sale must not move stock");
    });

    it("credits a customer for a package, and refuses to issue credit to nobody", async () => {
      await grant(TENANT_A, "packages");
      const bundle = await packageIdOf(TENANT_A, nameOf(TENANT_A, "Aloha Bundle"));
      const customerId = await customerIdOf(TENANT_A, false);

      await runAsTenant(TENANT_A, () =>
        createSale({
          customerId,
          lines: [{ itemType: "PACKAGE", itemId: bundle, quantity: 1 }],
          payments: [{ method: "CASH", amount: 300 }],
        }),
      );

      const holdings = await runAsTenant(TENANT_A, () =>
        prisma.customerPackageHolding.findMany({
          where: { customerId },
          select: { quantity: true, quantityRemaining: true, saleLineId: true },
        }),
      );
      // 10 sessions granted by the seed, unspent at the moment of sale.
      assert.equal(holdings.length, 1);
      assert.equal(holdings[0]?.quantity, 10);
      assert.equal(holdings[0]?.quantityRemaining, 10);
      assert.ok(holdings[0]?.saleLineId, "the holding must name the line that granted it");

      // The same bundle, no customer: refused rather than credited to nobody.
      await assert.rejects(
        runAsTenant(TENANT_A, () =>
          createSale({
            lines: [{ itemType: "PACKAGE", itemId: bundle, quantity: 1 }],
            payments: [{ method: "CASH", amount: 300 }],
          }),
        ),
        /needs a customer/,
      );
    });

    it("refuses a kind whose add-on the salon has not bought", async () => {
      await revoke(TENANT_A, "packages");
      const bundle = await packageIdOf(TENANT_A, nameOf(TENANT_A, "Aloha Bundle"));
      const customerId = await customerIdOf(TENANT_A, false);

      // The search omits this kind; the write refuses it. Silently dropping the line
      // would sell nothing and report a success.
      await assert.rejects(
        runAsTenant(TENANT_A, () =>
          createSale({
            customerId,
            lines: [{ itemType: "PACKAGE", itemId: bundle, quantity: 1 }],
            payments: [{ method: "CASH", amount: 300 }],
          }),
        ),
        hasCode("MODULE_NOT_ENTITLED"),
      );

      await grant(TENANT_A, "packages");
    });

    it("refuses an expired gift card template the search still offers", async () => {
      await grant(TENANT_A, "giftCards");
      const lapsed = await giftCardIdOf(TENANT_A, nameOf(TENANT_A, "Lapsed Card"));
      const customerId = await customerIdOf(TENANT_A, false);

      // The search returns it — `GiftCard` has no status column — so the two halves of
      // the till must not disagree about whether it is for sale.
      const offered = await runAsTenant(TENANT_A, () =>
        searchSaleItems({ ...NO_FILTERS, kind: "GIFT_CARD" }),
      );
      assert.ok(
        offered.items.some((item) => item.id === lapsed),
        "the search still shows an expired template, which is why the write must refuse it",
      );

      await assert.rejects(
        runAsTenant(TENANT_A, () =>
          createSale({
            customerId,
            lines: [{ itemType: "GIFT_CARD", itemId: lapsed, quantity: 1 }],
            payments: [{ method: "CASH", amount: 50 }],
          }),
        ),
        /expired/,
      );
    });

    it("records an unpaid balance against the customer and the points earned", async () => {
      const cutId = await idOf(TENANT_A, nameOf(TENANT_A, "Cut"));
      const customerId = await customerIdOf(TENANT_A, false);

      const receipt = await runAsTenant(TENANT_A, () =>
        createSale({
          customerId,
          lines: [{ itemType: "SERVICE", itemId: cutId, quantity: 1 }],
          payments: [{ method: "CASH", amount: 20 }],
        }),
      );

      assert.equal(receipt.paymentStatus, "UNPAID");
      assert.equal(receipt.outstandingAmount, "30.00");
      // 5 points on the seeded cut.
      assert.equal(receipt.pointsEarned, 5);

      const outstanding = await runAsTenant(TENANT_A, () =>
        prisma.customerOutstanding.findMany({
          where: { saleId: receipt.id },
          select: { unpaidAmount: true },
        }),
      );
      assert.equal(outstanding.length, 1);
      assert.equal(outstanding[0]?.unpaidAmount.toFixed(2), "30.00");
    });

    it("never shows a negative balance when the customer overpays", async () => {
      const cutId = await idOf(TENANT_A, nameOf(TENANT_A, "Cut"));
      const customerId = await customerIdOf(TENANT_A, false);
      const receipt = await runAsTenant(TENANT_A, () =>
        createSale({
          customerId,
          lines: [{ itemType: "SERVICE", itemId: cutId, quantity: 1 }],
          // Change given: a hundred for a fifty.
          payments: [{ method: "CASH", amount: 100 }],
        }),
      );

      assert.equal(receipt.totalAmount, "50.00");
      assert.equal(receipt.paidAmount, "100.00");
      assert.equal(receipt.outstandingAmount, "0.00");
      assert.equal(receipt.paymentStatus, "PAID");

      const outstanding = await runAsTenant(TENANT_A, () =>
        prisma.customerOutstanding.count({ where: { saleId: receipt.id } }),
      );
      assert.equal(outstanding, 0, "overpayment is change, not a negative debt");
    });

    it("attributes each line to the stylist it names, and records nothing for the rest", async () => {
      const cutId = await idOf(TENANT_A, nameOf(TENANT_A, "Cut"));
      const serum = await productIdOf(TENANT_A, nameOf(TENANT_A, "Serum"));
      const staffId = await staffIdOf(TENANT_A);

      const receipt = await runAsTenant(TENANT_A, () =>
        createSale({
          staffId,
          lines: [
            { itemType: "SERVICE", itemId: cutId, quantity: 2, staffId },
            { itemType: "PRODUCT", itemId: serum, quantity: 1 },
          ],
          payments: [{ method: "CASH", amount: 135 }],
        }),
      );

      assert.equal(receipt.lines[0]?.staffId, staffId);
      assert.equal(receipt.lines[0]?.staffName, `Staff ${TENANT_A}`);
      assert.equal(receipt.lines[1]?.staffId, null, "an unattributed line is uncredited");

      // One performance row for the attributed line only, at the **line total**.
      const performance = await runAsTenant(TENANT_A, () =>
        prisma.employeePerformance.findMany({
          where: { saleId: receipt.id },
          select: { itemType: true, amount: true },
        }),
      );
      assert.equal(performance.length, 1);
      assert.equal(performance[0]?.itemType, "SERVICE");
      assert.equal(performance[0]?.amount.toFixed(2), "100.00");
    });

    it("reprints a receipt in the order it was rung up", async () => {
      const cutId = await idOf(TENANT_A, nameOf(TENANT_A, "Cut"));
      const serum = await productIdOf(TENANT_A, nameOf(TENANT_A, "Serum"));

      // Deliberately not alphabetical, so an order-by-name implementation fails here.
      const receipt = await runAsTenant(TENANT_A, () =>
        createSale({
          lines: [
            { itemType: "PRODUCT", itemId: serum, quantity: 1 },
            { itemType: "SERVICE", itemId: cutId, quantity: 1 },
          ],
          payments: [{ method: "CASH", amount: 85 }],
        }),
      );

      assert.deepEqual(
        receipt.lines.map((line) => line.itemType),
        ["PRODUCT", "SERVICE"],
      );
      // The same order on a re-read, which is what `GET /api/sales/:id` promises.
      const reread = await runAsTenant(TENANT_A, () => getSale(receipt.id));
      assert.deepEqual(
        reread.lines.map((line) => line.itemType),
        ["PRODUCT", "SERVICE"],
      );
    });

    it("keeps another salon's sale unreadable, and one of its customers unsellable-to", async () => {
      const cutIdB = await idOf(TENANT_B, nameOf(TENANT_B, "Cut"));
      const theirs = await runAsTenant(TENANT_B, () =>
        createSale({
          lines: [{ itemType: "SERVICE", itemId: cutIdB, quantity: 1 }],
          payments: [{ method: "CASH", amount: 50 }],
        }),
      );

      await assert.rejects(
        runAsTenant(TENANT_A, () => getSale(theirs.id)),
        hasCode("SALE_NOT_FOUND"),
      );

      // B's customer is simply not found for A — never "forbidden", which would confirm
      // that the id exists somewhere.
      const bCustomer = await customerIdOf(TENANT_B, false);
      await assert.rejects(
        runAsTenant(TENANT_A, () =>
          createSale({
            customerId: bCustomer,
            lines: [{ itemType: "SERVICE", itemId: cutIdB, quantity: 1 }],
            payments: [{ method: "CASH", amount: 50 }],
          }),
        ),
        hasCode("CUSTOMER_NOT_FOUND"),
      );
    });

    it("refuses a stylist that is not this salon's, before anything is written", async () => {
      const cutId = await idOf(TENANT_A, nameOf(TENANT_A, "Cut"));
      const foreignStylist = await staffIdOf(TENANT_B);
      const salesBefore = await runAsTenant(TENANT_A, () => prisma.sale.count());

      // B's stylist is a row that exists, so the foreign key would have accepted this
      // link and another salon's user would have been credited for A's performance.
      // The scoped read finds no such person for A — the same answer a bogus id gets,
      // and deliberately indistinguishable from it, for the same reason the customer
      // lookup is: "forbidden" would confirm the id exists somewhere.
      await assert.rejects(
        runAsTenant(TENANT_A, () =>
          createSale({
            lines: [{ itemType: "SERVICE", itemId: cutId, quantity: 1, staffId: foreignStylist }],
            payments: [{ method: "CASH", amount: 50 }],
          }),
        ),
        (error: unknown) => {
          assert.equal((error as { code?: string }).code, "BAD_REQUEST");
          const details = (error as { details?: { path?: string }[] }).details;
          assert.ok(
            details?.some((detail) => detail.path === "body.lines.0.staffId"),
            `expected a detail on the offending line, got ${JSON.stringify(details)}`,
          );
          return true;
        },
      );

      // The sale-level id (who rang it up) is refused the same way, at its own path.
      await assert.rejects(
        runAsTenant(TENANT_A, () =>
          createSale({
            staffId: "no-such-stylist",
            lines: [{ itemType: "SERVICE", itemId: cutId, quantity: 1 }],
            payments: [{ method: "CASH", amount: 50 }],
          }),
        ),
        (error: unknown) => {
          const details = (error as { details?: { path?: string }[] }).details;
          assert.ok(
            details?.some((detail) => detail.path === "body.staffId"),
            `expected a detail for body.staffId, got ${JSON.stringify(details)}`,
          );
          return true;
        },
      );

      // A refused cart writes nothing at all — not a sale with a null credit line.
      const salesAfter = await runAsTenant(TENANT_A, () => prisma.sale.count());
      assert.equal(salesAfter, salesBefore);
    });

    it("refuses to write outside a tenant scope", async () => {
      const cutId = await idOf(TENANT_A, nameOf(TENANT_A, "Cut"));
      await assert.rejects(
        runAsPlatform(() =>
          createSale({
            lines: [{ itemType: "SERVICE", itemId: cutId, quantity: 1 }],
            payments: [{ method: "CASH", amount: 50 }],
          }),
        ),
        /tenant scope/,
      );
    });

    it("records a local rail as a tender, without acquiring anything", async () => {
      const cutId = await idOf(TENANT_A, nameOf(TENANT_A, "Cut"));

      // TK2610-0011 / ADR 0019: PayNow is stored, not charged. The assertion that
      // matters is that the row round-trips as the code the cashier picked, because
      // that is what a later reconciliation report will group by.
      const receipt = await runAsTenant(TENANT_A, () =>
        createSale({
          lines: [{ itemType: "SERVICE", itemId: cutId, quantity: 1 }],
          payments: [{ method: "PAYNOW_SGQR", amount: 50 }],
        }),
      );

      assert.equal(receipt.payments.length, 1);
      assert.equal(receipt.payments[0]?.method, "PAYNOW_SGQR");
      assert.equal(receipt.payments[0]?.amount, "50.00");
      assert.equal(receipt.paymentStatus, "PAID");
    });

    it("spends a package session as a tender, and gives it back on void", async () => {
      await grant(TENANT_A, "packages");
      const bundle = await packageIdOf(TENANT_A, nameOf(TENANT_A, "Aloha Bundle"));
      const cutId = await idOf(TENANT_A, nameOf(TENANT_A, "Cut"));
      const customerId = await customerIdOf(TENANT_A, false);

      const holding = await runAsTenant(TENANT_A, () =>
        prisma.customerPackageHolding.create({
          data: {
            tenantId: TENANT_A,
            customerId,
            packageId: bundle,
            quantity: 2,
            quantityRemaining: 2,
          },
          select: { id: true },
        }),
      );

      // The seeded Cut is 50.00 for a non-member, and the package lists Cut, so one
      // session pays the whole line.
      const performer = await staffIdOf(TENANT_A);
      await runAsTenant(TENANT_A, () =>
        prisma.user.update({ where: { id: performer }, data: { commissionRate: 10 } }),
      );
      const receipt = await runAsTenant(TENANT_A, () =>
        createSale({
          customerId,
          lines: [{ itemType: "SERVICE", itemId: cutId, quantity: 1, staffId: performer }],
          payments: [{ method: "PACKAGE", amount: 50, holdingId: holding.id }],
        }),
      );
      await runAsTenant(TENANT_A, async () => {
        const commission = await prisma.employeeCommission.findFirstOrThrow({
          where: { saleId: receipt.id },
        });
        assert.equal(commission.amount.toFixed(2), "5.00");
        await prisma.user.update({ where: { id: performer }, data: { commissionRate: 0 } });
      });

      assert.equal(receipt.totalAmount, "50.00", "a redemption is a tender, not a discount");
      assert.equal(receipt.paidAmount, "50.00");
      assert.equal(receipt.paymentStatus, "PAID", "credit paid for the service; nothing is owed");
      // 5 points on the seeded cut — earned on what the service was worth, not on what
      // the customer handed over.
      assert.equal(receipt.pointsEarned, 5);

      const spent = await runAsTenant(TENANT_A, () =>
        prisma.customerPackageHolding.findFirstOrThrow({
          where: { id: holding.id },
          select: { quantityRemaining: true },
        }),
      );
      assert.equal(spent.quantityRemaining, 1);

      const redemptions = await runAsTenant(TENANT_A, () =>
        prisma.customerRedemption.findMany({
          where: { saleId: receipt.id },
          select: { itemType: true, itemId: true, quantity: true, amount: true, holdingId: true },
        }),
      );
      assert.equal(redemptions.length, 1);
      assert.equal(redemptions[0]?.itemType, "PACKAGE");
      assert.equal(redemptions[0]?.itemId, bundle);
      assert.equal(redemptions[0]?.quantity, 1);
      assert.equal(redemptions[0]?.amount, null, "a session is not money");
      assert.equal(redemptions[0]?.holdingId, holding.id);

      // Voiding refunds the session, not just the money.
      const actor = await staffIdOf(TENANT_A);
      const voided = await runAsTenant(TENANT_A, () =>
        voidSale(receipt.id, { reason: "wrong customer" }, actor),
      );
      assert.equal(voided.status, "VOID");
      assert.equal(
        await runAsTenant(TENANT_A, () =>
          prisma.employeeCommission.count({ where: { saleId: receipt.id } }),
        ),
        0,
      );

      const restored = await runAsTenant(TENANT_A, () =>
        prisma.customerPackageHolding.findFirstOrThrow({
          where: { id: holding.id },
          select: { quantityRemaining: true },
        }),
      );
      assert.equal(restored.quantityRemaining, 2);

      const reverted = await runAsTenant(TENANT_A, () =>
        prisma.customerRedemption.findFirstOrThrow({
          where: { saleId: receipt.id },
          select: { revertedAt: true },
        }),
      );
      assert.ok(reverted.revertedAt, "the redemption is stamped, not deleted");
    });

    it("refuses a package tender whose amount is not what the package covers", async () => {
      await grant(TENANT_A, "packages");
      const bundle = await packageIdOf(TENANT_A, nameOf(TENANT_A, "Aloha Bundle"));
      const cutId = await idOf(TENANT_A, nameOf(TENANT_A, "Cut"));
      const customerId = await customerIdOf(TENANT_A, false);

      const holding = await runAsTenant(TENANT_A, () =>
        prisma.customerPackageHolding.create({
          data: {
            tenantId: TENANT_A,
            customerId,
            packageId: bundle,
            quantity: 1,
            quantityRemaining: 1,
          },
          select: { id: true },
        }),
      );

      // The browser said 40.00; the package covers the catalogue's 50.00. The server
      // decides, so the session is not spent and no sale is written.
      await assert.rejects(
        runAsTenant(TENANT_A, () =>
          createSale({
            customerId,
            lines: [{ itemType: "SERVICE", itemId: cutId, quantity: 1 }],
            payments: [{ method: "PACKAGE", amount: 40, holdingId: holding.id }],
          }),
        ),
        hasCode("HOLDING_NOT_COVERED"),
      );

      const untouched = await runAsTenant(TENANT_A, () =>
        prisma.customerPackageHolding.findFirstOrThrow({
          where: { id: holding.id },
          select: { quantityRemaining: true },
        }),
      );
      assert.equal(untouched.quantityRemaining, 1, "a refused sale must not spend a session");
    });

    it("draws prepaid credit down, and refuses to overdraw it", async () => {
      const prepaid = await valuePackageIdOf(TENANT_A, nameOf(TENANT_A, "Prepaid Credit"));
      const cutId = await idOf(TENANT_A, nameOf(TENANT_A, "Cut"));
      const customerId = await customerIdOf(TENANT_A, false);

      const holding = await runAsTenant(TENANT_A, () =>
        prisma.customerValuePackageHolding.create({
          data: {
            tenantId: TENANT_A,
            customerId,
            valuePackageId: prepaid,
            amount: "30.00",
            amountRemaining: "30.00",
          },
          select: { id: true },
        }),
      );

      // Credit is fungible: the value package lists Cut, but it may pay for anything.
      const receipt = await runAsTenant(TENANT_A, () =>
        createSale({
          customerId,
          lines: [{ itemType: "SERVICE", itemId: cutId, quantity: 1 }],
          payments: [
            { method: "PREPAID_CREDIT", amount: 30, holdingId: holding.id },
            { method: "NETS", amount: 20 },
          ],
        }),
      );

      assert.equal(receipt.paidAmount, "50.00");
      assert.equal(receipt.paymentStatus, "PAID");

      const drained = await runAsTenant(TENANT_A, () =>
        prisma.customerValuePackageHolding.findFirstOrThrow({
          where: { id: holding.id },
          select: { amountRemaining: true },
        }),
      );
      assert.equal(drained.amountRemaining.toFixed(2), "0.00");

      const redemptions = await runAsTenant(TENANT_A, () =>
        prisma.customerRedemption.findMany({
          where: { saleId: receipt.id },
          select: { itemType: true, itemId: true, amount: true, holdingId: true },
        }),
      );
      assert.equal(redemptions.length, 1);
      assert.equal(redemptions[0]?.itemType, "VALUE_PACKAGE");
      assert.equal(redemptions[0]?.itemId, prepaid);
      assert.equal(redemptions[0]?.amount?.toFixed(2), "30.00");
      assert.equal(redemptions[0]?.holdingId, holding.id);

      // Nothing is left, so a second sale cannot spend it again.
      await assert.rejects(
        runAsTenant(TENANT_A, () =>
          createSale({
            customerId,
            lines: [{ itemType: "SERVICE", itemId: cutId, quantity: 1 }],
            payments: [{ method: "PREPAID_CREDIT", amount: 10, holdingId: holding.id }],
          }),
        ),
        hasCode("HOLDING_INSUFFICIENT"),
      );
    });

    it("refuses a holding that is not this customer's, or has expired", async () => {
      await grant(TENANT_A, "packages");
      const bundle = await packageIdOf(TENANT_A, nameOf(TENANT_A, "Aloha Bundle"));
      const cutId = await idOf(TENANT_A, nameOf(TENANT_A, "Cut"));
      const member = await customerIdOf(TENANT_A, true);
      const plain = await customerIdOf(TENANT_A, false);

      // A real batch of sessions — held by the *other* customer.
      const theirs = await runAsTenant(TENANT_A, () =>
        prisma.customerPackageHolding.create({
          data: {
            tenantId: TENANT_A,
            customerId: member,
            packageId: bundle,
            quantity: 2,
            quantityRemaining: 2,
          },
          select: { id: true },
        }),
      );

      await assert.rejects(
        runAsTenant(TENANT_A, () =>
          createSale({
            customerId: plain,
            lines: [{ itemType: "SERVICE", itemId: cutId, quantity: 1 }],
            payments: [{ method: "PACKAGE", amount: 50, holdingId: theirs.id }],
          }),
        ),
        // Not "forbidden": the scoped read simply does not find it, and the message
        // must not confirm that the id exists under another customer.
        hasCode("HOLDING_NOT_FOUND"),
      );

      const theirsAfter = await runAsTenant(TENANT_A, () =>
        prisma.customerPackageHolding.findFirstOrThrow({
          where: { id: theirs.id },
          select: { quantityRemaining: true },
        }),
      );
      assert.equal(theirsAfter.quantityRemaining, 2, "a refused sale must not spend it");

      const lapsed = await runAsTenant(TENANT_A, () =>
        prisma.customerPackageHolding.create({
          data: {
            tenantId: TENANT_A,
            customerId: plain,
            packageId: bundle,
            quantity: 1,
            quantityRemaining: 1,
            expiresAt: new Date("2020-01-01T00:00:00Z"),
          },
          select: { id: true },
        }),
      );

      await assert.rejects(
        runAsTenant(TENANT_A, () =>
          createSale({
            customerId: plain,
            lines: [{ itemType: "SERVICE", itemId: cutId, quantity: 1 }],
            payments: [{ method: "PACKAGE", amount: 50, holdingId: lapsed.id }],
          }),
        ),
        hasCode("HOLDING_EXPIRED"),
      );
    });

    it("snapshots package and prepaid expiry at completion, leaving prior holdings unchanged", async () => {
      await grant(TENANT_A, "packages");
      await runAsTenant(TENANT_A, async () => {
        const bundle = await prisma.package.create({
          data: {
            tenantId: TENANT_A,
            name: "Expiry fixture",
            sessionCount: 2,
            memberPrice: 10,
            nonmemberPrice: 10,
            validityDays: 30,
          },
        });
        const prepaid = await prisma.valuePackage.create({
          data: {
            tenantId: TENANT_A,
            name: "Expiry credit fixture",
            price: 10,
            credit: 12,
            validityDays: 60,
          },
        });
        const customerId = await customerIdOf(TENANT_A, false);
        const prior = await prisma.customerPackageHolding.create({
          data: {
            tenantId: TENANT_A,
            customerId,
            packageId: bundle.id,
            quantity: 2,
            quantityRemaining: 2,
          },
        });
        const lines = [
          { itemType: "PACKAGE" as const, itemId: bundle.id, quantity: 1 },
          { itemType: "VALUE_PACKAGE" as const, itemId: prepaid.id, quantity: 1 },
        ];
        const held = await createSale({ customerId, lines, payments: [], hold: true });
        assert.equal(
          await prisma.customerPackageHolding.count({ where: { saleLine: { saleId: held.id } } }),
          0,
        );
        // Simulate an old parked cart. Expiry must start on completion, not hold time.
        await prisma.sale.update({
          where: { id: held.id },
          data: { soldAt: new Date("2020-01-01Z") },
        });
        const completed = await completeSale(held.id, {
          customerId,
          lines,
          payments: [{ method: "CASH", amount: 20 }],
        });
        const sessions = await prisma.customerPackageHolding.findFirstOrThrow({
          where: { saleLine: { saleId: held.id } },
        });
        const credit = await prisma.customerValuePackageHolding.findFirstOrThrow({
          where: { saleLine: { saleId: held.id } },
        });
        assert.equal(sessions.expiresAt?.getTime(), +new Date(completed.soldAt) + 30 * 86_400_000);
        assert.equal(credit.expiresAt?.getTime(), +new Date(completed.soldAt) + 60 * 86_400_000);
        await prisma.package.update({ where: { id: bundle.id }, data: { validityDays: null } });
        await prisma.valuePackage.update({ where: { id: prepaid.id }, data: { validityDays: 1 } });
        assert.equal(
          (await prisma.customerPackageHolding.findFirstOrThrow({ where: { id: prior.id } }))
            .expiresAt,
          null,
        );
        assert.equal(
          (
            await prisma.customerPackageHolding.findFirstOrThrow({ where: { id: sessions.id } })
          ).expiresAt?.getTime(),
          sessions.expiresAt?.getTime(),
        );
        assert.equal(
          (
            await prisma.customerValuePackageHolding.findFirstOrThrow({ where: { id: credit.id } })
          ).expiresAt?.getTime(),
          credit.expiresAt?.getTime(),
        );
        const direct = await createSale({
          customerId,
          lines,
          payments: [{ method: "CASH", amount: 20 }],
        });
        assert.equal(
          (
            await prisma.customerPackageHolding.findFirstOrThrow({
              where: { saleLine: { saleId: direct.id } },
            })
          ).expiresAt,
          null,
        );
        assert.equal(
          (
            await prisma.customerValuePackageHolding.findFirstOrThrow({
              where: { saleLine: { saleId: direct.id } },
            })
          ).expiresAt?.getTime(),
          +new Date(direct.soldAt) + 86_400_000,
        );
      });
    });

    it("refuses a redemption on a walk-in cart, which has nobody to spend for", async () => {
      await grant(TENANT_A, "packages");
      const bundle = await packageIdOf(TENANT_A, nameOf(TENANT_A, "Aloha Bundle"));
      const cutId = await idOf(TENANT_A, nameOf(TENANT_A, "Cut"));
      const customerId = await customerIdOf(TENANT_A, false);

      const holding = await runAsTenant(TENANT_A, () =>
        prisma.customerPackageHolding.create({
          data: {
            tenantId: TENANT_A,
            customerId,
            packageId: bundle,
            quantity: 1,
            quantityRemaining: 1,
          },
          select: { id: true },
        }),
      );

      await assert.rejects(
        runAsTenant(TENANT_A, () =>
          createSale({
            lines: [{ itemType: "SERVICE", itemId: cutId, quantity: 1 }],
            payments: [{ method: "PACKAGE", amount: 50, holdingId: holding.id }],
          }),
        ),
        hasCode("HOLDING_REQUIRES_CUSTOMER"),
      );
    });
  },
);
