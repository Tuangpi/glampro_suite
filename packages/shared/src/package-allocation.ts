/** Integer-cent allocation shared by POS preview and the authoritative API. */
export interface PackageAllocationLine {
  itemType: string;
  itemId: string;
  quantity: number;
  totalCents: number;
}
export interface PackageRules {
  mode: "PER_UNIT" | "SERVICE_SET";
  requirements: { serviceId: string; quantity: number }[];
}

export function allocatePackage(
  rules: PackageRules,
  sessionsRemaining: number,
  lines: readonly PackageAllocationLine[],
  allocated: readonly number[] = lines.map(() => 0),
) {
  const units = [...allocated];
  const needed = new Map(rules.requirements.map((row) => [row.serviceId, row.quantity]));
  let sessions = sessionsRemaining;
  if (rules.mode === "SERVICE_SET") {
    if (needed.size === 0) sessions = 0;
    for (const [id, quantity] of needed) {
      const available = lines.reduce(
        (sum, line, index) =>
          sum +
          (line.itemType === "SERVICE" && line.itemId === id
            ? line.quantity - (units[index] ?? 0)
            : 0),
        0,
      );
      sessions = Math.min(sessions, Math.floor(available / quantity));
    }
  }
  let used = 0;
  let cents = 0;
  const remaining = new Map([...needed].map(([id, quantity]) => [id, quantity * sessions]));
  for (const [index, line] of lines.entries()) {
    if (line.itemType !== "SERVICE" || !needed.has(line.itemId)) continue;
    const start = units[index] ?? 0;
    const take = Math.min(
      line.quantity - start,
      rules.mode === "SERVICE_SET" ? (remaining.get(line.itemId) ?? 0) : sessionsRemaining - used,
    );
    // Distribute residual cents to the first units; partial coverage stays exact.
    const unitCents = Math.floor(line.totalCents / line.quantity);
    const residual = line.totalCents % line.quantity;
    cents +=
      take * unitCents + Math.max(0, Math.min(start + take, residual) - Math.min(start, residual));
    units[index] = start + take;
    used += take;
    remaining.set(line.itemId, (remaining.get(line.itemId) ?? 0) - take);
  }
  return { cents, sessions: rules.mode === "SERVICE_SET" ? sessions : used, units };
}
