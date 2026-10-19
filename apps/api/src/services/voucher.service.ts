/**
 * Vouchers — manager-published discount campaigns, `/api/vouchers`.
 *
 * A voucher is catalogue-adjacent configuration, not tender and not a manual discount:
 * the till only ever sends a **code**, and `sale.service.ts` computes what it is worth
 * against the cart it is actually writing (ADR 0020). This service owns the campaign
 * rows themselves — the code, its window, its cap and its on/off switch.
 *
 * Reads are open to every signed-in member of the salon so the till can list what is
 * running; creating and changing one is a manager's act, enforced by `requireRole` on
 * the routes. Every function runs in the tenant scope opened by `middleware/auth.ts`,
 * so no function takes a tenant id.
 */
import {
  voucherListSchema,
  voucherSchema,
  type CreateVoucherInput,
  type UpdateVoucherInput,
  type Voucher,
  type VoucherList,
  type VoucherListQuery,
} from "@glampro_suite/shared";

import { badRequest, conflict, notFound } from "../lib/http-error.js";
import { prisma } from "../lib/prisma.js";

const VOUCHER_SELECT = {
  id: true,
  code: true,
  description: true,
  discountType: true,
  value: true,
  startsAt: true,
  endsAt: true,
  minSpend: true,
  maxRedemptions: true,
  redeemedCount: true,
  isActive: true,
  createdAt: true,
} as const;

function findVoucherRow(id: string) {
  return prisma.voucher.findFirst({ where: { id }, select: VOUCHER_SELECT });
}

type VoucherRow = NonNullable<Awaited<ReturnType<typeof findVoucherRow>>>;

/** A `Decimal(12,2)` on the wire is a string, so no cent is lost to a float. */
function money(value: { toFixed: (digits: number) => string }): string {
  return value.toFixed(2);
}

function toVoucher(row: VoucherRow): Voucher {
  return voucherSchema.parse({
    id: row.id,
    code: row.code,
    description: row.description,
    discountType: row.discountType,
    value: money(row.value),
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    minSpend: money(row.minSpend),
    maxRedemptions: row.maxRedemptions,
    redeemedCount: row.redeemedCount,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
  });
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

function codeTaken(code: string) {
  return conflict(`The code ${code} is already in use in this salon.`, "VOUCHER_CODE_TAKEN", [
    { path: "body.code", message: "That code is already in use." },
  ]);
}

/**
 * The stored row's own invariants, checked **after** a partial update is merged.
 *
 * `PATCH { endsAt }` cannot be judged on its own: whether it is after the start lives on
 * the row. The contract already refuses malformed values; this refuses a combination
 * that would store an unusable campaign.
 */
function assertConsistent(row: {
  discountType: "PERCENTAGE" | "FIXED";
  value: number | { toNumber: () => number };
  startsAt: Date;
  endsAt: Date;
}): void {
  const value = typeof row.value === "number" ? row.value : row.value.toNumber();
  if (row.discountType === "PERCENTAGE" && (value <= 0 || value > 100)) {
    throw badRequest("A percentage voucher must be greater than 0 and at most 100.", [
      { path: "body.value", message: "Use a percentage between 0.01 and 100." },
    ]);
  }
  if (row.discountType === "FIXED" && value <= 0) {
    throw badRequest("A fixed voucher must be worth something.", [
      { path: "body.value", message: "Enter an amount greater than 0." },
    ]);
  }
  if (row.endsAt.getTime() <= row.startsAt.getTime()) {
    throw badRequest("The voucher has to end after it starts.", [
      { path: "body.endsAt", message: "This has to be after the start." },
    ]);
  }
}

/**
 * Campaigns, newest first. `?search=` matches the code or the description, and the
 * default list hides switched-off codes; `?includeInactive=true` asks for everything.
 */
export async function listVouchers(query: VoucherListQuery): Promise<VoucherList> {
  const rows = await prisma.voucher.findMany({
    where: {
      ...(query.includeInactive ? {} : { isActive: true }),
      ...(query.search
        ? {
            OR: [
              { code: { contains: query.search.toUpperCase(), mode: "insensitive" as const } },
              { description: { contains: query.search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    select: VOUCHER_SELECT,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });

  return voucherListSchema.parse({ items: rows.map(toVoucher) });
}

export async function getVoucher(id: string): Promise<Voucher> {
  const row = await findVoucherRow(id);
  if (!row) throw notFound("That voucher does not exist.", "VOUCHER_NOT_FOUND");

  return toVoucher(row);
}

/** `POST /api/vouchers` — publish a campaign. The code is upper-cased by the contract. */
export async function createVoucher(
  input: CreateVoucherInput,
  createdById: string,
): Promise<Voucher> {
  try {
    const created = await prisma.voucher.create({
      data: {
        // Placeholder: `scopeCreateData` overwrites it with the scope's tenant.
        tenantId: "",
        code: input.code,
        description: input.description ?? null,
        discountType: input.discountType,
        value: input.value,
        startsAt: new Date(input.startsAt),
        endsAt: new Date(input.endsAt),
        minSpend: input.minSpend,
        maxRedemptions: input.maxRedemptions ?? null,
        isActive: input.isActive,
        createdById,
      },
      select: { id: true },
    });

    return getVoucher(created.id);
  } catch (error) {
    if (isUniqueViolation(error)) throw codeTaken(input.code);
    throw error;
  }
}

/** `PATCH /api/vouchers/:id` — partial edit; an absent field is left alone. */
export async function updateVoucher(id: string, input: UpdateVoucherInput): Promise<Voucher> {
  const existing = await findVoucherRow(id);
  if (!existing) throw notFound("That voucher does not exist.", "VOUCHER_NOT_FOUND");

  const next = {
    discountType: input.discountType ?? existing.discountType,
    value: input.value ?? existing.value,
    startsAt: input.startsAt ? new Date(input.startsAt) : existing.startsAt,
    endsAt: input.endsAt ? new Date(input.endsAt) : existing.endsAt,
  };
  assertConsistent(next);

  await prisma.voucher.update({
    where: { id },
    data: {
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.discountType !== undefined ? { discountType: input.discountType } : {}),
      ...(input.value !== undefined ? { value: input.value } : {}),
      ...(input.startsAt !== undefined ? { startsAt: new Date(input.startsAt) } : {}),
      ...(input.endsAt !== undefined ? { endsAt: new Date(input.endsAt) } : {}),
      ...(input.minSpend !== undefined ? { minSpend: input.minSpend } : {}),
      ...(input.maxRedemptions !== undefined ? { maxRedemptions: input.maxRedemptions } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
  });

  return getVoucher(id);
}
