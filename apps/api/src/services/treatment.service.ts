import {
  treatmentConsentEventSchema,
  treatmentConsentFormSchema,
  treatmentPhotoSchema,
  treatmentRecordSchema,
  type CreateTreatmentConsentEventInput,
  type CreateTreatmentConsentFormInput,
  type CreateTreatmentPhotoInput,
  type CreateTreatmentRecordInput,
  type TreatmentConsentEvent,
  type TreatmentConsentForm,
  type TreatmentPhoto,
  type TreatmentRecord,
} from "@glampro_suite/shared";
import { conflict, notFound } from "../lib/http-error.js";
import { prisma } from "../lib/prisma.js";
import { paginated, parsePagination } from "../utils/pagination.js";
import { currentScope } from "../lib/tenant-context.js";

/** Lists treatment records for a tenant, optionally filtered by customer/type/status. */
export async function listTreatmentRecords(
  query: {
    customerId?: string;
    treatmentType?: string;
    status?: string;
    page?: number;
    pageSize?: number;
  },
) {
  const paging = parsePagination(query);
  const where: Record<string, unknown> = {};
  if (query.customerId) where.customerId = query.customerId;
  if (query.treatmentType) where.treatmentType = query.treatmentType;
  if (query.status) where.status = query.status;

  const [rows, total] = await Promise.all([
    prisma.treatmentRecord.findMany({
      where,
      skip: paging.skip,
      take: paging.take,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: {
        customer: { select: { id: true, name: true } },
        staff: { select: { id: true, name: true } },
        service: { select: { id: true, name: true } },
        photos: {
          include: { customerPhoto: { select: { id: true, caption: true, createdAt: true } } },
        },
      },
    }),
    prisma.treatmentRecord.count({ where }),
  ]);

  return paginated(
    rows.map((row) =>
      treatmentRecordSchema.parse({
        ...row,
        startedAt: row.startedAt?.toISOString() ?? null,
        endedAt: row.endedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      }),
    ),
    total,
    paging,
  );
}

/** Gets a single treatment record with its photos and consent events. */
export async function getTreatmentRecord(id: string): Promise<TreatmentRecord> {
  const row = await prisma.treatmentRecord.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true } },
      staff: { select: { id: true, name: true } },
      service: { select: { id: true, name: true } },
      photos: {
        include: {
          customerPhoto: {
            select: { id: true, caption: true, createdAt: true },
          },
        },
      },
      consentEvents: {
        include: { treatmentConsentForm: true },
      },
    },
  });
  if (!row) throw notFound("That treatment record does not exist.", "TREATMENT_NOT_FOUND");
  return treatmentRecordSchema.parse({
    ...row,
    startedAt: row.startedAt?.toISOString() ?? null,
    endedAt: row.endedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

/** Creates a treatment record. Optionally consumes package sessions. */
export async function createTreatmentRecord(
  input: CreateTreatmentRecordInput,
): Promise<TreatmentRecord> {
  const scope = currentScope();
  if (scope?.kind !== "tenant") throw forbiddenScope();

  const customer = await prisma.customer.findFirst({
    where: { id: input.customerId },
  });
  if (!customer) throw notFound("That customer does not exist.", "CUSTOMER_NOT_FOUND");

  const row = await prisma.treatmentRecord.create({
    data: {
      tenantId: scope.tenantId,
      customerId: input.customerId,
      appointmentId: input.appointmentId ?? null,
      staffId: input.staffId ?? null,
      serviceId: input.serviceId ?? null,
      treatmentType: input.treatmentType,
      status: input.status,
      notes: input.notes ?? null,
      startedAt: input.startedAt ? new Date(input.startedAt) : null,
      endedAt: input.endedAt ? new Date(input.endedAt) : null,
      quantityConsumed: input.quantityConsumed ?? 0,
    },
    include: {
      customer: { select: { id: true, name: true } },
      staff: { select: { id: true, name: true } },
      service: { select: { id: true, name: true } },
      photos: {
        include: {
          customerPhoto: {
            select: { id: true, caption: true, createdAt: true },
          },
        },
      },
    },
  });
  return treatmentRecordSchema.parse({
    ...row,
    startedAt: row.startedAt?.toISOString() ?? null,
    endedAt: row.endedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

function forbiddenScope() {
  return new Error("No tenant scope: treatment queries are tenant-scoped.");
}
/** Updates a treatment record. */
export async function updateTreatmentRecord(
  id: string,
  input: {
    treatmentType?: string;
    status?: string;
    notes?: string | null;
    startedAt?: string | null;
    endedAt?: string | null;
    quantityConsumed?: number;
  },
): Promise<TreatmentRecord> {
  const scope = currentScope();
  if (scope?.kind !== "tenant") throw forbiddenScope();

  const existing = await prisma.treatmentRecord.findFirst({
    where: { id },
  });
  if (!existing) throw notFound("That treatment record does not exist.", "TREATMENT_NOT_FOUND");

  const row = await prisma.treatmentRecord.update({
    where: { id },
    data: {
      treatmentType: input.treatmentType ?? undefined,
      status: input.status as any,
      notes: input.notes ?? undefined,
      startedAt: input.startedAt ? new Date(input.startedAt) : input.startedAt === null ? null : undefined,
      endedAt: input.endedAt ? new Date(input.endedAt) : input.endedAt === null ? null : undefined,
      quantityConsumed: input.quantityConsumed ?? undefined,
    },
    include: {
      customer: { select: { id: true, name: true } },
      staff: { select: { id: true, name: true } },
      service: { select: { id: true, name: true } },
      photos: {
        include: {
          customerPhoto: {
            select: { id: true, caption: true, createdAt: true },
          },
        },
      },
    },
  });
  return treatmentRecordSchema.parse({
    ...row,
    startedAt: row.startedAt?.toISOString() ?? null,
    endedAt: row.endedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

/** Deletes a treatment record. */
export async function deleteTreatmentRecord(id: string): Promise<void> {
  const scope = currentScope();
  if (scope?.kind !== "tenant") throw forbiddenScope();

  const existing = await prisma.treatmentRecord.findFirst({ where: { id } });
  if (!existing) throw notFound("That treatment record does not exist.", "TREATMENT_NOT_FOUND");
  await prisma.treatmentRecord.delete({ where: { id } });
}

/** Links an existing customer photo as a before/after photo on a treatment record. */
export async function addTreatmentPhoto(
  input: CreateTreatmentPhotoInput,
): Promise<TreatmentPhoto> {
  const scope = currentScope();
  if (scope?.kind !== "tenant") throw forbiddenScope();

  const record = await prisma.treatmentRecord.findFirst({ where: { id: input.treatmentRecordId } });
  if (!record) throw notFound("That treatment record does not exist.", "TREATMENT_NOT_FOUND");

  const photo = await prisma.customerPhoto.findFirst({
    where: { id: input.customerPhotoId },
  });
  if (!photo) throw notFound("That photo does not exist.", "PHOTO_NOT_FOUND");

  const existing = await prisma.treatmentPhoto.findFirst({
    where: { treatmentRecordId: input.treatmentRecordId, photoType: input.photoType },
  });
  if (existing) throw conflict(
    `A ${input.photoType.toLowerCase()} photo already exists for this treatment.`,
    "PHOTO_TYPE_EXISTS",
  );

  const row = await prisma.treatmentPhoto.create({
    data: {
      tenantId: scope.tenantId,
      treatmentRecordId: input.treatmentRecordId,
      customerPhotoId: input.customerPhotoId,
      photoType: input.photoType,
      caption: input.caption ?? null,
    },
    include: { customerPhoto: true },
  });
  return treatmentPhotoSchema.parse({
    ...row,
    createdAt: row.createdAt.toISOString(),
  });
}

/** Removes a before/after photo link from a treatment record. */
export async function removeTreatmentPhoto(id: string): Promise<void> {
  const scope = currentScope();
  if (scope?.kind !== "tenant") throw forbiddenScope();

  const existing = await prisma.treatmentPhoto.findFirst({ where: { id } });
  if (!existing) throw notFound("That treatment photo does not exist.", "TREATMENT_PHOTO_NOT_FOUND");
  await prisma.treatmentPhoto.delete({ where: { id } });
}

/** Lists active treatment consent forms for a tenant, optionally filtered by treatment type. */
export async function listTreatmentConsentForms(query: {
  treatmentType?: string;
  isActive?: boolean;
}): Promise<TreatmentConsentForm[]> {
  const where: Record<string, unknown> = {};
  if (query.treatmentType) where.treatmentType = query.treatmentType;
  if (query.isActive !== undefined) where.isActive = query.isActive;

  const rows = await prisma.treatmentConsentForm.findMany({
    where,
    orderBy: [{ treatmentType: "asc" }, { version: "desc" }],
  });
  return rows.map((row) =>
    treatmentConsentFormSchema.parse({
      ...row,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }),
  );
}

/** Gets the latest active consent form for a treatment type. */
export async function getActiveConsentForm(treatmentType: string): Promise<TreatmentConsentForm | null> {
  const row = await prisma.treatmentConsentForm.findFirst({
    where: { treatmentType, isActive: true },
    orderBy: { version: "desc" },
  });
  if (!row) return null;
  return treatmentConsentFormSchema.parse({
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

/** Creates a new treatment consent form version. */
export async function createTreatmentConsentForm(
  input: CreateTreatmentConsentFormInput,
): Promise<TreatmentConsentForm> {
  const scope = currentScope();
  if (scope?.kind !== "tenant") throw forbiddenScope();

  const latest = await prisma.treatmentConsentForm.findFirst({
    where: { treatmentType: input.treatmentType },
    orderBy: { version: "desc" },
  });
  const version = (latest?.version ?? 0) + 1;

  if (input.isActive !== false) {
    await prisma.treatmentConsentForm.updateMany({
      where: { treatmentType: input.treatmentType, isActive: true },
      data: { isActive: false },
    });
  }

  const row = await prisma.treatmentConsentForm.create({
    data: {
      tenantId: scope.tenantId,
      treatmentType: input.treatmentType,
      title: input.title,
      content: input.content,
      version,
      isActive: input.isActive ?? true,
    },
  });
  return treatmentConsentFormSchema.parse({
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}
/** Records a customer's consent (or decline) to a treatment consent form. */
export async function recordTreatmentConsentEvent(
  input: CreateTreatmentConsentEventInput,
  actorId: string,
): Promise<TreatmentConsentEvent> {
  const scope = currentScope();
  if (scope?.kind !== "tenant") throw forbiddenScope();

  const record = await prisma.treatmentRecord.findFirst({
    where: { id: input.treatmentRecordId },
  });
  if (!record) throw notFound("That treatment record does not exist.", "TREATMENT_NOT_FOUND");

  const form = await prisma.treatmentConsentForm.findFirst({
    where: { id: input.treatmentConsentFormId },
  });
  if (!form) throw notFound("That consent form does not exist.", "CONSENT_FORM_NOT_FOUND");

  const customer = await prisma.customer.findFirst({ where: { id: input.customerId } });
  if (!customer) throw notFound("That customer does not exist.", "CUSTOMER_NOT_FOUND");

  const existing = await prisma.treatmentConsentEvent.findFirst({
    where: {
      treatmentRecordId: input.treatmentRecordId,
      treatmentConsentFormId: input.treatmentConsentFormId,
    },
  });
  if (existing) throw conflict(
    "A consent event already exists for this treatment and form.",
    "CONSENT_EVENT_EXISTS",
  );

  const row = await prisma.treatmentConsentEvent.create({
    data: {
      tenantId: scope.tenantId,
      treatmentRecordId: input.treatmentRecordId,
      treatmentConsentFormId: input.treatmentConsentFormId,
      customerId: input.customerId,
      consented: input.consented,
      consentedById: actorId,
      signatureData: null,
    },
    include: { treatmentConsentForm: true },
  });
  return treatmentConsentEventSchema.parse({
    ...row,
    consentedAt: row.consentedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    signatureData: null,
  });
}

/** Lists consent events for a treatment record. */
export async function listConsentEvents(treatmentRecordId: string): Promise<TreatmentConsentEvent[]> {
  const rows = await prisma.treatmentConsentEvent.findMany({
    where: { treatmentRecordId },
    orderBy: { consentedAt: "desc" },
    include: { treatmentConsentForm: true },
  });
  return rows.map((row) =>
    treatmentConsentEventSchema.parse({
      ...row,
      consentedAt: row.consentedAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      signatureData: null,
    }),
  );
}