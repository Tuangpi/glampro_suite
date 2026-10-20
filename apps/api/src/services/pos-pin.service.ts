import jwt from "jsonwebtoken";
import { createHash } from "node:crypto";
import { env } from "../lib/env.js";
import { forbidden } from "../lib/http-error.js";
import { verifyPassword } from "../lib/password.js";
import { prisma } from "../lib/prisma.js";
import { currentScope } from "../lib/tenant-context.js";

const ISSUER = "glampro-pos-identity";
const DUMMY = "$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

/** This assertion is not an access token and can never authorize an API request. */
export async function verifyPosPin(
  staffId: string,
  pin: string,
  operatorId: string,
  sessionToken: string,
) {
  const staff = await prisma.user.findFirst({
    where: { id: staffId },
    select: { id: true, name: true, disabled: true, posPinHash: true, posPinVersion: true },
  });
  const valid = await verifyPassword(pin, staff?.posPinHash ?? DUMMY);
  if (!staff || staff.disabled || !staff.posPinHash || !valid)
    throw forbidden("That staff member and PIN combination is not valid.", "INVALID_POS_PIN");
  const scope = currentScope();
  if (scope?.kind !== "tenant") throw new Error("POS PIN requires a tenant scope.");
  const token = jwt.sign(
    {
      staffId,
      operatorId,
      tenantId: scope.tenantId,
      version: staff.posPinVersion,
      sessionHash: createHash("sha256").update(sessionToken).digest("hex"),
    },
    env.jwtSecret,
    { algorithm: "HS256", issuer: ISSUER, expiresIn: 900 },
  );
  return { token, staffId, name: staff.name, expiresAt: Date.now() + 900_000 };
}

export async function posStaffFromToken(
  token: string | undefined,
  operatorId: string,
  sessionToken: string,
): Promise<string | undefined> {
  if (!token) return undefined;
  try {
    const claims = jwt.verify(token, env.jwtSecret, { algorithms: ["HS256"], issuer: ISSUER });
    const scope = currentScope();
    if (
      typeof claims === "string" ||
      scope?.kind !== "tenant" ||
      claims.tenantId !== scope.tenantId ||
      claims.operatorId !== operatorId ||
      claims.sessionHash !== createHash("sha256").update(sessionToken).digest("hex") ||
      typeof claims.staffId !== "string"
    )
      throw new Error("Invalid scope");
    const staff = await prisma.user.findFirst({
      where: { id: claims.staffId },
      select: { id: true, disabled: true, posPinVersion: true, posPinHash: true },
    });
    if (!staff || staff.disabled || !staff.posPinHash || staff.posPinVersion !== claims.version)
      throw new Error("Revoked identity");
    return staff.id;
  } catch {
    throw forbidden("Verify the staff PIN again before completing this sale.", "POS_PIN_EXPIRED");
  }
}
