import {
  customerPhotoSchema,
  customerPurchaseSchema,
  customerVisitSchema,
  type PaginationQuery,
} from "@glampro_suite/shared";
import { badRequest, forbidden, notFound } from "../lib/http-error.js";
import { prisma } from "../lib/prisma.js";
import { paginated, parsePagination } from "../utils/pagination.js";
import { getCustomer } from "./customer.service.js";

export async function listCustomerVisits(id: string, query: PaginationQuery) {
  await getCustomer(id);
  const paging = parsePagination(query);
  const where = { customerId: id, startsAt: { lte: new Date() } };
  const [rows, total] = await Promise.all([
    prisma.appointment.findMany({
      where,
      skip: paging.skip,
      take: paging.take,
      orderBy: [{ startsAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        startsAt: true,
        endsAt: true,
        status: true,
        service: { select: { name: true } },
        staff: { select: { name: true } },
      },
    }),
    prisma.appointment.count({ where }),
  ]);
  return paginated(
    rows.map((row) =>
      customerVisitSchema.parse({
        ...row,
        startsAt: row.startsAt.toISOString(),
        endsAt: row.endsAt.toISOString(),
        service: row.service?.name ?? null,
        staff: row.staff?.name ?? null,
      }),
    ),
    total,
    paging,
  );
}

export async function listCustomerPurchases(id: string, query: PaginationQuery) {
  await getCustomer(id);
  const paging = parsePagination(query);
  // Held carts are not purchases. Voids remain visible, explicitly labelled.
  const where = {
    customerId: id,
    status: { in: ["COMPLETED", "VOID"] as ("COMPLETED" | "VOID")[] },
  };
  const [rows, total] = await Promise.all([
    prisma.sale.findMany({
      where,
      skip: paging.skip,
      take: paging.take,
      orderBy: [{ soldAt: "desc" }, { id: "desc" }],
      select: { id: true, soldAt: true, status: true, receiptNumber: true, totalAmount: true },
    }),
    prisma.sale.count({ where }),
  ]);
  return paginated(
    rows.map((row) =>
      customerPurchaseSchema.parse({
        ...row,
        soldAt: row.soldAt.toISOString(),
        total: row.totalAmount.toFixed(2),
      }),
    ),
    total,
    paging,
  );
}

const PHOTO_SELECT = { id: true, caption: true, createdAt: true, createdById: true } as const;
export async function listCustomerPhotos(id: string, query: PaginationQuery) {
  await getCustomer(id);
  const paging = parsePagination(query);
  const where = { customerId: id };
  const [rows, total] = await Promise.all([
    prisma.customerPhoto.findMany({
      where,
      skip: paging.skip,
      take: paging.take,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: PHOTO_SELECT,
    }),
    prisma.customerPhoto.count({ where }),
  ]);
  return paginated(
    rows.map((row) =>
      customerPhotoSchema.parse({ ...row, createdAt: row.createdAt.toISOString() }),
    ),
    total,
    paging,
  );
}

/** Only passive raster formats; never serve SVG/HTML or a caller's filename/type. */
export function photoMimeType(content: Buffer): string {
  if (content.length === 0 || content.length > 5 * 1024 * 1024) {
    throw badRequest("Choose a JPEG or PNG photo up to 5 MB.");
  }
  if (
    content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    content.length >= 24 &&
    content.toString("ascii", 12, 16) === "IHDR"
  ) {
    const width = content.readUInt32BE(16),
      height = content.readUInt32BE(20);
    if (width > 0 && height > 0 && width * height <= 40_000_000) return "image/png";
  }
  if (
    content.length >= 4 &&
    content[0] === 255 &&
    content[1] === 216 &&
    content[2] === 255 &&
    content.subarray(-2).equals(Buffer.from([255, 217]))
  )
    return "image/jpeg";
  throw badRequest("Only JPEG and PNG photos are supported.");
}

export async function addCustomerPhoto(
  id: string,
  content: Buffer,
  caption: string,
  actorId: string,
) {
  const mimeType = photoMimeType(content);
  // Consent and insert are one transaction. Withdrawal cannot race a new upload.
  return prisma.$transaction(async (tx) => {
    const customer = await tx.customer.findFirst({
      where: { id },
      select: { id: true, pdpaConsent: true },
    });
    if (!customer) throw notFound("That customer does not exist.", "CUSTOMER_NOT_FOUND");
    if (!customer.pdpaConsent)
      throw forbidden("Record data consent before uploading photos.", "DATA_CONSENT_REQUIRED");
    const locked = await tx.customer.updateMany({
      where: { id, pdpaConsent: true },
      data: { pdpaConsent: true },
    });
    if (!locked.count)
      throw forbidden("Record data consent before uploading photos.", "DATA_CONSENT_REQUIRED");
    const row = await tx.customerPhoto.create({
      data: {
        tenantId: "",
        customerId: id,
        content: new Uint8Array(content),
        mimeType,
        caption,
        createdById: actorId,
      },
      select: PHOTO_SELECT,
    });
    return customerPhotoSchema.parse({ ...row, createdAt: row.createdAt.toISOString() });
  });
}

export async function getCustomerPhoto(customerId: string, id: string) {
  await getCustomer(customerId);
  const row = await prisma.customerPhoto.findFirst({
    where: { id, customerId },
    select: { content: true, mimeType: true },
  });
  if (!row) throw notFound("That photo does not exist.");
  return row;
}

export async function deleteCustomerPhoto(customerId: string, id: string) {
  await getCustomer(customerId);
  const result = await prisma.customerPhoto.deleteMany({ where: { id, customerId } });
  if (!result.count) throw notFound("That photo does not exist.");
}
