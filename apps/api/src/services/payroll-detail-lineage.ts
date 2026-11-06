import type { PayrollCloseTransaction } from "./payroll-close-store.js";

/** Read references only; approved snapshot money remains the reporting authority. */
export async function payrollDetailLineage(tx: PayrollCloseTransaction, sourceKeys: string[]) {
  const select = {
    id: true,
    sourceKey: true,
    sourceId: true,
    sourceType: true,
    saleId: true,
  } as const;
  const events = sourceKeys.length
    ? await tx.payrollSourceEvent.findMany({ where: { sourceKey: { in: sourceKeys } }, select })
    : [];
  const byId = new Map(events.map((row) => [row.id, row]));
  let pending = events.filter((row) => row.sourceType === "REVERSAL").map((row) => row.sourceId);
  // Batch each generation. Missing references and cycles stay unavailable, never
  // inferred from an unrelated package on the same receipt.
  const visited = new Set<string>();
  while (pending.length) {
    const ids = [...new Set(pending)].filter((id) => !visited.has(id));
    if (!ids.length) break;
    ids.forEach((id) => visited.add(id));
    const ancestors = await tx.payrollSourceEvent.findMany({ where: { id: { in: ids } }, select });
    ancestors.forEach((row) => byId.set(row.id, row));
    pending = ancestors.filter((row) => row.sourceType === "REVERSAL").map((row) => row.sourceId);
  }
  const roots = events.map((event) => {
    let root = event;
    const seen = new Set<string>();
    while (root.sourceType === "REVERSAL") {
      if (seen.has(root.id)) return { event, root: null };
      seen.add(root.id);
      const parent = byId.get(root.sourceId);
      if (!parent || parent.saleId !== event.saleId) return { event, root: null };
      root = parent;
    }
    return { event, root };
  });
  const sourceIds = roots.flatMap(({ root }) => (root ? [root.sourceId] : []));
  const sales = events.length
    ? await tx.sale.findMany({
        where: { id: { in: [...new Set(events.map((row) => row.saleId))] } },
        select: { id: true, customerId: true },
      })
    : [];
  const [redemptions, allocations, holdings] = sourceIds.length
    ? await Promise.all([
        tx.customerRedemption.findMany({
          where: { id: { in: sourceIds }, itemType: "PACKAGE" },
          select: { id: true, itemId: true },
        }),
        tx.commissionCollectionAllocation.findMany({
          where: { id: { in: sourceIds } },
          select: { id: true, saleLineId: true },
        }),
        tx.customerPackageHolding.findMany({
          where: { id: { in: sourceIds } },
          select: { id: true, packageId: true },
        }),
      ])
    : [[], [], []];
  const lines = sourceIds.length
    ? await tx.saleLine.findMany({
        where: {
          id: { in: [...sourceIds, ...allocations.map((row) => row.saleLineId)] },
          itemType: "PACKAGE",
        },
        select: { id: true, itemId: true },
      })
    : [];
  const packages = new Map([...redemptions, ...lines].map((row) => [row.id, row.itemId]));
  holdings.forEach((row) => packages.set(row.id, row.packageId));
  allocations.forEach((row) => {
    const line = lines.find((line) => line.id === row.saleLineId);
    if (line) packages.set(row.id, line.itemId);
  });
  return new Map(
    roots.map(({ event, root }) => [
      event.sourceKey,
      {
        saleId: event.saleId,
        customerId: sales.find((sale) => sale.id === event.saleId)?.customerId ?? null,
        packageId: root ? (packages.get(root.sourceId) ?? null) : null,
        sourceEventId: event.id,
        originalSourceEventId: root?.id ?? null,
        lineageAvailable: root !== null,
      },
    ]),
  );
}
