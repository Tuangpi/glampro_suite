import { conflict } from "../lib/http-error.js";
import type { PayrollCloseTransaction } from "./payroll-close-store.js";

type Row<K extends "prepaidFamilyMember" | "prepaidFamilyEvent" | "prepaidFamily"> = Awaited<
  ReturnType<PayrollCloseTransaction[K]["findMany"]>
>[number];
export type PayrollValueSharing = {
  customerIds: string[];
  members: Row<"prepaidFamilyMember">[];
  events: Row<"prepaidFamilyEvent">[];
  families: Row<"prepaidFamily">[];
};
const fail = (): never => {
  throw conflict("Authoritative payroll inputs unavailable: VALUE_SHARING_HISTORY_UNCONFIRMED.");
};

/** Complete membership replay, never a current-membership historical fallback.
 * The independent balance journal is the explicit holding consent journal. */
export function verifyPayrollValueSharing(tenantId: string, evidence: PayrollValueSharing) {
  const customers = new Set(evidence.customerIds);
  const families = new Map(evidence.families.map((row) => [row.id, row]));
  if (
    customers.size !== evidence.customerIds.length ||
    families.size !== evidence.families.length ||
    evidence.families.some((row) => row.tenantId !== tenantId) ||
    new Set(evidence.events.map((row) => row.id)).size !== evidence.events.length ||
    new Set(evidence.members.map((row) => row.id)).size !== evidence.members.length ||
    evidence.events.some((row) => row.tenantId !== tenantId || !customers.has(row.customerId)) ||
    evidence.members.some((row) => row.tenantId !== tenantId || !customers.has(row.customerId))
  )
    return fail();
  const histories = new Map<string, Row<"prepaidFamilyEvent">[]>();
  for (const customerId of customers) {
    const events = evidence.events
      .filter((row) => row.customerId === customerId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    let familyId: string | null = null;
    let at = -Infinity;
    for (const row of events) {
      if (
        row.createdAt.getTime() <= at ||
        row.fromFamilyId !== familyId ||
        row.toFamilyId === familyId ||
        !row.actorId ||
        !row.reason.trim() ||
        (row.toFamilyId !== null &&
          (!families.has(row.toFamilyId) ||
            families.get(row.toFamilyId)!.createdAt > row.createdAt))
      )
        return fail();
      familyId = row.toFamilyId;
      at = row.createdAt.getTime();
    }
    const members = evidence.members.filter((row) => row.customerId === customerId);
    if (
      members.length !== (familyId === null ? 0 : 1) ||
      (familyId !== null &&
        (members[0].familyId !== familyId ||
          members[0].createdAt.getTime() > at ||
          (events.length > 1 && members[0].createdAt <= events[events.length - 2].createdAt)))
    )
      return fail();
    histories.set(customerId, events);
  }
  return {
    familyAt(customerId: string, at: Date): string | null {
      const events = histories.get(customerId);
      if (!events) return fail();
      return events.filter((row) => row.createdAt <= at).at(-1)?.toFamilyId ?? null;
    },
    // Membership departure withdraws consent. Rejoining never revives it.
    assertConsentInterval(customerId: string, familyId: string, from: Date, until?: Date) {
      const events = histories.get(customerId);
      if (!events) return fail();
      if (events.some((row) => row.createdAt > from && (!until || row.createdAt < until)))
        return fail();
      if (this.familyAt(customerId, from) !== familyId) return fail();
    },
  };
}
