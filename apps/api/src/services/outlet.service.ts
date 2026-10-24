import {
  outletSummarySchema,
  type CreateOutletInput,
  type UpdateOutletInput,
  type OutletAssignmentInput,
} from "@glampro_suite/shared";
import { prisma } from "../lib/prisma.js";
import { conflict, notFound } from "../lib/http-error.js";
import { currentScope } from "../lib/tenant-context.js";
import { Prisma } from "../../generated/prisma/client.js";
import { lockBookingCalendar } from "./messaging.service.js";

export async function listOutlets() {
  return (await prisma.outlet.findMany({ orderBy: [{ name: "asc" }, { id: "asc" }] })).map((row) =>
    outletSummarySchema.parse(row),
  );
}

async function writeOutlet(work: () => Promise<unknown>) {
  try {
    return outletSummarySchema.parse(await work());
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      throw conflict("That outlet slug is already in use.", "OUTLET_SLUG_TAKEN");
    }
    throw error;
  }
}

export async function createOutlet(input: CreateOutletInput) {
  const scope = currentScope();
  if (scope?.kind !== "tenant") throw new Error("Outlet creation requires a tenant scope.");
  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: scope.tenantId },
    select: { timeZone: true, locale: true },
  });
  return writeOutlet(() =>
    prisma.outlet.create({
      data: {
        tenantId: "",
        timeZone: tenant.timeZone,
        locale: tenant.locale,
        ...input,
        operatingHours: input.operatingHours === null ? Prisma.DbNull : input.operatingHours,
      },
    }),
  );
}

export async function updateOutlet(id: string, input: UpdateOutletInput) {
  if (!(await prisma.outlet.findFirst({ where: { id }, select: { id: true } }))) {
    throw notFound("That outlet does not exist.", "OUTLET_NOT_FOUND");
  }
  return writeOutlet(() =>
    prisma.$transaction(async (tx) => {
      await lockBookingCalendar(tx);
      return tx.outlet.update({
        where: { id },
        data: {
          ...input,
          operatingHours: input.operatingHours === null ? Prisma.DbNull : input.operatingHours,
        },
      });
    }),
  );
}

/** Assignment changes availability, never product quantity, credit or family membership. */
export async function assignOutlet(input: OutletAssignmentInput) {
  if (
    input.outletId &&
    !(await prisma.outlet.findFirst({
      where: { id: input.outletId, status: "ACTIVE" },
      select: { id: true },
    }))
  ) {
    throw notFound("That outlet is not available.", "OUTLET_NOT_FOUND");
  }
  const result =
    input.kind === "PRODUCT"
      ? await prisma.product.updateMany({
          where: { id: input.id },
          data: { outletId: input.outletId },
        })
      : await prisma.package.updateMany({
          where: { id: input.id },
          data: { outletId: input.outletId },
        });
  if (result.count !== 1) throw notFound("That catalogue item does not exist.");
  return { id: input.id, outletId: input.outletId };
}
