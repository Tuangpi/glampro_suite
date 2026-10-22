import {
  treatmentConsentEventSchema,
  treatmentConsentFormSchema,
  treatmentSignatureSchema,
  treatmentPhotoSchema,
  treatmentRecordSchema,
  treatmentRedemptionOptionSchema,
  type TreatmentRedemptionQuery,
  type CreateTreatmentConsentEventInput,
  type CreateTreatmentConsentFormInput,
  type CreateTreatmentPhotoInput,
  type CreateTreatmentRecordInput,
  type TreatmentConsentEvent,
  type TreatmentConsentForm,
  type TreatmentPhoto,
  type TreatmentRecord,
  type UpdateTreatmentRecordInput,
  type ReviewTreatmentRetentionInput,
} from "@glampro_suite/shared";
import { badRequest, conflict, forbidden, notFound } from "../lib/http-error.js";
import { prisma } from "../lib/prisma.js";
import { paginated, parsePagination } from "../utils/pagination.js";
import { currentScope } from "../lib/tenant-context.js";

/** Lists treatment records for a tenant, optionally filtered by customer/type/status. */
export async function listTreatmentRecords(query: {
  customerId?: string;
  treatmentType?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}) {
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
        packageRedemption: { select: { revertedAt: true } },
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
        retentionReviewAt: row.retentionReviewAt?.toISOString() ?? null,
        retentionReviewedAt: row.retentionReviewedAt?.toISOString() ?? null,
        photos: row.photos.map((photo) => ({ ...photo, createdAt: photo.createdAt.toISOString() })),
        packageRedemptionRevertedAt: row.packageRedemption?.revertedAt?.toISOString() ?? null,
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
      packageRedemption: { select: { revertedAt: true } },
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
        orderBy: [{ consentedAt: "desc" }, { id: "desc" }],
      },
    },
  });
  if (!row) throw notFound("That treatment record does not exist.", "TREATMENT_NOT_FOUND");
  return treatmentRecordSchema.parse({
    ...row,
    consentEvents: row.consentEvents.map(serializeConsentEvent),
    retentionReviewAt: row.retentionReviewAt?.toISOString() ?? null,
    retentionReviewedAt: row.retentionReviewedAt?.toISOString() ?? null,
    photos: row.photos.map((photo) => ({ ...photo, createdAt: photo.createdAt.toISOString() })),
    packageRedemptionRevertedAt: row.packageRedemption?.revertedAt?.toISOString() ?? null,
    startedAt: row.startedAt?.toISOString() ?? null,
    endedAt: row.endedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

type TreatmentTransaction = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** Eligible evidence only. Listing never reserves a redemption or changes balances. */
export async function listTreatmentRedemptions(query: TreatmentRedemptionQuery) {
  const scope = currentScope();
  if (scope?.kind !== "tenant") throw forbiddenScope();
  const customer = await prisma.customer.findFirst({ where: { id: query.customerId } });
  if (!customer) throw notFound("That customer does not exist.", "CUSTOMER_NOT_FOUND");
  const paging = parsePagination(query);
  const holdings = await prisma.customerPackageHolding.findMany({
    where: { customerId: query.customerId },
    include: {
      package: {
        include: { services: { include: { service: { select: { id: true, name: true } } } } },
      },
    },
  });
  const eligible = holdings
    .map((holding) => ({
      holding,
      services: holding.package.services
        .map((link) => link.service)
        .filter((service) => !query.serviceId || service.id === query.serviceId),
    }))
    .filter(({ services }) => services.length > 0);
  const where = {
    customerId: query.customerId,
    tenantId: scope.tenantId,
    itemType: "PACKAGE" as const,
    revertedAt: null,
    quantity: { gt: 0 },
    treatmentRecord: { is: null },
    OR: eligible.map(({ holding, services }) => ({
      holdingId: holding.id,
      itemId: holding.packageId,
      sale: {
        tenantId: scope.tenantId,
        customerId: query.customerId,
        status: "COMPLETED" as const,
        lines: {
          some: {
            tenantId: scope.tenantId,
            itemType: "SERVICE" as const,
            itemId: { in: services.map((service) => service.id) },
          },
        },
      },
    })),
  };
  const [rows, total] = await Promise.all([
    prisma.customerRedemption.findMany({
      where,
      skip: paging.skip,
      take: paging.take,
      orderBy: [{ usedAt: "desc" }, { id: "desc" }],
      include: {
        sale: {
          select: {
            receiptNumber: true,
            lines: {
              where: { tenantId: scope.tenantId, itemType: "SERVICE" },
              select: { itemId: true },
            },
          },
        },
      },
    }),
    prisma.customerRedemption.count({ where }),
  ]);
  return paginated(
    rows.map((row) => {
      const match = eligible.find(({ holding }) => holding.id === row.holdingId)!;
      return treatmentRedemptionOptionSchema.parse({
        id: row.id,
        receiptNumber: row.sale.receiptNumber,
        usedAt: row.usedAt.toISOString(),
        packageName: match.holding.package.name,
        quantity: row.quantity,
        services: match.services.filter((service) =>
          row.sale.lines.some((line) => line.itemId === service.id),
        ),
      });
    }),
    total,
    paging,
  );
}

/** Links evidence only. POS remains the sole owner of all balance mutations. */
async function resolvePackageLink(
  tx: TreatmentTransaction,
  customerId: string,
  serviceId: string | null,
  redemptionId: string | null,
  quantity: number | undefined,
  recordId?: string,
) {
  if (!redemptionId) {
    if (quantity !== undefined && quantity !== 0) {
      throw badRequest(
        "Link a POS package redemption before recording sessions.",
        undefined,
        "REDEMPTION_REQUIRED",
      );
    }
    return { packageRedemptionId: null, packageHoldingId: null, quantityConsumed: 0 };
  }
  const redemption = await tx.customerRedemption.findFirst({
    where: { id: redemptionId, customerId, itemType: "PACKAGE" },
    include: {
      sale: { select: { status: true, lines: { select: { itemType: true, itemId: true } } } },
    },
  });
  if (!redemption || !redemption.holdingId)
    throw notFound("That POS package redemption does not exist.", "REDEMPTION_NOT_FOUND");
  // Same holding lock as POS: a concurrent reversal cannot race eligibility checks.
  await tx.customerPackageHolding.updateMany({
    where: { id: redemption.holdingId, customerId },
    data: { quantityRemaining: { increment: 0 } },
  });
  const current = await tx.customerRedemption.findFirst({
    where: { id: redemptionId, customerId },
    include: { sale: { select: { status: true } } },
  });
  if (!current || current.revertedAt || current.sale.status !== "COMPLETED")
    throw conflict("That POS redemption has been reversed.", "REDEMPTION_REVERSED");
  const holding = await tx.customerPackageHolding.findFirst({
    where: { id: redemption.holdingId, customerId, packageId: redemption.itemId },
    include: { package: { select: { services: { select: { serviceId: true } } } } },
  });
  if (!holding) throw notFound("That package holding does not exist.", "HOLDING_NOT_FOUND");
  if (
    !serviceId ||
    !holding.package.services.some((link) => link.serviceId === serviceId) ||
    !redemption.sale.lines.some((line) => line.itemType === "SERVICE" && line.itemId === serviceId)
  ) {
    throw badRequest(
      "The treatment service must be covered by the redeemed package and present on its POS sale.",
      undefined,
      "REDEMPTION_SERVICE_MISMATCH",
    );
  }
  const existing = await tx.treatmentRecord.findFirst({
    where: { packageRedemptionId: redemptionId, ...(recordId ? { id: { not: recordId } } : {}) },
  });
  if (existing)
    throw conflict(
      "That POS redemption is already linked to a treatment.",
      "REDEMPTION_ALREADY_LINKED",
    );
  if (quantity !== undefined && quantity !== 0 && quantity !== redemption.quantity)
    throw badRequest(
      "Sessions must match the whole POS redemption.",
      undefined,
      "REDEMPTION_QUANTITY_MISMATCH",
    );
  return {
    packageRedemptionId: redemptionId,
    packageHoldingId: holding.id,
    quantityConsumed: redemption.quantity,
  };
}

/** Creates a clinical record linked to POS evidence, never another deduction. */
export async function createTreatmentRecord(
  input: CreateTreatmentRecordInput,
): Promise<TreatmentRecord> {
  const scope = currentScope();
  if (scope?.kind !== "tenant") throw forbiddenScope();

  const customer = await prisma.customer.findFirst({
    where: { id: input.customerId },
  });
  if (!customer) throw notFound("That customer does not exist.", "CUSTOMER_NOT_FOUND");

  const row = await prisma
    .$transaction(async (tx) => {
      const link = await resolvePackageLink(
        tx,
        input.customerId,
        input.serviceId ?? null,
        input.packageRedemptionId ?? null,
        input.quantityConsumed,
      );
      return tx.treatmentRecord.create({
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
          ...link,
        },
        include: {
          packageRedemption: { select: { revertedAt: true } },
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
    })
    .catch((error: unknown) => {
      if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
        throw conflict(
          "That POS redemption is already linked to a treatment.",
          "REDEMPTION_ALREADY_LINKED",
        );
      }
      throw error;
    });
  return treatmentRecordSchema.parse({
    ...row,
    photos: row.photos.map((photo) => ({ ...photo, createdAt: photo.createdAt.toISOString() })),
    retentionReviewAt: row.retentionReviewAt?.toISOString() ?? null,
    retentionReviewedAt: row.retentionReviewedAt?.toISOString() ?? null,
    packageRedemptionRevertedAt: row.packageRedemption?.revertedAt?.toISOString() ?? null,
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
  input: UpdateTreatmentRecordInput,
): Promise<TreatmentRecord> {
  const scope = currentScope();
  if (scope?.kind !== "tenant") throw forbiddenScope();

  const row = await prisma
    .$transaction(async (tx) => {
      await tx.treatmentRecord.updateMany({
        where: { id },
        data: { quantityConsumed: { increment: 0 } },
      });
      const existing = await tx.treatmentRecord.findFirst({
        where: { id },
      });
      if (!existing) throw notFound("That treatment record does not exist.", "TREATMENT_NOT_FOUND");

      const changingLink =
        input.packageRedemptionId !== undefined || input.quantityConsumed !== undefined;
      const link = changingLink
        ? await resolvePackageLink(
            tx,
            existing.customerId,
            existing.serviceId,
            input.packageRedemptionId === undefined
              ? existing.packageRedemptionId
              : input.packageRedemptionId,
            input.quantityConsumed,
            id,
          )
        : {};
      return tx.treatmentRecord.update({
        where: { id },
        data: {
          treatmentType: input.treatmentType ?? undefined,
          status: input.status,
          notes: input.notes,
          startedAt: input.startedAt
            ? new Date(input.startedAt)
            : input.startedAt === null
              ? null
              : undefined,
          endedAt: input.endedAt
            ? new Date(input.endedAt)
            : input.endedAt === null
              ? null
              : undefined,
          ...link,
        },
        include: {
          packageRedemption: { select: { revertedAt: true } },
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
    })
    .catch((error: unknown) => {
      if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
        throw conflict(
          "That POS redemption is already linked to a treatment.",
          "REDEMPTION_ALREADY_LINKED",
        );
      }
      throw error;
    });
  return treatmentRecordSchema.parse({
    ...row,
    photos: row.photos.map((photo) => ({ ...photo, createdAt: photo.createdAt.toISOString() })),
    retentionReviewAt: row.retentionReviewAt?.toISOString() ?? null,
    retentionReviewedAt: row.retentionReviewedAt?.toISOString() ?? null,
    packageRedemptionRevertedAt: row.packageRedemption?.revertedAt?.toISOString() ?? null,
    startedAt: row.startedAt?.toISOString() ?? null,
    endedAt: row.endedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

/** Records a manual retention review; never authorizes disposal. */
export async function reviewTreatmentRetention(
  id: string,
  input: ReviewTreatmentRetentionInput,
  actorId: string,
): Promise<TreatmentRecord> {
  const scope = currentScope();
  if (scope?.kind !== "tenant") throw forbiddenScope();
  await prisma.$transaction(async (tx) => {
    // Shared with deletion/capture: no successful review can race a successful deletion.
    await tx.$queryRaw`SELECT id FROM treatment_records WHERE id = ${id} AND "tenantId" = ${scope.tenantId} FOR UPDATE`;
    const record = await tx.treatmentRecord.findFirst({ where: { id } });
    if (!record) throw notFound("That treatment record does not exist.", "TREATMENT_NOT_FOUND");
    await tx.treatmentRecord.update({
      where: { id },
      data: {
        retentionReviewAt: new Date(input.reviewAt),
        retentionReason: input.reason,
        retentionReviewedAt: new Date(),
        retentionReviewedById: actorId,
        retentionHold: input.hold,
        retentionHoldReason: input.hold ? input.holdReason : null,
      },
    });
  });
  return getTreatmentRecord(id);
}

/** Deletes only unheld treatment records without consent evidence. */
export async function deleteTreatmentRecord(id: string): Promise<void> {
  const scope = currentScope();
  if (scope?.kind !== "tenant") throw forbiddenScope();

  await prisma.$transaction(async (tx) => {
    // Consent capture takes the same row lock: either deletion wins before any
    // evidence exists, or the committed decision prevents deletion.
    await tx.$queryRaw`SELECT id FROM treatment_records WHERE id = ${id} AND "tenantId" = ${scope.tenantId} FOR UPDATE`;
    const existing = await tx.treatmentRecord.findFirst({ where: { id } });
    if (!existing) throw notFound("That treatment record does not exist.", "TREATMENT_NOT_FOUND");
    if (existing.retentionHold)
      throw conflict("This treatment has an active retention hold.", "TREATMENT_RETENTION_HOLD");
    const evidence = await tx.treatmentConsentEvent.findFirst({
      where: { treatmentRecordId: id },
      select: { id: true },
    });
    if (evidence)
      throw conflict(
        "This treatment has consent evidence and cannot be deleted.",
        "TREATMENT_HAS_CONSENT_EVIDENCE",
      );
    await tx.treatmentRecord.delete({ where: { id } });
  });
}

/** Links an existing customer photo as a before/after photo on a treatment record. */
export async function addTreatmentPhoto(input: CreateTreatmentPhotoInput): Promise<TreatmentPhoto> {
  const scope = currentScope();
  if (scope?.kind !== "tenant") throw forbiddenScope();

  const record = await prisma.treatmentRecord.findFirst({ where: { id: input.treatmentRecordId } });
  if (!record) throw notFound("That treatment record does not exist.", "TREATMENT_NOT_FOUND");

  const photo = await prisma.customerPhoto.findFirst({
    where: { id: input.customerPhotoId },
  });
  if (!photo || photo.customerId !== record.customerId)
    throw notFound("That photo does not exist for this customer.", "PHOTO_NOT_FOUND");

  const existing = await prisma.treatmentPhoto.findFirst({
    where: { treatmentRecordId: input.treatmentRecordId, photoType: input.photoType },
  });
  if (existing)
    throw conflict(
      `A ${input.photoType.toLowerCase()} photo already exists for this treatment.`,
      "PHOTO_TYPE_EXISTS",
    );

  const row = await prisma.treatmentPhoto
    .create({
      data: {
        tenantId: scope.tenantId,
        treatmentRecordId: input.treatmentRecordId,
        customerPhotoId: input.customerPhotoId,
        photoType: input.photoType,
        caption: input.caption ?? null,
      },
    })
    .catch((error: unknown) => {
      if (error && typeof error === "object" && "code" in error && error.code === "P2002")
        throw conflict(
          "That photo type is already tagged for this treatment.",
          "PHOTO_TYPE_EXISTS",
        );
      throw error;
    });
  return treatmentPhotoSchema.parse({
    ...row,
    createdAt: row.createdAt.toISOString(),
  });
}

/** Removes a before/after photo link from a treatment record. */
export async function removeTreatmentPhoto(treatmentRecordId: string, id: string): Promise<void> {
  const scope = currentScope();
  if (scope?.kind !== "tenant") throw forbiddenScope();

  const existing = await prisma.treatmentPhoto.findFirst({ where: { id, treatmentRecordId } });
  if (!existing)
    throw notFound("That treatment photo does not exist.", "TREATMENT_PHOTO_NOT_FOUND");
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
export async function getActiveConsentForm(
  treatmentType: string,
): Promise<TreatmentConsentForm | null> {
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

  const row = await prisma.$transaction(async (tx) => {
    // The tenant row exists even for a type's first form. Serialize publishers
    // before reading the next version, including inactive draft publication.
    // NO KEY UPDATE still serializes publishers without blocking event inserts'
    // tenant foreign-key checks while a publisher waits for their form lock.
    await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${scope.tenantId} FOR NO KEY UPDATE`;
    const latest = await tx.treatmentConsentForm.findFirst({
      where: { treatmentType: input.treatmentType },
      orderBy: { version: "desc" },
    });
    if (input.isActive !== false) {
      await tx.treatmentConsentForm.updateMany({
        where: { treatmentType: input.treatmentType, isActive: true },
        data: { isActive: false },
      });
    }
    return tx.treatmentConsentForm.create({
      data: {
        tenantId: scope.tenantId,
        treatmentType: input.treatmentType,
        title: input.title,
        content: input.content,
        signatureRequired: input.signatureRequired ?? false,
        version: (latest?.version ?? 0) + 1,
        isActive: input.isActive ?? true,
      },
    });
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

  const row = await prisma
    .$transaction(async (tx) => {
      // Serialize decisions against treatment edits/deletion and one another.
      // Lock the form too, so publication cannot deactivate it between check/write.
      await tx.$queryRaw`SELECT id FROM treatment_records WHERE id = ${input.treatmentRecordId} AND "tenantId" = ${scope.tenantId} FOR UPDATE`;
      const record = await tx.treatmentRecord.findFirst({ where: { id: input.treatmentRecordId } });
      if (!record) throw notFound("That treatment record does not exist.", "TREATMENT_NOT_FOUND");
      const customer = await tx.customer.findFirst({ where: { id: input.customerId } });
      if (!customer) throw notFound("That customer does not exist.", "CUSTOMER_NOT_FOUND");
      if (record.customerId !== customer.id)
        throw badRequest(
          "Consent must belong to the treatment customer.",
          undefined,
          "CONSENT_CUSTOMER_MISMATCH",
        );

      await tx.$queryRaw`SELECT id FROM treatment_consent_forms WHERE id = ${input.treatmentConsentFormId} AND "tenantId" = ${scope.tenantId} FOR UPDATE`;
      const form = await tx.treatmentConsentForm.findFirst({
        where: { id: input.treatmentConsentFormId },
      });
      if (!form) throw notFound("That consent form does not exist.", "CONSENT_FORM_NOT_FOUND");
      if (form.treatmentType !== record.treatmentType)
        throw badRequest(
          "The consent form must cover this treatment type.",
          undefined,
          "CONSENT_TYPE_MISMATCH",
        );

      const existing = await tx.treatmentConsentEvent.findFirst({
        where: { treatmentRecordId: record.id, treatmentConsentFormId: form.id },
        orderBy: [{ consentedAt: "desc" }, { id: "desc" }],
      });
      if ((input.previousEventId ?? null) !== (existing?.id ?? null))
        throw conflict(
          "Consent history changed. Reload evidence before recording another event.",
          "CONSENT_EVENT_EXISTS",
        );
      const lastDecision = await tx.treatmentConsentEvent.findFirst({
        where: {
          treatmentRecordId: record.id,
          treatmentConsentFormId: form.id,
          eventType: { not: "CORRECTION" },
        },
        orderBy: [{ consentedAt: "desc" }, { id: "desc" }],
      });
      const eventType = input.eventType ?? (input.consented ? "GRANT" : "DECLINE");
      const isGrant = eventType === "GRANT" || eventType === "RECONSENT";
      if (eventType === "CORRECTION") {
        const actor = await tx.user.findFirst({ where: { id: actorId, disabled: false } });
        if (!actor || !["SUPER_ADMIN", "MANAGER"].includes(actor.globalRole))
          throw forbidden("Only an owner or manager can annotate consent evidence.");
        const original = await tx.treatmentConsentEvent.findFirst({
          where: {
            id: input.correctsEventId ?? "",
            treatmentRecordId: record.id,
            treatmentConsentFormId: form.id,
          },
        });
        if (
          !original ||
          !input.reason?.trim() ||
          input.consented !== (lastDecision?.consented ?? false)
        )
          throw badRequest(
            "Corrections need an original event and reason, and cannot change consent.",
          );
      } else {
        if (input.correctsEventId || input.consented !== isGrant)
          throw badRequest("Consent decision does not match the event type.");
        if (
          (eventType === "GRANT" && lastDecision) ||
          (eventType === "RECONSENT" && (!lastDecision || lastDecision.consented)) ||
          (eventType === "WITHDRAWAL" && !lastDecision?.consented) ||
          (eventType === "DECLINE" && lastDecision)
        )
          throw conflict(
            "That consent transition is not available. Reload evidence.",
            "CONSENT_TRANSITION_INVALID",
          );
      }
      if (!form.isActive && eventType !== "WITHDRAWAL" && eventType !== "CORRECTION")
        throw conflict(
          "That consent form is no longer active. Reload the current form.",
          "CONSENT_FORM_INACTIVE",
        );
      if (isGrant && form.signatureRequired && !input.signatureData)
        throw badRequest(
          "This form version requires a drawn customer signature.",
          undefined,
          "CONSENT_SIGNATURE_REQUIRED",
        );
      if (!isGrant && input.signatureData)
        throw badRequest("Signatures are only captured for grant or re-consent.");
      if (input.signatureData) {
        let valid = false;
        try {
          valid =
            input.signatureData.length <= 200000 &&
            treatmentSignatureSchema.safeParse(JSON.parse(input.signatureData)).success;
        } catch {
          /* Reject malformed evidence, including service callers. */
        }
        if (!valid) throw badRequest("Invalid drawn signature.");
      }

      return tx.treatmentConsentEvent.create({
        data: {
          tenantId: scope.tenantId,
          treatmentRecordId: record.id,
          treatmentConsentFormId: form.id,
          customerId: record.customerId,
          consented: input.consented,
          eventType,
          previousEventId: existing?.id ?? null,
          correctsEventId: input.correctsEventId ?? null,
          reason: input.reason?.trim() ?? null,
          consentedById: actorId,
          signatureData: input.signatureData ? Buffer.from(input.signatureData, "utf8") : null,
          // Keep chain ordering strict even when multiple writes share a millisecond.
          consentedAt: new Date(Math.max(Date.now(), (existing?.consentedAt.getTime() ?? 0) + 1)),
        },
        include: { treatmentConsentForm: true },
      });
    })
    .catch((error: unknown) => {
      if (error && typeof error === "object" && "code" in error && error.code === "P2002")
        throw conflict(
          "A consent event already exists for this treatment and form.",
          "CONSENT_EVENT_EXISTS",
        );
      throw error;
    });
  return serializeConsentEvent(row);
}

/** Lists consent events for a treatment record. */
export async function listConsentEvents(
  treatmentRecordId: string,
): Promise<TreatmentConsentEvent[]> {
  const record = await prisma.treatmentRecord.findFirst({ where: { id: treatmentRecordId } });
  if (!record) throw notFound("That treatment record does not exist.", "TREATMENT_NOT_FOUND");
  const rows = await prisma.treatmentConsentEvent.findMany({
    where: { treatmentRecordId },
    orderBy: [{ consentedAt: "desc" }, { id: "desc" }],
    include: { treatmentConsentForm: true },
  });
  return rows.map(serializeConsentEvent);
}

type ConsentEventRow = Awaited<ReturnType<typeof prisma.treatmentConsentEvent.findMany>>[number];
type ConsentFormRow = Awaited<ReturnType<typeof prisma.treatmentConsentForm.findMany>>[number];

function serializeConsentEvent(
  row: ConsentEventRow & { treatmentConsentForm: ConsentFormRow },
): TreatmentConsentEvent {
  return treatmentConsentEventSchema.parse({
    ...row,
    consentedAt: row.consentedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    signatureData: row.signatureData ? Buffer.from(row.signatureData).toString("utf8") : null,
    treatmentConsentForm: {
      ...row.treatmentConsentForm,
      createdAt: row.treatmentConsentForm.createdAt.toISOString(),
      updatedAt: row.treatmentConsentForm.updatedAt.toISOString(),
    },
  });
}
