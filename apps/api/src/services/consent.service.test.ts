import "dotenv/config";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "../lib/prisma.js";
import { runAsPlatform, runAsTenant } from "../lib/tenant-context.js";
import {
  configurePrivacyNotice,
  getCustomerConsent,
  getPrivacyNotice,
  recordCustomerConsent,
  requireMarketingConsent,
} from "./consent.service.js";

const tenants = ["consent-test-a", "consent-test-b"];
const noticeInput = {
  version: "v1",
  dataConsentText: "Approved data purpose and withdrawal contact.",
  marketingConsentText: "Optional promotions and withdrawal contact.",
};
const ids = { a: "", b: "" };
async function purge() {
  await runAsPlatform(async () => {
    await prisma.customerConsentEvent.deleteMany({ where: { tenantId: { in: tenants } } });
    await prisma.tenant.deleteMany({ where: { id: { in: tenants } } });
  });
}
const inA = <T>(fn: () => T) => runAsTenant(tenants[0]!, fn);

describe(
  "consent service against PostgreSQL",
  { skip: process.env.DATABASE_URL ? false : "DATABASE_URL not set" },
  () => {
    before(async () => {
      await purge();
      await runAsPlatform(async () => {
        for (const id of tenants) await prisma.tenant.create({ data: { id, name: id, slug: id } });
        ids.a = (
          await prisma.customer.create({
            data: { tenantId: tenants[0]!, name: "Consent customer" },
          })
        ).id;
        ids.b = (
          await prisma.customer.create({
            data: { tenantId: tenants[1]!, name: "Foreign customer" },
          })
        ).id;
      });
    });
    after(purge);
    it("defaults to no choices and blocks grants before configuration", async () => {
      const data = await inA(() => getCustomerConsent(ids.a));
      assert.equal(data.pdpaConsent, false);
      assert.equal(data.marketingOptIn, false);
      assert.equal(data.revision, 0);
      assert.equal(data.currentNotice, null);
      assert.equal(data.total, 0);
      await assert.rejects(
        inA(() =>
          recordCustomerConsent(
            ids.a,
            { pdpaConsent: true, marketingOptIn: false, expectedRevision: 0, noticeId: null },
            "actor",
          ),
        ),
        { code: "PRIVACY_NOTICE_REQUIRED" },
      );
      await assert.rejects(
        inA(() => requireMarketingConsent(ids.a)),
        { code: "MARKETING_CONSENT_REQUIRED" },
      );
    });
    it("isolates customers and notices, with immutable tenant-local versions", async () => {
      await inA(() => configurePrivacyNotice(noticeInput, "manager-a"));
      assert.equal(await runAsTenant(tenants[1]!, getPrivacyNotice), null);
      await runAsTenant(tenants[1]!, () => configurePrivacyNotice(noticeInput, "manager-b"));
      await assert.rejects(
        inA(() => configurePrivacyNotice(noticeInput, "manager-a")),
        { code: "NOTICE_VERSION_EXISTS" },
      );
      await assert.rejects(
        inA(() => getCustomerConsent(ids.b)),
        { code: "CUSTOMER_NOT_FOUND" },
      );
      await assert.rejects(
        inA(() =>
          recordCustomerConsent(
            ids.b,
            { pdpaConsent: true, marketingOptIn: true, expectedRevision: 0, noticeId: null },
            "actor",
          ),
        ),
        { code: "CUSTOMER_NOT_FOUND" },
      );
    });
    it("records grants and withdrawals atomically and preserves exact wording", async () => {
      const notice = await inA(getPrivacyNotice);
      const grant = {
        pdpaConsent: true,
        marketingOptIn: true,
        expectedRevision: 0,
        noticeId: notice!.id,
      };
      const data = await inA(() => recordCustomerConsent(ids.a, grant, "staff-a"));
      assert.equal(data.revision, 1);
      assert.equal(data.history[0]?.recordedById, "staff-a");
      assert.equal(data.history[0]?.notice?.dataConsentText, noticeInput.dataConsentText);
      assert.ok(Date.parse(data.history[0]!.recordedAt));
      await inA(() => requireMarketingConsent(ids.a));
      await assert.rejects(
        inA(() => recordCustomerConsent(ids.a, grant, "stale-tab")),
        { code: "CONSENT_CHANGED" },
      );
      await inA(() =>
        configurePrivacyNotice(
          { ...noticeInput, version: "v2", dataConsentText: "New wording" },
          "manager-a",
        ),
      );
      const withdrawn = await inA(() =>
        recordCustomerConsent(
          ids.a,
          { pdpaConsent: false, marketingOptIn: false, expectedRevision: 1, noticeId: null },
          "staff-a",
        ),
      );
      assert.equal(withdrawn.revision, 2);
      assert.equal(withdrawn.total, 2);
      assert.equal(withdrawn.history[1]?.notice?.dataConsentText, noticeInput.dataConsentText);
      await assert.rejects(
        inA(() => requireMarketingConsent(ids.a)),
        { code: "MARKETING_CONSENT_REQUIRED" },
      );
      await assert.rejects(
        inA(() => recordCustomerConsent(ids.a, { ...grant, expectedRevision: 2 }, "staff-a")),
        { code: "PRIVACY_NOTICE_REQUIRED" },
      );
    });
    it("allows only one concurrent revision and paginates audit history", async () => {
      const notice = await inA(getPrivacyNotice);
      const input = {
        pdpaConsent: true,
        marketingOptIn: false,
        expectedRevision: 2,
        noticeId: notice!.id,
      };
      const outcomes = await Promise.allSettled([
        inA(() => recordCustomerConsent(ids.a, input, "staff-a")),
        inA(() => recordCustomerConsent(ids.a, input, "staff-b")),
      ]);
      assert.equal(outcomes.filter((result) => result.status === "fulfilled").length, 1);
      const data = await inA(() => getCustomerConsent(ids.a, 2, 1));
      assert.equal(data.total, 3);
      assert.equal(data.history.length, 1);
      assert.equal(data.history[0]?.revision, 2);
      const unchanged = await inA(() =>
        recordCustomerConsent(ids.a, { ...input, expectedRevision: 3 }, "staff-a"),
      );
      assert.equal(unchanged.total, 3);
    });
  },
);
