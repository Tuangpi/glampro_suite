import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { saleItemSearchQuerySchema, type SaleItemKind } from "@glampro_suite/shared";

// Persistence is replaced below; never connect to an application database.
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://unused:unused@127.0.0.1:1/unused";
process.env.JWT_SECRET = "isolated-sale-pagination-tests";
const { prisma } = await import("../lib/prisma.js");
const { runAsTenant } = await import("../lib/tenant-context.js");
const { searchSaleItems } = await import("./sale.service.js");

const restore: Array<() => void> = [];
function replace(target: object, key: string, implementation: unknown) {
  const record = target as Record<string, unknown>;
  const original = record[key];
  record[key] = implementation;
  restore.push(() => {
    record[key] = original;
  });
}

type ReadArgs = {
  skip: number;
  take: number;
  where: { name?: { contains: string } };
  orderBy: unknown;
};
const reads: ReadArgs[] = [];
const price = { toFixed: () => "10.00" };
const rows = Array.from({ length: 805 }, (_, index) => ({
  id: `item-${index}`,
  name: `Item ${String(index).padStart(4, "0")}`,
  memberPrice: price,
  nonmemberPrice: price,
  price,
  value: price,
  credit: price,
  points: 0,
  durationMinutes: 30,
  quantity: 10,
  barcode: null,
  sessionCount: 5,
  services: [],
  expiresAt: null,
}));

beforeEach(() => {
  reads.length = 0;
  replace(prisma.module, "findMany", async () => [
    { code: "catalogue", isCore: true },
    { code: "packages", isCore: true },
    { code: "giftCards", isCore: true },
  ]);
  replace(prisma.tenantModule, "findMany", async () => []);
  replace(prisma.tenant, "findUnique", async () => ({ lowStockThreshold: 5 }));
  for (const delegate of [
    prisma.service,
    prisma.product,
    prisma.package,
    prisma.valuePackage,
    prisma.giftCard,
  ]) {
    replace(delegate, "findMany", async (args: ReadArgs) => {
      reads.push(args);
      const matching = args.where.name
        ? rows.filter((row) => row.name.includes(args.where.name!.contains))
        : rows;
      return matching.slice(args.skip, args.skip + args.take);
    });
  }
});
afterEach(() => {
  for (const undo of restore.splice(0).reverse()) undo();
});

function search(kind: SaleItemKind, page: number, term?: string) {
  return runAsTenant("pagination-test", () =>
    searchSaleItems(saleItemSearchQuerySchema.parse({ kind, page, limit: 24, search: term })),
  );
}

describe("bounded sale catalog pagination", () => {
  for (const kind of ["SERVICE", "PRODUCT", "PACKAGE", "VALUE_PACKAGE", "GIFT_CARD"] as const) {
    it(`browses all 805 ${kind} items without duplicates or oversized reads`, async () => {
      const ids: string[] = [];
      for (let page = 1; page <= 34; page++) {
        const result = await search(kind, page);
        assert.equal(result.hasMore, page < 34);
        assert.equal(result.items.length, page < 34 ? 24 : 13);
        assert.ok(result.items.every((item) => item.kind === kind));
        ids.push(...result.items.map((item) => item.id));
      }
      assert.equal(new Set(ids).size, 805);
      assert.deepEqual(
        ids,
        rows.map((row) => row.id),
      );
      assert.equal(reads.length, 34, "only the selected kind is read");
      assert.ok(reads.every((read) => read.take === 25));
      assert.deepEqual(reads[0]?.orderBy, [{ name: "asc" }, { id: "asc" }]);
      const beyond = await search(kind, 35);
      assert.deepEqual(beyond.items, []);
      assert.equal(beyond.hasMore, false);
    });
  }

  it("applies search before pagination and leaves category entitlements intact", async () => {
    const result = await search("SERVICE", 1, "0804");
    assert.deepEqual(
      result.items.map((item) => item.id),
      ["item-804"],
    );
    assert.equal(result.hasMore, false);
    assert.equal(result.searchableKinds.length, 5);
  });
});
