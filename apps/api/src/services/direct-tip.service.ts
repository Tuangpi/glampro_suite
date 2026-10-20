import { directTipListSchema, type RecordDirectTipInput } from "@glampro_suite/shared";
import { prisma } from "../lib/prisma.js";
import { conflict, notFound } from "../lib/http-error.js";
import { Prisma } from "../../generated/prisma/client.js";

export async function listDirectTips(saleId: string) {
  const sale = await prisma.sale.findFirst({ where: { id: saleId }, select: { id: true } });
  if (!sale) throw notFound("That sale does not exist.", "SALE_NOT_FOUND");
  const rows = await prisma.directStaffTip.findMany({
    where: { saleId },
    orderBy: [{ recordedAt: "asc" }, { id: "asc" }],
  });
  return directTipListSchema.parse({
    items: rows.map((row) => ({
      ...row,
      amount: row.amount.toFixed(2),
      recordedAt: row.recordedAt.toISOString(),
      returnedAt: row.returnedAt?.toISOString() ?? null,
    })),
  });
}

export async function recordDirectTip(
  saleId: string,
  input: RecordDirectTipInput,
  actorId: string,
) {
  await prisma.$transaction(async (tx) => {
    // Same sale lock as void/refund: eligibility and retry checks are post-lock.
    const locked = await tx.sale.updateMany({
      where: { id: saleId },
      data: { updatedAt: new Date() },
    });
    if (!locked.count) throw notFound("That sale does not exist.", "SALE_NOT_FOUND");
    const existing = await tx.directStaffTip.findFirst({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) {
      if (
        existing.saleId !== saleId ||
        existing.staffId !== input.staffId ||
        !existing.amount.equals(new Prisma.Decimal(input.amount))
      )
        throw conflict("This retry key belongs to a different tip.", "TIP_RETRY_MISMATCH");
      return;
    }
    const sale = await tx.sale.findFirst({
      where: { id: saleId },
      select: { tenantId: true, status: true, refund: { select: { id: true } } },
    });
    if (sale?.status !== "COMPLETED" || sale.refund)
      throw conflict("Record tips only on completed, unrefunded sales.", "TIP_SALE_NOT_ELIGIBLE");
    const staff = await tx.user.findFirst({
      where: { id: input.staffId, disabled: false },
      select: { id: true, name: true },
    });
    const actor = await tx.user.findFirst({
      where: { id: actorId, disabled: false },
      select: { name: true },
    });
    if (!staff || !actor)
      throw notFound("That active staff account does not exist.", "TIP_STAFF_NOT_FOUND");
    await tx.directStaffTip.create({
      data: {
        tenantId: sale.tenantId,
        saleId,
        ...input,
        staffName: staff.name,
        recordedById: actorId,
        recordedByName: actor.name,
      },
    });
  });
  return listDirectTips(saleId);
}

export async function returnDirectTip(
  saleId: string,
  tipId: string,
  reason: string,
  actorId: string,
) {
  await prisma.$transaction(async (tx) => {
    const actor = await tx.user.findFirst({
      where: { id: actorId, disabled: false },
      select: { name: true },
    });
    if (!actor) throw notFound("That staff account does not exist.", "TIP_STAFF_NOT_FOUND");
    const tip = await tx.directStaffTip.findFirst({
      where: { id: tipId, saleId },
      select: { id: true },
    });
    if (!tip) throw notFound("That tip does not exist.", "TIP_NOT_FOUND");
    // Count guard preserves the first return's audit on concurrent retries.
    await tx.directStaffTip.updateMany({
      where: { id: tipId, saleId, returnedAt: null },
      data: {
        returnedAt: new Date(),
        returnedById: actorId,
        returnedByName: actor.name,
        returnReason: reason,
      },
    });
  });
  return listDirectTips(saleId);
}
