import { loginForRouteTest } from "../test-support/route-login.js";
// Static, so the `DATABASE_URL` gate below reads `.env` instead of skipping silently
// (the reason the suite used to vanish from `npm run verify` — see `auth.routes.test.ts`).
import "dotenv/config";

import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";

/**
 * Integration tests for the sales mount — screens 01–02 end to end: the item search
 * a cashier types into **before** anything is in the cart (5b.1), and the write that
 * rings that cart up plus the receipt it answers with (5b.2).
 *
 * For the search, the assertion that matters most is the **opposite** of the one
 * `packages.routes.test.ts` makes. There, an add-on the salon has not bought must
 * refuse the route. Here the add-on is one kind among five inside a core feature, so
 * the request must still succeed — with a shorter list and a `searchableKinds` that
 * says which tabs exist. A test that only checked the happy path would pass with the
 * entitlement check deleted, and one that only checked a refusal would pass with the
 * whole feature 403ing.
 *
 * Entitlement is read per request rather than baked into the token, which is why the
 * same access token sees a new tab after the `TenantModule` row is created — asserted
 * here, because a cashier must not have to sign out to sell a bundle they just bought.
 *
 * Gated on `DATABASE_URL`, like the other integration suites: it creates two salons,
 * signs in for real, and removes everything it made.
 */
const databaseUrl = process.env["DATABASE_URL"];
process.env.DATABASE_URL ??= "postgresql://glampro:glampro@127.0.0.1:5432/glampro_test";
process.env.JWT_SECRET ??= "sales-items-routes-test-secret";
process.env.NODE_ENV = "test";

const { createApp } = await import("../app.js");
const { prisma } = await import("../lib/prisma.js");
const { runAsPlatform } = await import("../lib/tenant-context.js");
const { hashPassword } = await import("../lib/password.js");
const { CORE_MODULE_CODES, MODULE_CODES } = await import("@glampro_suite/shared");

const PASSWORD = "correct-horse-1";
const DOMAIN = "sales-items-rt.test";
const EMAIL = `owner@${DOMAIN}`;
const CASHIER_EMAIL = `cashier@${DOMAIN}`;

const TENANT_A = "sales-items-a";
const TENANT_B = "sales-items-b";
const TENANT_IDS = [TENANT_A, TENANT_B];

/** Removes everything this file created, so runs are repeatable. */
async function purge(): Promise<void> {
  await runAsPlatform(async () => {
    await prisma.tenantModule.deleteMany({ where: { tenantId: { in: TENANT_IDS } } });
    await prisma.package.deleteMany({ where: { tenantId: { in: TENANT_IDS } } });
    await prisma.valuePackage.deleteMany({ where: { tenantId: { in: TENANT_IDS } } });
    await prisma.giftCard.deleteMany({ where: { tenantId: { in: TENANT_IDS } } });
    await prisma.product.deleteMany({ where: { tenantId: { in: TENANT_IDS } } });
    await prisma.service.deleteMany({ where: { tenantId: { in: TENANT_IDS } } });
    // Receipts intentionally prevent customer/staff cascades; remove fixture sales first.
    await prisma.sale.deleteMany({ where: { tenantId: { in: TENANT_IDS } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: `@${DOMAIN}` } } });
    await prisma.tenant.deleteMany({ where: { id: { in: TENANT_IDS } } });
  });
}

/**
 * Two salons, one owner in A, and no add-ons for either.
 *
 * The module catalogue is upserted the way the real seed does it — `isCore` derived
 * from the shared constant and the same list the guard reads — so a missing `sales`
 * row cannot make this suite pass for the wrong reason (`MODULE_UNKNOWN`).
 */
async function seed(): Promise<void> {
  const passwordHash = await hashPassword(PASSWORD);

  await runAsPlatform(async () => {
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

    await prisma.tenant.create({ data: { id: TENANT_A, name: "Sales Items A", slug: TENANT_A } });
    await prisma.tenant.create({ data: { id: TENANT_B, name: "Sales Items B", slug: TENANT_B } });

    await prisma.user.create({
      data: {
        tenantId: TENANT_A,
        email: EMAIL,
        name: "Ola Owner",
        passwordHash,
        globalRole: "SUPER_ADMIN",
      },
    });

    // A cashier, so the void's role guard can be asserted against somebody who is not an
    // owner. The password is the same one the owner signs in with.
    await prisma.user.create({
      data: {
        tenantId: TENANT_A,
        email: CASHIER_EMAIL,
        name: "Cam Cashier",
        passwordHash,
        globalRole: "STAFF",
      },
    });

    // A customer with no membership reference, so it pays the non-member price. The
    // ledgers that need an owner — a package's holding, a part-paid balance — have one
    // through it.
    await prisma.customer.create({
      data: { tenantId: TENANT_A, name: "Ana Aloha", phone: "+1 555 0100" },
    });

    // A's catalogue: one of everything, so each tab has something to be missing.
    await prisma.service.create({
      data: {
        tenantId: TENANT_A,
        name: "Aloha Cut",
        memberPrice: "40.00",
        nonmemberPrice: "50.00",
        points: 5,
      },
    });
    await prisma.product.create({
      data: {
        tenantId: TENANT_A,
        name: "Aloha Shampoo",
        memberPrice: "12.50",
        nonmemberPrice: "15.00",
        quantity: 3,
      },
    });
    await prisma.package.create({
      data: {
        tenantId: TENANT_A,
        name: "Aloha Bundle",
        sessionCount: 10,
        memberPrice: "250.00",
        nonmemberPrice: "300.00",
      },
    });
    await prisma.valuePackage.create({
      data: {
        tenantId: TENANT_A,
        name: "Aloha Credit",
        price: "100.00",
        credit: "120.00",
      },
    });
    await prisma.giftCard.create({
      data: { tenantId: TENANT_A, name: "Aloha Card", value: "150.00" },
    });

    // B's, with a name no search in this file will match, so a leak is unmistakable.
    await prisma.service.create({
      data: {
        tenantId: TENANT_B,
        name: "Foreign Cut",
        memberPrice: "10.00",
        nonmemberPrice: "12.00",
      },
    });
  });
}

/** Grants or revokes an add-on for tenant A. `Module` rows are platform data. */
async function setEntitlement(code: string, entitled: boolean): Promise<void> {
  await runAsPlatform(async () => {
    const module = await prisma.module.findUniqueOrThrow({
      where: { code },
      select: { id: true },
    });

    if (entitled) {
      await prisma.tenantModule.upsert({
        where: { tenantId_moduleId: { tenantId: TENANT_A, moduleId: module.id } },
        update: { expiresAt: null },
        create: { tenantId: TENANT_A, moduleId: module.id },
      });
      return;
    }

    await prisma.tenantModule.deleteMany({ where: { tenantId: TENANT_A, moduleId: module.id } });
  });
}

interface Envelope {
  data?: unknown;
  statusCode?: number;
  message?: string;
  code?: string;
  details?: { path?: string }[];
}

/** The item search's payload, as much of it as these tests read. */
interface SearchBody {
  searchableKinds: string[];
  items: {
    kind: string;
    name: string;
    price: string;
    memberPrice: string | null;
    barcode?: string | null;
  }[];
}

/** The receipt — `POST /api/sales` and `GET /api/sales/:id` answer with the same one. */
interface ReceiptBody {
  id: string;
  receiptNumber: number | null;
  status: string;
  paymentStatus: string;
  totalQuantity: number;
  totalAmount: string;
  paidAmount: string;
  outstandingAmount: string;
  discountAmount: string;
  taxAmount: string;
  taxRate: string;
  gstRegistrationNumber: string | null;
  pointsEarned: number;
  staffId: string | null;
  staffName: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  voidedByName: string | null;
  lines: {
    itemType: string;
    itemName: string;
    quantity: number;
    unitPrice: string;
    lineTotal: string;
    discountPercent: string;
    discountAmount: string;
    taxAmount: string;
    taxRate: string;
    staffId: string | null;
  }[];
  payments: { method: string; amount: string; sessionId: string | null }[];
}

async function envelope(response: Response): Promise<Envelope> {
  return (await response.json()) as Envelope;
}

async function dataOf<T>(response: Response): Promise<T> {
  const body = await envelope(response);
  assert.ok(body.data !== undefined, `expected a data envelope, got ${JSON.stringify(body)}`);
  return body.data as T;
}

/**
 * An id from **this** salon's seeded catalogue, read through the platform scope the
 * way `purge` does. Scoped to `TENANT_A` by name rather than trusting the first row,
 * so another suite seeding an "Aloha Cut" cannot hand this one a foreign id.
 */
async function seededIdOf(kind: "SERVICE" | "PRODUCT"): Promise<string> {
  if (kind === "SERVICE") {
    const row = await runAsPlatform(() =>
      prisma.service.findFirstOrThrow({
        where: { tenantId: TENANT_A, name: "Aloha Cut" },
        select: { id: true },
      }),
    );
    return row.id;
  }
  const row = await runAsPlatform(() =>
    prisma.product.findFirstOrThrow({
      where: { tenantId: TENANT_A, name: "Aloha Shampoo" },
      select: { id: true },
    }),
  );
  return row.id;
}

/** The suite's own customer id, read through the platform scope the way `purge` does. */
async function seededCustomerId(): Promise<string> {
  const row = await runAsPlatform(() =>
    prisma.customer.findFirstOrThrow({
      where: { tenantId: TENANT_A, name: "Ana Aloha" },
      select: { id: true },
    }),
  );
  return row.id;
}

/**
 * A body the contract accepts: one cut and one shampoo, paid in full in cash — the
 * walk-in case, so nothing here needs a customer. Non-member prices: 50 + 15 = 65.
 */
async function cartBody(): Promise<Record<string, unknown>> {
  return {
    lines: [
      { itemType: "SERVICE", itemId: await seededIdOf("SERVICE"), quantity: 1 },
      { itemType: "PRODUCT", itemId: await seededIdOf("PRODUCT"), quantity: 1 },
    ],
    payments: [{ method: "CASH", amount: 65 }],
  };
}

let baseUrl = "";
let server: Server | undefined;

async function request(method: "GET", path: string, accessToken?: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
  });
}

/**
 * A JSON write, in the same shape as the other route suites here.
 *
 * `token` is separate from `body` so the "not signed in" case can post a valid body with
 * no token — otherwise a 401 and a 422 would be indistinguishable.
 *
 * `body` is optional because `DELETE` carries none: `JSON.stringify(undefined)` is
 * `undefined`, which `fetch` sends as no body at all.
 */
async function send(
  method: "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
  accessToken?: string,
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/**
 * One row of the sale list, as much of it as these tests read.
 *
 * Deliberately a second interface rather than a slice of `ReceiptBody`: the list answers
 * with a summary and no lines, and a test that reused the receipt's type would compile
 * while asserting nothing about that difference.
 */
interface SaleSummaryBody {
  id: string;
  receiptNumber: number | null;
  status: string;
  customerName: string | null;
  staffId: string | null;
  staffName: string | null;
  lineCount: number;
  totalQuantity: number;
  totalAmount: string;
}

/**
 * A cart that touches no stock: one cut, credited to a stylist, and no payment.
 *
 * `staffId` is what makes the ledger half of the hold tests observable — performance is
 * written per attributed line — and the line carries no product, so a hold test cannot
 * fail because an earlier test in this file ate the shampoo.
 */
async function holdBody(staffId?: string): Promise<Record<string, unknown>> {
  return {
    hold: true,
    lines: [
      {
        itemType: "SERVICE",
        itemId: await seededIdOf("SERVICE"),
        quantity: 1,
        ...(staffId === undefined ? {} : { staffId }),
      },
    ],
  };
}

/** The lines `holdBody` parked, as the completion re-sends them. */
async function completeBody(staffId?: string): Promise<Record<string, unknown>> {
  const { lines } = await holdBody(staffId);
  return { lines, payments: [{ method: "CASH", amount: 50 }] };
}

/**
 * A product with exactly the stock the test needs.
 *
 * The suite's own shampoo is deliberately small (3) and the write tests above are eating
 * it, so a stock assertion against that row would be an assertion about test order. This
 * one is the hold's own evidence; `purge` clears it with the rest of the salon's catalogue.
 */
async function stockProduct(name: string, quantity: number): Promise<string> {
  const row = await runAsPlatform(() =>
    prisma.product.create({
      data: {
        tenantId: TENANT_A,
        name,
        memberPrice: "10.00",
        nonmemberPrice: "10.00",
        quantity,
      },
      select: { id: true },
    }),
  );
  return row.id;
}

/** Stock on hand, read outside any tenant scope so the assertion is about the row. */
async function stockOf(productId: string): Promise<number> {
  const row = await runAsPlatform(() =>
    prisma.product.findUniqueOrThrow({ where: { id: productId }, select: { quantity: true } }),
  );
  return row.quantity;
}

/** A salon's receipt counter, which a hold must leave where it found it. */
async function receiptCounter(): Promise<number> {
  const row = await runAsPlatform(() =>
    prisma.tenant.findUniqueOrThrow({ where: { id: TENANT_A }, select: { receiptCounter: true } }),
  );
  return row.receiptCounter;
}

/** How many rows one sale left in one ledger table, counted for this suite's salon. */
function ledgerRowsFor(saleId: string) {
  return runAsPlatform(async () => {
    const where = { tenantId: TENANT_A, saleId };
    return Promise.all([
      prisma.employeePerformance.count({ where }),
      prisma.customerPoint.count({ where }),
      prisma.customerOutstanding.count({ where }),
    ]);
  });
}

describe(
  "sales item search endpoint",
  { skip: databaseUrl ? false : "DATABASE_URL is not set" },
  () => {
    let token = "";
    /** A `STAFF` token, so the void's role guard has somebody to refuse. */
    let cashierToken = "";
    /** The signed-in owner's id, so "who rang it up" defaults can be asserted. */
    let ownerId = "";
    /** The receipt the write test above produced, re-read by the receipt test below. */
    let ringedUp: ReceiptBody | undefined;

    before(async () => {
      await purge();
      await seed();

      await new Promise<void>((resolve) => {
        server = createApp().listen(0, "127.0.0.1", () => resolve());
      });
      baseUrl = `http://127.0.0.1:${(server?.address() as AddressInfo).port}`;

      token = await loginForRouteTest(baseUrl, EMAIL, PASSWORD);
      ownerId = (
        await runAsPlatform(() =>
          prisma.user.findUniqueOrThrow({ where: { email: EMAIL }, select: { id: true } }),
        )
      ).id;

      const cashier = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: CASHIER_EMAIL, password: PASSWORD }),
      });
      assert.equal(cashier.status, 200, "could not sign in as the cashier");
      cashierToken = (await dataOf<{ accessToken: string }>(cashier)).accessToken;
    });

    after(async () => {
      await new Promise<void>((resolve, reject) => {
        if (!server) {
          resolve();
          return;
        }
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await purge();
    });

    it("serves paginated completed and void history to cashiers without leaking other tenants", async () => {
      const ids: string[] = [];
      try {
        await runAsPlatform(async () => {
          for (const tenantId of TENANT_IDS) {
            for (const status of ["COMPLETED", "VOID"] as const) {
              for (let index = 0; index < 2; index++) {
                const sale = await prisma.sale.create({
                  data: {
                    tenantId,
                    status,
                    totalQuantity: 0,
                    totalAmount: 0,
                    paidAmount: 0,
                    soldAt: new Date("2099-01-01"),
                  },
                });
                ids.push(sale.id);
              }
            }
          }
        });
        for (const status of ["COMPLETED", "VOID"]) {
          const first = await dataOf<{ items: SaleSummaryBody[]; page: number; hasMore: boolean }>(
            await request("GET", `/api/sales?status=${status}&limit=1&page=1`, cashierToken),
          );
          const second = await dataOf<typeof first>(
            await request("GET", `/api/sales?status=${status}&limit=1&page=2`, cashierToken),
          );
          assert.equal(first.items.length, 1);
          assert.equal(second.items.length, 1);
          assert.equal(first.hasMore, true);
          assert.equal(first.items[0]?.status, status);
          assert.equal(second.items[0]?.status, status);
          assert.notEqual(first.items[0]?.id, second.items[0]?.id);
          for (const row of [...first.items, ...second.items]) {
            assert.ok(ids.slice(0, 4).includes(row.id));
            assert.equal((await request("GET", `/api/sales/${row.id}`, cashierToken)).status, 200);
          }
        }
        assert.equal((await request("GET", `/api/sales/${ids[4]}`, cashierToken)).status, 404);
        assert.equal((await request("GET", "/api/sales?status=COMPLETED")).status, 401);
      } finally {
        await runAsPlatform(() => prisma.sale.deleteMany({ where: { id: { in: ids } } }));
      }
    });

    it("mounts the search behind auth", async () => {
      // A 401 rather than a 404 is what proves the mount exists at all.
      const response = await request("GET", "/api/sales/items");
      assert.equal(response.status, 401);
    });

    it("answers with the kinds a salon that has bought nothing may sell", async () => {
      await setEntitlement("packages", false);
      await setEntitlement("giftCards", false);

      const response = await request("GET", "/api/sales/items", token);
      assert.equal(response.status, 200);

      const body = await dataOf<SearchBody>(response);
      assert.deepEqual(body.searchableKinds, ["SERVICE", "PRODUCT"]);
      // Sorted by name, so the two sellable rows come back service-first even though it
      // is the products this salon has more of.
      assert.deepEqual(
        body.items.map((item) => item.name),
        ["Aloha Cut", "Aloha Shampoo"],
        "the two sellable rows this salon has, out of five it owns",
      );
    });

    it("shows a new tab on the same token once the add-on is granted", async () => {
      await setEntitlement("packages", true);

      const body = await dataOf<SearchBody>(await request("GET", "/api/sales/items", token));
      assert.deepEqual(body.searchableKinds, ["SERVICE", "PRODUCT", "PACKAGE", "VALUE_PACKAGE"]);
      assert.ok(body.items.some((item) => item.kind === "PACKAGE"));

      // Granting one add-on must not unlock the other.
      assert.equal(body.searchableKinds.includes("GIFT_CARD"), false);
    });

    it("rejects an unknown kind rather than quietly searching everything", async () => {
      const response = await request("GET", "/api/sales/items?kind=MEMBERSHIP", token);
      const body = await envelope(response);

      assert.equal(response.status, 422);
      assert.equal(body.code, "VALIDATION_FAILED");
      // The browser puts a 422's `path` on the control that caused it, so the path is
      // part of the contract rather than an implementation detail.
      assert.ok(
        body.details?.some((detail) => detail.path === "query.kind"),
        `expected a detail for query.kind, got ${JSON.stringify(body.details)}`,
      );
    });

    it("rejects a limit above the ceiling instead of clamping it silently", async () => {
      const response = await request("GET", "/api/sales/items?limit=999", token);

      assert.equal(response.status, 422);
      assert.equal((await envelope(response)).code, "VALIDATION_FAILED");
    });

    it("caps each kind, not the list", async () => {
      const body = await dataOf<SearchBody>(
        await request("GET", "/api/sales/items?limit=1", token),
      );

      // One row per searchable kind and nothing else. Compared sorted, because the list
      // is ordered by name rather than by kind — and stated without naming the kind list,
      // so the assertion holds whatever has been granted above it.
      assert.deepEqual(
        body.items.map((item) => item.kind).sort(),
        [...body.searchableKinds].sort(),
      );
    });

    it("searches by name and narrows by an add-on kind", async () => {
      const body = await dataOf<SearchBody>(
        await request("GET", "/api/sales/items?search=aloha&kind=PACKAGE", token),
      );

      assert.deepEqual(
        body.items.map((item) => item.name),
        ["Aloha Bundle"],
      );
      // Money is a string on the wire: the non-member price, formatted, not a float.
      assert.equal(body.items[0]?.price, "300.00");
      assert.equal(body.items[0]?.memberPrice, "250.00");
    });

    it("answers a kind whose add-on is missing with nothing, not with a refusal", async () => {
      await setEntitlement("giftCards", false);

      const response = await request("GET", "/api/sales/items?kind=GIFT_CARD", token);
      const body = await dataOf<SearchBody>(response);

      // A 200 with no rows: the picker was drawn from a core feature, and "you have not
      // bought this" is said by `searchableKinds`, not by failing the request.
      assert.equal(response.status, 200);
      assert.deepEqual(body.items, []);
      assert.equal(body.searchableKinds.includes("GIFT_CARD"), false);
    });

    it("never returns another salon's rows", async () => {
      const body = await dataOf<SearchBody>(await request("GET", "/api/sales/items", token));

      assert.ok(body.items.length > 0);
      assert.equal(
        body.items.some((item) => item.name === "Foreign Cut"),
        false,
        "tenant B's service must never appear in tenant A's till",
      );
    });

    it("returns a product's barcode when it carries one", async () => {
      await runAsPlatform(() =>
        prisma.product.updateMany({
          where: { tenantId: TENANT_A, name: "Aloha Shampoo" },
          data: { barcode: "8800000000007" },
        }),
      );

      const body = await dataOf<SearchBody>(
        await request("GET", "/api/sales/items?search=shampoo", token),
      );

      const product = body.items.find((item) => item.name === "Aloha Shampoo");
      assert.ok(product, "the shampoo row is the one the barcode search should hit");
      assert.equal(product.barcode, "8800000000007");
    });

    it("resolves a scan by the normalised barcode, and nothing else", async () => {
      await runAsPlatform(() =>
        prisma.product.updateMany({
          where: { tenantId: TENANT_A, name: "Aloha Shampoo" },
          data: { barcode: "8800000000007" },
        }),
      );

      const exact = await dataOf<SearchBody>(
        await request("GET", "/api/sales/items?barcode=8800000000007", token),
      );
      assert.deepEqual(
        exact.items.filter((item) => item.barcode === "8800000000007").map((item) => item.name),
        ["Aloha Shampoo"],
      );

      // A lowercase or spaced equivalent must name the same product.
      const loose = await dataOf<SearchBody>(
        await request("GET", "/api/sales/items?barcode= 8800000000007 ", token),
      );
      assert.deepEqual(
        loose.items.filter((item) => item.barcode === "8800000000007").map((item) => item.name),
        ["Aloha Shampoo"],
      );

      // A code that names a different product must not match.
      const foreign = await dataOf<SearchBody>(
        await request("GET", "/api/sales/items?barcode=9999999999999", token),
      );
      assert.equal(
        foreign.items.some((item) => item.barcode === "9999999999999"),
        false,
      );
    });

    /*
     * ── The write (5b.2) ──────────────────────────────────────────────────────
     *
     * What a route suite can show that `sale.service.test.ts` cannot: that the mount
     * exists behind `auth`, that a contract refusal arrives as a 422 with the path the
     * browser marks, that the sale-level `staffId` **defaults to the signed-in
     * cashier** (a rule that lives in the handler, not the service), and that a
     * suspended salon is refused by `requireWritableTenant` on this very path while
     * its read stays open.
     */

    it("mounts the write behind auth — a valid body still gets a 401", async () => {
      // The body is valid on purpose: a 401 that a malformed body would also produce
      // would not prove the mount exists rather than the contract refusing first.
      const response = await send("POST", "/api/sales", await cartBody());

      assert.equal(response.status, 401);
    });

    it("refuses a cart with no lines, naming the field the till must mark", async () => {
      const response = await send("POST", "/api/sales", { lines: [], payments: [] }, token);
      const body = await envelope(response);

      assert.equal(response.status, 422);
      assert.equal(body.code, "VALIDATION_FAILED");
      assert.ok(
        body.details?.some((detail) => detail.path === "body.lines"),
        `expected a detail for body.lines, got ${JSON.stringify(body.details)}`,
      );
    });

    it("rings a sale up and answers with the receipt it wrote", async () => {
      const response = await send("POST", "/api/sales", await cartBody(), token);

      assert.equal(response.status, 201);
      const receipt = await dataOf<ReceiptBody>(response);
      ringedUp = receipt;

      assert.equal(receipt.status, "COMPLETED");
      assert.equal(receipt.paymentStatus, "PAID");
      assert.equal(receipt.totalQuantity, 2);
      // Non-member prices from the catalogue: 50 + 15, strings so no cent is a float.
      assert.equal(receipt.totalAmount, "65.00");
      assert.equal(receipt.paidAmount, "65.00");
      assert.equal(receipt.outstandingAmount, "0.00");
      assert.equal(typeof receipt.receiptNumber, "number");
      assert.ok((receipt.receiptNumber ?? 0) >= 1, "the first receipt this salon issues");

      // Who rang it up defaults to the signed-in cashier. This rule lives in the
      // handler, so only this suite can see it.
      assert.equal(receipt.staffId, ownerId);
      assert.equal(receipt.staffName, "Ola Owner");

      assert.deepEqual(
        receipt.lines.map((line) => [line.itemType, line.unitPrice, line.lineTotal]),
        [
          ["SERVICE", "50.00", "50.00"],
          ["PRODUCT", "15.00", "15.00"],
        ],
      );
      assert.deepEqual(receipt.payments, [{ method: "CASH", amount: "65.00", sessionId: null }]);
    });

    it("re-reads that same receipt through GET /api/sales/:id", async () => {
      assert.ok(ringedUp, "the write test above must have run first");

      const response = await request("GET", `/api/sales/${ringedUp.id}`, token);

      // The confirmation screen *is* the receipt (roadmap, Phase 5d): one shape, the
      // same numbers, whether the POST just wrote it or the GET fetches it again.
      assert.equal(response.status, 200);
      assert.deepEqual(await dataOf<ReceiptBody>(response), ringedUp);
    });

    it("answers a sale id that does not exist as not found, not as a crash", async () => {
      const response = await request("GET", "/api/sales/no-such-sale", token);

      assert.equal(response.status, 404);
      assert.equal((await envelope(response)).code, "SALE_NOT_FOUND");
    });

    it("answers a replayed idempotency key with the sale it already wrote", async () => {
      // Q16. The double-tap a slow connection makes must charge once — asserted over
      // HTTP, because the double-tap happens at the till, not inside the service.
      const keyed = { ...(await cartBody()), idempotencyKey: "route-double-tap-0001" };

      const first = await send("POST", "/api/sales", keyed, token);
      const second = await send("POST", "/api/sales", keyed, token);

      assert.equal(first.status, 201);
      assert.equal(second.status, 201);
      const a = await dataOf<ReceiptBody>(first);
      const b = await dataOf<ReceiptBody>(second);
      assert.equal(b.id, a.id, "the second tap must not charge twice");
      assert.equal(b.receiptNumber, a.receiptNumber);

      const stored = await runAsPlatform(() =>
        prisma.sale.count({
          where: { tenantId: TENANT_A, idempotencyKey: "route-double-tap-0001" },
        }),
      );
      assert.equal(stored, 1, "one key, one sale");
    });

    it("lets a suspended salon read its till, but not take money", async () => {
      await runAsPlatform(() =>
        prisma.tenant.update({ where: { id: TENANT_A }, data: { status: "SUSPENDED" } }),
      );
      try {
        const write = await send("POST", "/api/sales", await cartBody(), token);
        assert.equal(write.status, 403);
        assert.equal((await envelope(write)).code, "TENANT_SUSPENDED");

        const read = await request("GET", "/api/sales/items", token);
        assert.equal(read.status, 200, "reading stays open — saas/TENANCY.md §6");
      } finally {
        await runAsPlatform(() =>
          prisma.tenant.update({ where: { id: TENANT_A }, data: { status: "ACTIVE" } }),
        );
      }
    });

    /*
     * ───────────────────────────────────────────────────────────────────────────
     * Hold, resume and discard (Phase 5g, ADR 0015)
     * ───────────────────────────────────────────────────────────────────────────
     *
     * The assertions that matter are the ones that separate a draft from a sale: a hold
     * spends no receipt number and writes no ledger row, and completion is what allocates
     * both. A test that only checked "POST with hold returns 201" would pass with the
     * whole distinction gone.
     */
    describe("direct-to-staff tips", () => {
      it("allows cashier recording, requires a manager for returns and blocks suspended writes", async () => {
        const itemId = await seededIdOf("SERVICE");
        const created = await send(
          "POST",
          "/api/sales",
          {
            lines: [{ itemType: "SERVICE", itemId, quantity: 1 }],
            payments: [{ method: "CASH", amount: 100 }],
          },
          cashierToken,
        );
        assert.equal(created.status, 201);
        const sale = await dataOf<ReceiptBody>(created);
        assert.ok(sale.staffId);
        const path = `/api/sales/${sale.id}/direct-tips`;
        const input = { staffId: sale.staffId, amount: 2.5, idempotencyKey: crypto.randomUUID() };
        assert.equal((await request("GET", path)).status, 401);
        assert.equal(
          (await send("POST", path, { ...input, amount: 0.001 }, cashierToken)).status,
          422,
        );
        const recorded = await send("POST", path, input, cashierToken);
        assert.equal(recorded.status, 200);
        const body = await dataOf<{ items: { id: string; amount: string }[] }>(recorded);
        assert.equal(body.items.length, 1);
        assert.equal(body.items[0]?.amount, "2.50");
        const returnPath = `${path}/${body.items[0]!.id}/return`;
        assert.equal(
          (await send("POST", returnPath, { reason: "Returned directly" }, cashierToken)).status,
          403,
        );
        await runAsPlatform(() =>
          prisma.tenant.update({ where: { id: TENANT_A }, data: { status: "SUSPENDED" } }),
        );
        try {
          assert.equal(
            (await send("POST", path, { ...input, idempotencyKey: crypto.randomUUID() }, token))
              .status,
            403,
          );
          assert.equal(
            (await send("POST", returnPath, { reason: "Returned directly" }, token)).status,
            403,
          );
          assert.equal((await request("GET", path, token)).status, 200);
        } finally {
          await runAsPlatform(() =>
            prisma.tenant.update({ where: { id: TENANT_A }, data: { status: "ACTIVE" } }),
          );
        }
        assert.equal(
          (await send("POST", returnPath, { reason: "Returned directly" }, token)).status,
          200,
        );
      });
    });

    describe("voucher campaigns and recorded refunds", () => {
      it("restricts publishing and refunds to managers, and completes a voucher sale", async () => {
        const campaign = {
          code: "route-ten",
          discountType: "PERCENTAGE",
          value: 10,
          startsAt: new Date(Date.now() - 60_000).toISOString(),
          endsAt: new Date(Date.now() + 3_600_000).toISOString(),
        };
        assert.equal((await send("POST", "/api/vouchers", campaign, cashierToken)).status, 403);
        const published = await send("POST", "/api/vouchers", campaign, token);
        assert.equal(published.status, 201);
        const voucher = await dataOf<{ id: string; code: string }>(published);
        assert.equal(voucher.code, "ROUTE-TEN");
        assert.equal((await send("POST", "/api/vouchers", campaign, token)).status, 409);
        const itemId = await seededIdOf("SERVICE");
        const lines = [{ itemType: "SERVICE", itemId, quantity: 1 }];
        const quoted = await send(
          "POST",
          "/api/sales/voucher-preview",
          { voucherCode: voucher.code, lines },
          cashierToken,
        );
        assert.equal(quoted.status, 200);
        assert.equal((await dataOf<{ totalAmount: string }>(quoted)).totalAmount, "45.00");
        const invalid = await send(
          "POST",
          "/api/sales",
          {
            voucherCode: voucher.code,
            lines: [{ ...lines[0], discountPercent: 10 }],
            payments: [],
          },
          token,
        );
        assert.equal(invalid.status, 422);
        const created = await send(
          "POST",
          "/api/sales",
          {
            voucherCode: voucher.code,
            lines,
            payments: [{ method: "CASH", amount: 45 }],
          },
          token,
        );
        assert.equal(created.status, 201);
        const sale = await dataOf<{
          id: string;
          totalAmount: string;
          voucherDiscountAmount: string;
        }>(created);
        assert.equal(sale.totalAmount, "45.00");
        assert.equal(sale.voucherDiscountAmount, "5.00");
        assert.equal(
          (
            await send(
              "POST",
              `/api/sales/${sale.id}/refund`,
              { reason: "Returned", payouts: [{ method: "CASH", amount: 45 }], restock: false },
              cashierToken,
            )
          ).status,
          403,
        );
        assert.equal(
          (await send("POST", `/api/sales/${sale.id}/refund`, { reason: "Returned" }, token))
            .status,
          422,
        );
        const refunded = await send(
          "POST",
          `/api/sales/${sale.id}/refund`,
          {
            reason: "Returned",
            payouts: [{ method: "CASH", amount: 45 }],
            restock: false,
            amount: 999,
          },
          token,
        );
        assert.equal(refunded.status, 200);
        const record = await dataOf<{
          refundAmount: string;
          refundedByName: string;
          status: string;
        }>(refunded);
        assert.equal(record.refundAmount, "45.00");
        assert.equal(record.refundedByName, "Ola Owner");
        assert.equal(record.status, "COMPLETED");
        const campaignAfter = await dataOf<{ redeemedCount: number }>(
          await request("GET", `/api/vouchers/${voucher.id}`, token),
        );
        assert.equal(
          campaignAfter.redeemedCount,
          1,
          "a refund must not restore voucher availability",
        );
      });
    });

    describe("parking a cart and picking it up again", () => {
      /** The cart the tests below pick up, parked by the first of them. */
      let parked: ReceiptBody | undefined;

      it("parks a cart without taking a receipt number, a tender or a ledger row", async () => {
        const before = await receiptCounter();

        const response = await send("POST", "/api/sales", await holdBody(ownerId), token);
        assert.equal(response.status, 201);

        parked = await dataOf<ReceiptBody>(response);
        assert.equal(parked.status, "HELD");
        assert.equal(
          parked.receiptNumber,
          null,
          "a hold must not spend a number the salon never printed",
        );
        assert.equal(parked.paidAmount, "0.00");
        assert.equal(parked.totalAmount, "50.00", "the non-member price of one cut");
        assert.deepEqual(parked.payments, [], "a hold takes no money");
        assert.equal(parked.lines.length, 1);

        assert.equal(
          await receiptCounter(),
          before,
          "parking a cart must not move the salon's receipt sequence",
        );
        // The ledger is what a void would have to reverse, so at hold time there is
        // nothing to reverse — which is the point of the whole decision.
        assert.deepEqual(
          await ledgerRowsFor(parked.id),
          [0, 0, 0],
          "performance, points and outstanding are filled at completion, not at hold",
        );
      });

      it("lists the salon's parked carts, and nothing else, by default", async () => {
        const response = await request("GET", "/api/sales", token);
        assert.equal(response.status, 200);

        const body = await dataOf<{ items: SaleSummaryBody[] }>(response);
        const row = body.items.find((item) => item.id === parked?.id);
        assert.ok(row, `the cart parked above must be in the list, got ${JSON.stringify(body)}`);
        assert.equal(row.status, "HELD");
        assert.equal(row.receiptNumber, null);
        assert.equal(row.lineCount, 1, "one line, which is one row the resumed cart draws");
        assert.equal(row.totalQuantity, 1);
        assert.equal(row.totalAmount, "50.00");
        assert.equal(row.staffId, ownerId, "who parked it, so a colleague knows whose cart it is");

        // `?status=` defaults to HELD in the contract rather than to "everything", so a
        // till that asks for nothing cannot be handed the salon's whole history.
        assert.ok(body.items.every((item) => item.status === "HELD"));
      });

      it("creates only one hold for concurrent and sequential retries without ledger effects", async () => {
        const input = {
          ...(await completeBody(ownerId)),
          payments: [],
          hold: true,
          idempotencyKey: "held-retry-integrity-test",
        };
        const before = await receiptCounter();
        const results = await Promise.all([
          send("POST", "/api/sales", input, token),
          send("POST", "/api/sales", input, token),
        ]);
        const receipts: ReceiptBody[] = [];
        for (const response of results) {
          assert.equal(response.status, 201);
          receipts.push(await dataOf<ReceiptBody>(response));
        }
        const id = receipts[0]!.id;
        try {
          assert.equal(receipts[1]?.id, id);
          const replay = await dataOf<ReceiptBody>(await send("POST", "/api/sales", input, token));
          assert.equal(replay.id, id);
          assert.equal(replay.status, "HELD");
          assert.equal(replay.receiptNumber, null);
          assert.deepEqual(replay.payments, []);
          assert.equal(await receiptCounter(), before);
          assert.deepEqual(await ledgerRowsFor(id), [0, 0, 0]);
          assert.equal(
            await runAsPlatform(() =>
              prisma.sale.count({
                where: {
                  tenantId: TENANT_A,
                  idempotencyKey: input.idempotencyKey,
                },
              }),
            ),
            1,
          );
        } finally {
          assert.equal((await send("DELETE", `/api/sales/${id}`, undefined, token)).status, 200);
        }
      });

      it("paginates held carts without hiding older rows or crossing tenants", async () => {
        const created = await dataOf<ReceiptBody>(
          await send(
            "POST",
            "/api/sales",
            {
              ...(await completeBody(ownerId)),
              payments: [],
              hold: true,
            },
            token,
          ),
        );
        assert.ok(parked);
        const parkedId = parked.id;
        const foreignId = await runAsPlatform(async () => {
          const foreign = await prisma.sale.create({
            data: {
              tenantId: TENANT_B,
              status: "HELD",
              totalQuantity: 0,
              totalAmount: 0,
              paidAmount: 0,
              soldAt: new Date("2099-01-01"),
            },
          });
          const sameTime = new Date("2026-10-19T12:00:00Z");
          await prisma.sale.updateMany({
            where: { id: { in: [created.id, parkedId] } },
            data: { soldAt: sameTime },
          });
          return foreign.id;
        });
        try {
          const first = await dataOf<{ items: SaleSummaryBody[]; page: number; hasMore: boolean }>(
            await request("GET", "/api/sales?limit=1&page=1", token),
          );
          const second = await dataOf<typeof first>(
            await request("GET", "/api/sales?limit=1&page=2", token),
          );
          assert.equal(first.page, 1);
          assert.equal(first.hasMore, true);
          assert.equal(first.items.length, 1);
          assert.equal(second.items.length, 1);
          assert.notEqual(first.items[0]?.id, second.items[0]?.id);
          assert.ok([first.items[0]?.id, second.items[0]?.id].includes(parkedId));
          assert.ok([first.items[0]?.id, second.items[0]?.id].includes(created.id));
          assert.equal(second.hasMore, false);
          const beyond = await dataOf<typeof first>(
            await request("GET", "/api/sales?limit=1&page=1000", token),
          );
          assert.deepEqual(beyond.items, []);
          assert.equal(beyond.hasMore, false);
          assert.equal((await request("GET", "/api/sales?page=0", token)).status, 422);
        } finally {
          assert.equal(
            (await send("DELETE", `/api/sales/${created.id}`, undefined, token)).status,
            200,
          );
          await runAsPlatform(() => prisma.sale.delete({ where: { id: foreignId } }));
        }
      });

      it("refuses a status it does not know rather than widening to every sale", async () => {
        const response = await request("GET", "/api/sales?status=DELETED", token);

        assert.equal(response.status, 422);
        assert.equal((await envelope(response)).code, "VALIDATION_FAILED");
      });

      it("rings the parked cart up: the number and the ledger arrive together", async () => {
        const response = await send(
          "POST",
          `/api/sales/${parked?.id}/complete`,
          await completeBody(ownerId),
          token,
        );
        assert.equal(response.status, 200);

        const receipt = await dataOf<ReceiptBody>(response);
        assert.equal(receipt.id, parked?.id, "completion writes the hold, it does not add a sale");
        assert.equal(receipt.status, "COMPLETED");
        assert.equal(receipt.paymentStatus, "PAID");
        assert.equal(receipt.paidAmount, "50.00");
        assert.equal(receipt.outstandingAmount, "0.00");
        assert.equal(typeof receipt.receiptNumber, "number");
        assert.ok((receipt.receiptNumber ?? 0) >= 1);
        assert.equal(receipt.staffId, ownerId);
        assert.deepEqual(
          receipt.lines.map((line) => [line.itemName, line.lineTotal]),
          [["Aloha Cut", "50.00"]],
          "the receipt holds the cart that was rung up, re-priced from the catalogue",
        );
        assert.deepEqual(receipt.payments, [{ method: "CASH", amount: "50.00", sessionId: null }]);

        // The performance row is the one ledger an attributed line writes, and it exists
        // only now.
        assert.deepEqual(await ledgerRowsFor(receipt.id), [1, 0, 0]);
        const performance = await runAsPlatform(() =>
          prisma.employeePerformance.findFirstOrThrow({
            where: { tenantId: TENANT_A, saleId: receipt.id },
            select: { userId: true, amount: true },
          }),
        );
        assert.equal(performance.userId, ownerId);
        assert.equal(performance.amount.toFixed(2), "50.00");
      });
    });

    /** Parks one cart, for the tests that are about completing or discarding it. */
    async function freshHold(staffId?: string): Promise<ReceiptBody> {
      return dataOf<ReceiptBody>(await send("POST", "/api/sales", await holdBody(staffId), token));
    }

    describe("completing a parked cart twice, and abandoning one", () => {
      it("quotes exact current prices without changing the hold or ledgers", async () => {
        const held = await freshHold(ownerId);
        const itemId = await seededIdOf("SERVICE");
        const original = await runAsPlatform(() =>
          prisma.service.findUniqueOrThrow({ where: { id: itemId } }),
        );
        const beforeCounts = await ledgerRowsFor(held.id);
        const counter = await receiptCounter();
        try {
          await runAsPlatform(() =>
            prisma.service.update({
              where: { id: itemId },
              data: { nonmemberPrice: 123, memberPrice: 111 },
            }),
          );
          const response = await request("GET", `/api/sales/${held.id}/resume`, cashierToken);
          assert.equal(response.status, 200);
          const quote = await dataOf<{
            sale: ReceiptBody;
            items: { id: string; price: string; memberPrice: string }[];
          }>(response);
          assert.equal(quote.sale.status, "HELD");
          assert.equal(quote.items[0]!.id, itemId);
          assert.equal(quote.items[0]!.price, "123.00");
          assert.equal(quote.items[0]!.memberPrice, "111.00");
          assert.equal(quote.sale.totalAmount, held.totalAmount);
          assert.deepEqual(await ledgerRowsFor(held.id), beforeCounts);
          assert.equal(await receiptCounter(), counter);
          await runAsPlatform(() =>
            prisma.service.update({ where: { id: itemId }, data: { status: "INACTIVE" } }),
          );
          assert.equal((await request("GET", `/api/sales/${held.id}/resume`, token)).status, 400);
        } finally {
          await runAsPlatform(() =>
            prisma.service.update({
              where: { id: itemId },
              data: {
                nonmemberPrice: original.nonmemberPrice,
                memberPrice: original.memberPrice,
                status: original.status,
              },
            }),
          );
        }
      });

      it("answers a second completion with the receipt the first one wrote", async () => {
        const held = await freshHold(ownerId);
        const first = await send(
          "POST",
          `/api/sales/${held.id}/complete`,
          await completeBody(ownerId),
          token,
        );
        const second = await send(
          "POST",
          `/api/sales/${held.id}/complete`,
          await completeBody(ownerId),
          token,
        );

        assert.equal(first.status, 200);
        assert.equal(second.status, 200, "a double-tap must not be an error the cashier sees");
        const a = await dataOf<ReceiptBody>(first);
        const b = await dataOf<ReceiptBody>(second);
        assert.equal(b.id, a.id);
        assert.equal(b.receiptNumber, a.receiptNumber, "and must not print a second receipt");

        // One sale, one tender, one performance row: the replay wrote nothing.
        assert.equal((await ledgerRowsFor(a.id))[0], 1);
        const tenders = await runAsPlatform(() =>
          prisma.salePayment.count({ where: { tenantId: TENANT_A, saleId: a.id } }),
        );
        assert.equal(tenders, 1, "the second tap must not take the money twice");
        assert.equal((await request("GET", `/api/sales/${held.id}/resume`, token)).status, 409);
      });

      it("resolves an item beyond search limits and refuses missing or foreign held items", async () => {
        const productId = await stockProduct("ZZZ pickup exact item", 1);
        const held = await dataOf<ReceiptBody>(
          await send(
            "POST",
            "/api/sales",
            {
              hold: true,
              lines: [{ itemType: "PRODUCT", itemId: productId, quantity: 1 }],
            },
            token,
          ),
        );
        const search = await dataOf<{ items: { id: string }[] }>(
          await request("GET", "/api/sales/items?kind=PRODUCT&limit=1", token),
        );
        assert.ok(!search.items.some((item) => item.id === productId));
        assert.equal((await request("GET", `/api/sales/${held.id}/resume`, token)).status, 200);
        assert.equal(await stockOf(productId), 1);
        await runAsPlatform(() => prisma.product.delete({ where: { id: productId } }));
        assert.equal((await request("GET", `/api/sales/${held.id}/resume`, token)).status, 409);
        await runAsPlatform(() =>
          prisma.sale.update({ where: { id: held.id }, data: { tenantId: TENANT_B } }),
        );
        try {
          assert.equal((await request("GET", `/api/sales/${held.id}/resume`, token)).status, 404);
        } finally {
          await runAsPlatform(() =>
            prisma.sale.update({ where: { id: held.id }, data: { tenantId: TENANT_A } }),
          );
        }
      });

      it("refuses a held package after its add-on is removed", async () => {
        await setEntitlement("packages", true);
        const packageRow = await runAsPlatform(() =>
          prisma.package.findFirstOrThrow({ where: { tenantId: TENANT_A } }),
        );
        const held = await dataOf<ReceiptBody>(
          await send(
            "POST",
            "/api/sales",
            {
              hold: true,
              customerId: await seededCustomerId(),
              lines: [{ itemType: "PACKAGE", itemId: packageRow.id, quantity: 1 }],
            },
            token,
          ),
        );
        await setEntitlement("packages", false);
        assert.equal((await request("GET", `/api/sales/${held.id}/resume`, token)).status, 403);
      });

      it("refuses to discard a sale that was rung up", async () => {
        const rungUp = await freshHold(ownerId);
        await send("POST", `/api/sales/${rungUp.id}/complete`, await completeBody(ownerId), token);

        const response = await send("DELETE", `/api/sales/${rungUp.id}`, undefined, token);

        // Deleting a receipt is the thing the void exists to prevent, so this is a refusal
        // rather than a second way to be rid of a sale.
        assert.equal(response.status, 409);
        assert.equal((await envelope(response)).code, "SALE_NOT_HELD");
        assert.equal((await request("GET", `/api/sales/${rungUp.id}`, token)).status, 200);
      });

      it("discards a parked cart, and it is gone for good", async () => {
        const abandoned = await freshHold();

        const response = await send("DELETE", `/api/sales/${abandoned.id}`, undefined, token);
        assert.equal(response.status, 200);
        assert.deepEqual(await dataOf<{ id: string }>(response), { id: abandoned.id });

        const gone = await request("GET", `/api/sales/${abandoned.id}`, token);
        assert.equal(gone.status, 404);
        assert.equal((await envelope(gone)).code, "SALE_NOT_FOUND");

        // And off the hold list, so nobody can pick up a cart that no longer exists.
        const list = await dataOf<{ items: SaleSummaryBody[] }>(
          await request("GET", "/api/sales", token),
        );
        assert.equal(
          list.items.some((item) => item.id === abandoned.id),
          false,
        );
      });

      it("refuses a hold that carries a payment", async () => {
        const response = await send(
          "POST",
          "/api/sales",
          { ...(await holdBody()), payments: [{ method: "CASH", amount: 50 }] },
          token,
        );

        // Money changing hands is what completion *is*, so a hold with tenders is refused
        // rather than written into a half-state the ledgers cannot describe.
        assert.equal(response.status, 422);
        assert.ok(
          (await envelope(response)).details?.some((detail) => detail.path === "body.payments"),
          "the till puts this on the payment control, not in a banner",
        );
      });

      it("reserves no stock while parked, and takes it when the sale is rung up", async () => {
        const productId = await stockProduct("Hold Stock", 2);
        const lines = [{ itemType: "PRODUCT", itemId: productId, quantity: 2 }];

        const parkedStock = await dataOf<ReceiptBody>(
          await send("POST", "/api/sales", { hold: true, lines }, token),
        );
        assert.equal(
          await stockOf(productId),
          2,
          "a hold reserves nothing — the quote does not take the last bottle off the shelf",
        );

        const receipt = await dataOf<ReceiptBody>(
          await send(
            "POST",
            `/api/sales/${parkedStock.id}/complete`,
            { lines, payments: [{ method: "CASH", amount: 20 }] },
            token,
          ),
        );
        assert.equal(receipt.status, "COMPLETED");
        assert.equal(receipt.totalAmount, "20.00");
        assert.equal(await stockOf(productId), 0, "ringing it up is what takes the stock");
      });
    });

    /*
     * ───────────────────────────────────────────────────────────────────────────
     * Void (Phase 5h, ADR 0016)
     * ───────────────────────────────────────────────────────────────────────────
     *
     * What matters here is that a void is a **reversal**, not a delete: the receipt
     * survives with its number and its lines, and every ledger `fillLedgers` wrote is
     * undone in the same transaction. A test that only checked `status === "VOID"` would
     * pass with the entire reversal missing, which is exactly what legacy shipped.
     */
    describe("voiding a rung-up sale", () => {
      /**
       * A cart with no stock in it, so these tests cannot run out of shampoo part-way
       * through — the suite's own product is deliberately tiny and the write tests above
       * have been eating it.
       */
      async function serviceCart(): Promise<Record<string, unknown>> {
        return {
          lines: [{ itemType: "SERVICE", itemId: await seededIdOf("SERVICE"), quantity: 1 }],
          payments: [{ method: "CASH", amount: 50 }],
        };
      }

      /** Rings a cart up and returns its receipt — the thing a void acts on. */
      async function ringUp(body?: Record<string, unknown>): Promise<ReceiptBody> {
        const response = await send("POST", "/api/sales", body ?? (await serviceCart()), token);
        assert.equal(response.status, 201);
        return dataOf<ReceiptBody>(response);
      }

      it("reverses every ledger, keeping the receipt, its number and its tenders", async () => {
        const productId = await stockProduct("Void Stock", 2);
        const customerId = await seededCustomerId();
        const sale = await ringUp({
          customerId,
          lines: [
            {
              itemType: "SERVICE",
              itemId: await seededIdOf("SERVICE"),
              quantity: 1,
              staffId: ownerId,
            },
            { itemType: "PRODUCT", itemId: productId, quantity: 2 },
          ],
          // 50.00 for the cut (non-member: this customer carries no membership
          // reference) plus 2 × 10.00 = 70.00.
          payments: [{ method: "CASH", amount: 70 }],
        });

        assert.equal(await stockOf(productId), 0, "the sale took the stock");
        assert.deepEqual(
          await ledgerRowsFor(sale.id),
          [1, 1, 0],
          "one performance row and one point row, and no balance",
        );

        const response = await send(
          "POST",
          `/api/sales/${sale.id}/void`,
          { reason: "Customer changed their mind" },
          token,
        );
        assert.equal(response.status, 200);

        const voided = await dataOf<ReceiptBody>(response);
        assert.equal(voided.id, sale.id, "the receipt is the same sale, not a new one");
        assert.equal(voided.status, "VOID");
        assert.equal(voided.receiptNumber, sale.receiptNumber, "the number stays consumed");
        assert.equal(voided.paymentStatus, "PAID", "what was handed over did happen");
        assert.equal(voided.voidReason, "Customer changed their mind");
        assert.equal(voided.voidedByName, "Ola Owner", "the actor is the token's user");
        assert.equal(typeof voided.voidedAt, "string");
        // Still a receipt: the lines and the tenders are on it.
        assert.equal(voided.lines.length, 2);
        assert.deepEqual(voided.payments, [{ method: "CASH", amount: "70.00", sessionId: null }]);
        assert.equal(voided.pointsEarned, 0, "the points net to zero rather than being erased");

        // Each ledger in turn.
        assert.equal(await stockOf(productId), 2, "the stock came back");
        assert.deepEqual(
          await ledgerRowsFor(sale.id),
          [0, 2, 0],
          "performance is gone and the points are an offsetting pair",
        );
        const points = await runAsPlatform(() =>
          prisma.customerPoint.findMany({
            where: { tenantId: TENANT_A, saleId: sale.id },
            select: { point: true },
          }),
        );
        assert.deepEqual(
          points.map((row) => row.point).sort((a, b) => a - b),
          [-5, 5],
          "the earned row stays and a negative row offsets it — history is not edited",
        );
      });

      it("is idempotent, and does not rewrite the first reason or the first actor", async () => {
        const sale = await ringUp();

        const first = await send(
          "POST",
          `/api/sales/${sale.id}/void`,
          { reason: "Rung up twice" },
          token,
        );
        const second = await send(
          "POST",
          `/api/sales/${sale.id}/void`,
          { reason: "A different story" },
          token,
        );

        assert.equal(first.status, 200);
        assert.equal(second.status, 200, "a double-tap is not an error to interpret");
        const a = await dataOf<ReceiptBody>(first);
        const b = await dataOf<ReceiptBody>(second);
        assert.equal(b.voidReason, "Rung up twice", "the first reason stands");
        assert.equal(b.voidedAt, a.voidedAt, "and so does the first moment");
      });

      it("refuses a cart that was never rung up, which is discarded instead", async () => {
        const held = await dataOf<ReceiptBody>(
          await send("POST", "/api/sales", await holdBody(), token),
        );

        const response = await send(
          "POST",
          `/api/sales/${held.id}/void`,
          { reason: "Not wanted" },
          token,
        );

        // A hold has no ledger and no receipt number, so there is nothing to reverse; the
        // two endings point at each other (ADR 0015 §6, ADR 0016 §7).
        assert.equal(response.status, 409);
        assert.equal((await envelope(response)).code, "SALE_NOT_COMPLETED");
        assert.equal(
          (await dataOf<ReceiptBody>(await request("GET", `/api/sales/${held.id}`, token))).status,
          "HELD",
          "and the refusal changed nothing",
        );
      });

      it("refuses credit the sale granted that the customer has already used", async () => {
        await setEntitlement("packages", true);
        const customerId = await seededCustomerId();
        const packageId = (
          await runAsPlatform(() =>
            prisma.package.findFirstOrThrow({
              where: { tenantId: TENANT_A, name: "Aloha Bundle" },
              select: { id: true },
            }),
          )
        ).id;

        const sale = await ringUp({
          customerId,
          lines: [{ itemType: "PACKAGE", itemId: packageId, quantity: 1 }],
          payments: [{ method: "CASH", amount: 300 }],
        });

        // One session spent is the whole difference between "the sale should not have
        // happened" and "the customer keeps what they used".
        const holding = await runAsPlatform(() =>
          prisma.customerPackageHolding.findFirstOrThrow({
            where: { tenantId: TENANT_A, packageId, customerId },
            select: { id: true },
          }),
        );
        await runAsPlatform(() =>
          prisma.customerPackageHolding.update({
            where: { id: holding.id },
            data: { quantityRemaining: { decrement: 1 } },
          }),
        );

        const response = await send(
          "POST",
          `/api/sales/${sale.id}/void`,
          { reason: "Customer wants a refund" },
          token,
        );

        assert.equal(response.status, 409);
        assert.equal((await envelope(response)).code, "HOLDING_ALREADY_SPENT");
        assert.equal(
          (await dataOf<ReceiptBody>(await request("GET", `/api/sales/${sale.id}`, token))).status,
          "COMPLETED",
          "a refused void reverses nothing at all",
        );
      });

      it("refuses a balance that has already been paid against", async () => {
        const customerId = await seededCustomerId();
        const sale = await ringUp({
          customerId,
          lines: [{ itemType: "SERVICE", itemId: await seededIdOf("SERVICE"), quantity: 1 }],
          // 50.00 due, 20.00 handed over: the rest is a debt on the customer's account.
          payments: [{ method: "CASH", amount: 20 }],
        });

        const outstanding = await runAsPlatform(() =>
          prisma.customerOutstanding.findFirstOrThrow({
            where: { tenantId: TENANT_A, saleId: sale.id },
            select: { id: true, unpaidAmount: true },
          }),
        );
        await runAsPlatform(() =>
          prisma.customerOutstandingPayment.create({
            data: {
              tenantId: TENANT_A,
              customerId,
              outstandingId: outstanding.id,
              saleId: sale.id,
              paidAmount: outstanding.unpaidAmount,
              paidAt: new Date(),
            },
          }),
        );

        const response = await send(
          "POST",
          `/api/sales/${sale.id}/void`,
          { reason: "Customer disputes this" },
          token,
        );

        // Money came in after the sale, so undoing it means refunding — a different verb.
        assert.equal(response.status, 409);
        assert.equal((await envelope(response)).code, "OUTSTANDING_ALREADY_PAID");
      });

      it("cancels a balance nobody has paid against, with the sale", async () => {
        const customerId = await seededCustomerId();
        const sale = await ringUp({
          customerId,
          lines: [{ itemType: "SERVICE", itemId: await seededIdOf("SERVICE"), quantity: 1 }],
          payments: [{ method: "CASH", amount: 20 }],
        });

        const response = await send(
          "POST",
          `/api/sales/${sale.id}/void`,
          { reason: "Wrong price quoted" },
          token,
        );
        assert.equal(response.status, 200);

        const rows = await runAsPlatform(() =>
          prisma.customerOutstanding.count({ where: { tenantId: TENANT_A, saleId: sale.id } }),
        );
        assert.equal(rows, 0, "the debt is cancelled with the sale that created it");
      });

      it("refuses a cashier, who may not authorise their own reversal", async () => {
        const sale = await ringUp();

        const response = await send(
          "POST",
          `/api/sales/${sale.id}/void`,
          { reason: "Cashier changed their mind" },
          cashierToken,
        );

        assert.equal(response.status, 403);
        assert.equal((await envelope(response)).code, "FORBIDDEN");
        assert.equal(
          (await dataOf<ReceiptBody>(await request("GET", `/api/sales/${sale.id}`, token))).status,
          "COMPLETED",
        );
      });

      it("requires a reason, and answers an unknown sale as not found", async () => {
        const sale = await ringUp();

        const brief = await send("POST", `/api/sales/${sale.id}/void`, { reason: "no" }, token);
        assert.equal(brief.status, 422);
        assert.ok(
          (await envelope(brief)).details?.some((detail) => detail.path === "body.reason"),
          "the reason is required by the contract, not merely expected",
        );

        const missing = await send(
          "POST",
          "/api/sales/no-such-sale/void",
          { reason: "Never existed" },
          token,
        );
        assert.equal(missing.status, 404);
        assert.equal((await envelope(missing)).code, "SALE_NOT_FOUND");
      });
    });

    /*
     * ───────────────────────────────────────────────────────────────────────────
     * Discounts (Phase 5i, ADR 0017)
     * ───────────────────────────────────────────────────────────────────────────
     *
     * The client sends a **rate** and the server sends money. The assertion that matters
     * is the penny: the rate rounds on the unit price, so `lineTotal = unitPrice ×
     * quantity` holds and the sale's `Discount` is the sum of the lines rather than a
     * second total that could disagree with them.
     */
    describe("discounting a line", () => {
      /** Rings up a one-line cart and returns its receipt. */
      async function ringUpLine(
        line: Record<string, unknown>,
        amount: number,
        customerId?: string,
      ): Promise<ReceiptBody> {
        const response = await send(
          "POST",
          "/api/sales",
          {
            ...(customerId === undefined ? {} : { customerId }),
            lines: [line],
            payments: [{ method: "CASH", amount }],
          },
          token,
        );
        assert.equal(response.status, 201);
        return dataOf<ReceiptBody>(response);
      }

      it("rounds the rate on the unit price, so a line's own arithmetic stays exact", async () => {
        // 50.00 at 33.33% is 16.665, which rounds half-up to 16.67 — the case where
        // rounding on the unit price and rounding on the line total disagree by a cent.
        const receipt = await ringUpLine(
          {
            itemType: "SERVICE",
            itemId: await seededIdOf("SERVICE"),
            quantity: 3,
            discountPercent: 33.33,
          },
          100,
        );

        // 50.00 − 16.67 = 33.33 a unit; 3 × 33.33 = 99.99, and 3 × 16.67 = 50.01 off.
        assert.equal(receipt.lines[0]?.unitPrice, "33.33");
        assert.equal(receipt.lines[0]?.lineTotal, "99.99");
        assert.equal(receipt.lines[0]?.discountPercent, "33.33");
        assert.equal(receipt.lines[0]?.discountAmount, "50.01");
        assert.equal(receipt.totalAmount, "99.99");
        assert.equal(receipt.discountAmount, "50.01", "the sale totals the lines' discounts");
      });

      it("leaves a line nobody discounted at zero rather than null", async () => {
        const receipt = await ringUpLine(
          { itemType: "SERVICE", itemId: await seededIdOf("SERVICE"), quantity: 1 },
          50,
        );

        assert.equal(receipt.lines[0]?.discountPercent, "0.00");
        assert.equal(receipt.lines[0]?.discountAmount, "0.00");
        assert.equal(receipt.discountAmount, "0.00");
      });

      it("credits the stylist and the customer with what was actually paid", async () => {
        const customerId = await seededCustomerId();
        const receipt = await ringUpLine(
          {
            itemType: "SERVICE",
            itemId: await seededIdOf("SERVICE"),
            quantity: 1,
            staffId: ownerId,
            discountPercent: 50,
          },
          25,
          customerId,
        );

        // Half of 50.00. The rule is the same one legacy applied **without recording it**;
        // the difference is that the rate and the money are on the line now (ADR 0017 §6).
        const performance = await runAsPlatform(() =>
          prisma.employeePerformance.findFirstOrThrow({
            where: { tenantId: TENANT_A, saleId: receipt.id },
            select: { amount: true },
          }),
        );
        assert.equal(performance.amount.toFixed(2), "25.00");
        assert.equal(receipt.pointsEarned, 2, "discounted points are rounded down per line");

        // And a discounted sale still voids, reversing the discounted figures.
        const voided = await dataOf<ReceiptBody>(
          await send("POST", `/api/sales/${receipt.id}/void`, { reason: "Wrong rate" }, token),
        );
        assert.equal(voided.status, "VOID");
        assert.equal(voided.pointsEarned, 0, "the offsetting row nets the points to zero");
        assert.equal(voided.discountAmount, "25.00", "the receipt still says what was given away");
      });

      it("refuses a rate above the cap, and one the column could not hold", async () => {
        const line = async (discountPercent: number) => ({
          itemType: "SERVICE",
          itemId: await seededIdOf("SERVICE"),
          quantity: 1,
          discountPercent,
        });

        const tooMuch = await send(
          "POST",
          "/api/sales",
          { lines: [await line(120)], payments: [{ method: "CASH", amount: 0 }] },
          token,
        );
        assert.equal(tooMuch.status, 422, "a discount cannot exceed the list price");

        const tooPrecise = await send(
          "POST",
          "/api/sales",
          { lines: [await line(12.345)], payments: [{ method: "CASH", amount: 50 }] },
          token,
        );
        // `Decimal(5,2)` would round this **after** the money had been computed from it,
        // so the contract refuses it rather than storing a rate that cannot explain the
        // amount it produced.
        assert.equal(tooPrecise.status, 422);
        assert.ok(
          (await envelope(tooPrecise)).details?.some(
            (detail) => detail.path === "body.lines.0.discountPercent",
          ),
        );
      });
    });

    /**
     * TK2610-0009 / P0-01: Singapore GST at 9%, inclusive of the catalogue price.
     *
     * The customer pays `totalAmount` either way; the receipt explains how much of it
     * is tax. The rate and the money are **stored on the sale and each line**, so a
     * later rate change cannot rewrite what a past receipt said.
     */
    describe("GST on a receipt", () => {
      async function setGst(enabled: boolean): Promise<void> {
        await runAsPlatform(() =>
          prisma.tenant.update({ where: { id: TENANT_A }, data: { gstEnabled: enabled } }),
        );
      }

      it("backs the 9% component out of inclusive prices, one line at a time", async () => {
        await setGst(true);
        try {
          const serviceId = await seededIdOf("SERVICE");
          const response = await send(
            "POST",
            "/api/sales",
            {
              lines: [
                { itemType: "SERVICE", itemId: serviceId, quantity: 3 },
                { itemType: "SERVICE", itemId: serviceId, quantity: 1 },
              ],
              payments: [{ method: "CASH", amount: 200 }],
            },
            token,
          );
          assert.equal(response.status, 201);
          const receipt = await dataOf<ReceiptBody>(response);

          // 3 × 50.00 = 150.00 and 1 × 50.00 = 50.00. Inclusive, so the customer
          // pays 200.00 and the tax is already inside it — never added on top.
          assert.equal(receipt.totalAmount, "200.00");
          assert.deepEqual(
            receipt.lines.map((line) => line.taxAmount),
            ["12.39", "4.13"],
          );
          assert.equal(receipt.lines[0]?.taxRate, "9.00");

          // The sale totals the rounded lines (16.52), not 200.00 × 9/109 (16.51):
          // two tills pricing the same cart must land on the same cent.
          assert.equal(receipt.taxAmount, "16.52");
          assert.equal(receipt.taxRate, "9.00");

          // Re-read through the receipt endpoint, so what is asserted is persisted.
          const reread = await dataOf<ReceiptBody>(
            await request("GET", `/api/sales/${receipt.id}`, token),
          );
          assert.equal(reread.taxAmount, "16.52");
          assert.equal(reread.lines[0]?.taxAmount, "12.39");
        } finally {
          await setGst(false);
        }
      });

      it("stores zero tax, and still a rate, while the salon has GST switched off", async () => {
        const receipt = await dataOf<ReceiptBody>(
          await send(
            "POST",
            "/api/sales",
            {
              lines: [{ itemType: "SERVICE", itemId: await seededIdOf("SERVICE"), quantity: 1 }],
              payments: [{ method: "CASH", amount: 50 }],
            },
            token,
          ),
        );

        assert.equal(receipt.totalAmount, "50.00");
        assert.equal(receipt.taxAmount, "0.00");
        assert.equal(receipt.taxRate, "0.00");
        assert.equal(receipt.lines[0]?.taxAmount, "0.00");
      });
    });

    /*
     * ───────────────────────────────────────────────────────────────────────────
     * GST number snapshot + emailed receipts (TK2610-0010)
     * ───────────────────────────────────────────────────────────────────────────
     *
     * The number is written **onto the sale**, so a reprint after the salon edits its
     * settings still shows the registration that applied at the till. The email reads
     * that stored receipt rather than repricing: the copy and the paper are one document.
     */
    describe("GST number snapshots and emailed receipts", () => {
      async function setGst(enabled: boolean, registrationNumber: string | null): Promise<void> {
        await runAsPlatform(() =>
          prisma.tenant.update({
            where: { id: TENANT_A },
            data: { gstEnabled: enabled, gstRegistrationNumber: registrationNumber },
          }),
        );
      }

      /** A one-line cart — no stock, so these tests cannot run the shampoo out. */
      async function ringUp(): Promise<ReceiptBody> {
        const response = await send(
          "POST",
          "/api/sales",
          {
            lines: [{ itemType: "SERVICE", itemId: await seededIdOf("SERVICE"), quantity: 1 }],
            payments: [{ method: "CASH", amount: 50 }],
          },
          token,
        );
        assert.equal(response.status, 201);
        return dataOf<ReceiptBody>(response);
      }

      it("snapshots the salon's number, and keeps it when the setting changes", async () => {
        await setGst(true, "GST-200012345");
        try {
          const sale = await ringUp();
          assert.equal(sale.gstRegistrationNumber, "GST-200012345");

          await setGst(true, "GST-CHANGED");
          const reread = await dataOf<ReceiptBody>(
            await request("GET", `/api/sales/${sale.id}`, token),
          );
          assert.equal(
            reread.gstRegistrationNumber,
            "GST-200012345",
            "history does not move with the setting",
          );
        } finally {
          await setGst(false, null);
        }
      });

      it("stores no number while GST is switched off", async () => {
        await setGst(false, "GST-200012345");
        try {
          assert.equal((await ringUp()).gstRegistrationNumber, null);
        } finally {
          await setGst(false, null);
        }
      });

      it("emails the stored receipt to the address in the body", async () => {
        const sale = await ringUp();

        const response = await send(
          "POST",
          `/api/sales/${sale.id}/receipt/email`,
          { email: "customer@example.com" },
          token,
        );

        assert.equal(response.status, 200);
        const sent = await dataOf<{ sent: boolean; to: string; messageId: string | null }>(
          response,
        );
        assert.equal(sent.sent, true);
        assert.equal(sent.to, "customer@example.com", "it went where the cashier said");
      });

      it("refuses a parked cart, which has no receipt yet", async () => {
        const held = await dataOf<ReceiptBody>(
          await send("POST", "/api/sales", await holdBody(), token),
        );

        const response = await send(
          "POST",
          `/api/sales/${held.id}/receipt/email`,
          { email: "customer@example.com" },
          token,
        );

        assert.equal(response.status, 409);
        assert.equal((await envelope(response)).code, "SALE_NOT_COMPLETED");
      });

      it("requires a valid address, and a cashier may send one", async () => {
        const sale = await ringUp();

        const malformed = await send(
          "POST",
          `/api/sales/${sale.id}/receipt/email`,
          { email: "not-an-address" },
          token,
        );
        assert.equal(malformed.status, 422);
        assert.ok(
          (await envelope(malformed)).details?.some((detail) => detail.path === "body.email"),
          "the address is required by the contract, not merely expected",
        );

        // Emailing a receipt is a till action, not an authorisation: the role guard the
        // void carries must not have been copied onto it.
        const byCashier = await send(
          "POST",
          `/api/sales/${sale.id}/receipt/email`,
          { email: "customer@example.com" },
          cashierToken,
        );
        assert.equal(byCashier.status, 200);
      });
    });
  },
);
