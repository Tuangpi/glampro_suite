/**
 * The gift-card service, against the real database.
 *
 * The assertions that matter here are about **absence and null**:
 *
 * - A card with no expiry reads back as `null`, not as today's date. "Never
 *   expires" is a real product, and legacy stored `expired_date` as text precisely
 *   because it was allowed to be empty (Q6) — a defaulted date would silently
 *   expire every migrated card.
 * - **There is no `status` field at all.** Screen 08's table draws a Status column
 *   for its other tabs and `GiftCard` has no column behind it, so the field is
 *   asserted absent rather than rendered as an invented state — the rule
 *   `PROJECT.md#design-6` sets, and the same one the Shifts and Rating columns
 *   follow.
 *
 * Skipped with a clear message when `DATABASE_URL` is absent.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { runAsPlatform, runAsTenant } from "../lib/tenant-context.js";
import { prisma } from "../lib/prisma.js";
import { createGiftCard, getGiftCard, listGiftCards, updateGiftCard } from "./gift-card.service.js";

const databaseUrl = process.env["DATABASE_URL"];

const TENANT_A = "giftcard-test-a";
const TENANT_B = "giftcard-test-b";

const NO_FILTERS = {
  page: 1,
  pageSize: 20,
  search: undefined,
  status: undefined,
  departmentId: undefined,
  lowStock: undefined,
  threshold: undefined,
} as const;

async function purge(): Promise<void> {
  await runAsPlatform(async () => {
    const ids = [TENANT_A, TENANT_B];
    await prisma.giftCard.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
  });
}

/**
 * Two salons. A's `Aloha Card` expires and carries a remark; its `Bahar Card` never
 * expires — the migrated shape, where `expired_date` was an empty string.
 */
async function seed(): Promise<void> {
  await purge();

  await runAsPlatform(async () => {
    for (const id of [TENANT_A, TENANT_B]) {
      await prisma.tenant.create({
        data: { id, name: `Salon ${id}`, slug: `salon-${id}` },
      });

      await prisma.giftCard.create({
        data: {
          tenantId: id,
          name: `Aloha Card ${id}`,
          value: "100.00",
          expiresAt: new Date("2027-01-31T00:00:00.000Z"),
          remark: "Christmas promotion",
        },
      });

      await prisma.giftCard.create({
        data: { tenantId: id, name: `Bahar Card ${id}`, value: "50.00", expiresAt: null },
      });
    }
  });
}

/** A card id read unscoped, for the cross-tenant read attempt. */
function giftCardIdOf(tenantId: string, name: string): Promise<string> {
  return runAsPlatform(async () => {
    const card = await prisma.giftCard.findFirstOrThrow({
      where: { tenantId, name: `${name} Card ${tenantId}` },
      select: { id: true },
    });
    return card.id;
  });
}

describe(
  "gift-card.service, against the database",
  { skip: databaseUrl ? false : "DATABASE_URL is not set" },
  () => {
    before(seed);
    after(purge);

    it("lists only the calling tenant's cards, ordered by name", async () => {
      const page = await runAsTenant(TENANT_A, () => listGiftCards(NO_FILTERS));

      assert.equal(page.total, 2);
      assert.deepEqual(
        page.data.map((row) => row.name),
        [`Aloha Card ${TENANT_A}`, `Bahar Card ${TENANT_A}`],
      );
    });

    it("sends the value as a string, so no cent is lost to a float", async () => {
      const page = await runAsTenant(TENANT_A, () => listGiftCards(NO_FILTERS));
      const aloha = page.data[0];
      assert.ok(aloha, "the seeded card must be found");

      assert.equal(aloha.value, "100.00");
      assert.equal(typeof aloha.value, "string");
    });

    it("reads a card with no expiry as never expiring, not as today", async () => {
      const page = await runAsTenant(TENANT_A, () =>
        listGiftCards({ ...NO_FILTERS, search: "Bahar" }),
      );

      assert.equal(page.data[0]?.expiresAt, null);
    });

    it("carries no status at all, because the model has no status column", async () => {
      const page = await runAsTenant(TENANT_A, () => listGiftCards(NO_FILTERS));

      for (const row of page.data) {
        assert.equal("status" in row, false, "screen 08's Status cell has no column here");
      }
    });

    it("matches the search against the remark as well as the name", async () => {
      const page = await runAsTenant(TENANT_A, () =>
        listGiftCards({ ...NO_FILTERS, search: "christmas" }),
      );

      assert.equal(page.total, 1);
      assert.equal(page.data[0]?.name, `Aloha Card ${TENANT_A}`);
    });

    it("cannot read another tenant's card by id", async () => {
      const foreign = await giftCardIdOf(TENANT_B, "Aloha");

      await assert.rejects(
        runAsTenant(TENANT_A, () => getGiftCard(foreign)),
        /does not exist/,
      );
    });

    it("creates a card that never expires when no date is given", async () => {
      const created = await runAsTenant(TENANT_A, () =>
        createGiftCard({ name: "Charlie Card", value: 25 }),
      );

      assert.equal(created.value, "25.00");
      assert.equal(created.expiresAt, null);
      assert.equal(created.remark, null);
    });

    it("stores a date-only expiry, and reads the same day back", async () => {
      const created = await runAsTenant(TENANT_A, () =>
        createGiftCard({ name: "Delta Card", value: 75, expiresAt: "2027-03-04" }),
      );

      assert.equal(created.expiresAt, "2027-03-04T00:00:00.000Z");
      // The day is the fact; the editor renders back the date part of that instant.
      assert.equal(created.expiresAt?.slice(0, 10), "2027-03-04");
    });

    it("leaves the expiry alone when a patch does not mention it", async () => {
      const aloha = await giftCardIdOf(TENANT_A, "Aloha");

      const updated = await runAsTenant(TENANT_A, () => updateGiftCard(aloha, { value: 120 }));

      assert.equal(updated.value, "120.00");
      assert.equal(updated.expiresAt, "2027-01-31T00:00:00.000Z", "absent means unchanged");
    });

    it("clears the expiry when a patch sends null", async () => {
      const aloha = await giftCardIdOf(TENANT_A, "Aloha");

      const updated = await runAsTenant(TENANT_A, () => updateGiftCard(aloha, { expiresAt: null }));

      assert.equal(updated.expiresAt, null);
      // And the remark, which the patch did not mention, is still there.
      assert.equal(updated.remark, "Christmas promotion");
    });

    it("cannot update another tenant's card", async () => {
      const foreign = await giftCardIdOf(TENANT_B, "Aloha");

      await assert.rejects(
        runAsTenant(TENANT_A, () => updateGiftCard(foreign, { value: 1 })),
        /does not exist/,
      );
    });
  },
);
