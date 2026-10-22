import { createHash } from "node:crypto";
import jwt from "jsonwebtoken";
import {
  disposeTreatmentSchema,
  type DisposeTreatmentInput,
  type TreatmentDisposalPreview,
  type TreatmentDisposalReceipt,
} from "@glampro_suite/shared";
import { prisma } from "../lib/prisma.js";
import { currentScope } from "../lib/tenant-context.js";
import { conflict, forbidden, notFound, badRequest } from "../lib/http-error.js";
import { env } from "../lib/env.js";
import { canWrite, resolveTenantStatus } from "../lib/tenant-status.js";

type Transaction = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

async function authorize(tx: Transaction, actorId: string) {
  const scope = currentScope();
  if (scope?.kind !== "tenant") throw forbidden("A salon owner session is required.");
  // Same tenant-first order as status writes; prevents concurrent suspension/role
  // changes from slipping between authorization and the destructive transaction.
  await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${scope.tenantId} FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM users WHERE id = ${actorId} AND "tenantId" = ${scope.tenantId} FOR SHARE`;
  const actor = await tx.user.findFirst({ where: { id: actorId } });
  if (!actor || actor.disabled || actor.globalRole !== "SUPER_ADMIN" || !actor.twoFactorEnabled)
    throw forbidden("Only the current salon owner can dispose of treatment records.");
  const tenant = await tx.tenant.findUnique({
    where: { id: scope.tenantId },
    include: {
      subscriptions: { orderBy: { endDate: "desc" }, take: 1, select: { endDate: true } },
    },
  });
  if (
    !tenant ||
    !canWrite(resolveTenantStatus(tenant.status, tenant.subscriptions[0]?.endDate ?? null))
  )
    throw forbidden("Disposal requires a writable salon.");
  return scope.tenantId;
}

async function snapshot(tx: Transaction, tenantId: string, id: string) {
  await tx.$queryRaw`SELECT id FROM treatment_records WHERE id = ${id} AND "tenantId" = ${tenantId} FOR UPDATE`;
  const record = await tx.treatmentRecord.findFirst({ where: { id } });
  if (!record) throw notFound("That treatment record does not exist.", "TREATMENT_NOT_FOUND");
  if (record.retentionHold)
    throw conflict(
      "Release the documented retention hold through retention review first.",
      "TREATMENT_RETENTION_HOLD",
    );
  if (record.status !== "COMPLETED" && record.status !== "CANCELLED")
    throw conflict(
      "Only completed or cancelled treatments can be disposed of.",
      "TREATMENT_DISPOSAL_STATUS",
    );
  // Existing unlink operations lock child rows; parent lock prevents new links.
  await tx.$queryRaw`SELECT id FROM treatment_photos WHERE "treatmentRecordId" = ${id} AND "tenantId" = ${tenantId} FOR UPDATE`;
  const photos = await tx.treatmentPhoto.findMany({
    where: { treatmentRecordId: id },
    orderBy: { id: "asc" },
  });
  const events = await tx.treatmentConsentEvent.findMany({
    where: { treatmentRecordId: id },
    orderBy: { id: "asc" },
    select: { id: true, signatureData: true },
  });
  const digest = createHash("sha256")
    .update(JSON.stringify({ record, photos, events }))
    .digest("hex");
  return {
    record,
    digest,
    consentEvents: events.length,
    signatures: events.filter((event) => event.signatureData !== null).length,
    photoLinks: photos.length,
  };
}

/** Read-only preview: no authorization request, record deletion or audit insert. */
export async function previewTreatmentDisposal(
  id: string,
  actorId: string,
): Promise<TreatmentDisposalPreview> {
  return prisma.$transaction(async (tx) => {
    const tenantId = await authorize(tx, actorId);
    const state = await snapshot(tx, tenantId, id);
    const expires = Math.floor(Date.now() / 1000) + 600;
    const previewToken = jwt.sign(
      { purpose: "treatment-disposal", tenantId, recordId: id, digest: state.digest, exp: expires },
      env.jwtSecret,
      { algorithm: "HS256", issuer: "glampro-treatment-disposal", subject: actorId },
    );
    return {
      treatmentRecordId: id,
      customerId: state.record.customerId,
      consentEvents: state.consentEvents,
      signatures: state.signatures,
      photoLinks: state.photoLinks,
      previewToken,
      expiresAt: new Date(expires * 1000).toISOString(),
    };
  });
}

export async function disposeTreatment(
  id: string,
  input: DisposeTreatmentInput,
  actorId: string,
): Promise<TreatmentDisposalReceipt> {
  if (!disposeTreatmentSchema.safeParse(input).success)
    throw badRequest("A valid preview, disposal reason and DISPOSE confirmation are required.");
  let claims: jwt.JwtPayload;
  try {
    const decoded = jwt.verify(input.previewToken, env.jwtSecret, {
      algorithms: ["HS256"],
      issuer: "glampro-treatment-disposal",
    });
    if (typeof decoded === "string") throw new Error("Invalid preview");
    claims = decoded;
  } catch {
    throw conflict(
      "The disposal preview is invalid or expired. Preview again.",
      "TREATMENT_DISPOSAL_STALE",
    );
  }
  return prisma.$transaction(async (tx) => {
    const tenantId = await authorize(tx, actorId);
    if (
      claims.purpose !== "treatment-disposal" ||
      claims.sub !== actorId ||
      claims.tenantId !== tenantId ||
      claims.recordId !== id
    )
      throw conflict(
        "The preview does not match this owner and treatment. Preview again.",
        "TREATMENT_DISPOSAL_STALE",
      );
    const state = await snapshot(tx, tenantId, id);
    if (
      claims.digest !== state.digest ||
      typeof claims.exp !== "number" ||
      claims.exp <= Math.floor(Date.now() / 1000)
    )
      throw conflict(
        "The treatment changed or the preview expired. Preview again.",
        "TREATMENT_DISPOSAL_STALE",
      );
    // One SQL statement removes the complete self-referencing chain, preserving
    // all other chains. No immutable-evidence UPDATE guard is disabled.
    await tx.treatmentConsentEvent.deleteMany({ where: { treatmentRecordId: id } });
    await tx.treatmentPhoto.deleteMany({ where: { treatmentRecordId: id } });
    await tx.treatmentRecord.delete({ where: { id } });
    // Existing platform audit model requires explicit tenant filtering for any reads.
    // Never copy clinical data, signatures, customer IDs or original photo references.
    const receipt = await tx.auditLog.create({
      data: {
        tenantId,
        action: "TREATMENT_DISPOSED",
        targetType: "TreatmentRecord",
        targetId: id,
        metadata: {
          actorUserId: actorId,
          reason: input.reason.trim(),
          consentEvents: state.consentEvents,
          signatures: state.signatures,
          photoLinks: state.photoLinks,
        },
      },
    });
    return {
      receiptId: receipt.id,
      treatmentRecordId: id,
      disposedAt: receipt.createdAt.toISOString(),
    };
  });
}
