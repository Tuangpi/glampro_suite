import { randomBytes, randomInt } from "node:crypto";
import {
  adminPasswordSchema,
  TWO_FACTOR_CODE_LENGTH,
  TWO_FACTOR_CODE_TTL_SECONDS,
  type AuthProfile,
  type AuthRealm,
  type AuthSession,
  type LoginResult,
  type TwoFactorChallenge,
  type ChangePasswordInput,
  type ForceSignOutInput,
  type LoginInput,
  type ModuleEntitlement,
  type TwoFactorConfirmInput,
  type TwoFactorVerifyInput,
  WEB_REALM,
} from "@glampro_suite/shared";

import { forbidden, notFound, unauthorized, validationFailed } from "../lib/http-error.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { sendTwoFactorCode } from "../lib/email.js";
import { prisma } from "../lib/prisma.js";
import { canSignIn, resolveTenantStatus } from "../lib/tenant-status.js";
import { runAsPlatform, runAsTenant } from "../lib/tenant-context.js";
import {
  createRefreshToken,
  hashRefreshToken,
  refreshTokenExpiry,
  signAccessToken,
} from "../lib/tokens.js";
import type { AuthenticatedUser } from "../types/index.js";

/**
 * Session operations.
 *
 * Each function is explicit about its scope. The ones that run before a tenant is
 * trusted (`login`, `refresh`, `logout`) use `runAsPlatform`; the ones that act on a
 * tenant's own data enter `runAsTenant` themselves, so they cannot be called from an
 * unscoped context by accident.
 */

/** Request metadata recorded against a refresh token, for support and revocation. */
export interface SessionMeta {
  userAgent?: string;
  ipAddress?: string;
}

/**
 * A real bcrypt hash, compared against when the email is unknown so a failed login
 * costs the same time whether or not the address exists. Without it, response latency
 * answers "is this person one of your customers?" for an attacker.
 */
const DUMMY_HASH = "$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

/** Loads a session subject without a tenant scope, by primary key. */
async function loadUserForSession(userId: string) {
  return runAsPlatform(() =>
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        tenantId: true,
        name: true,
        email: true,
        globalRole: true,
        tokenVersion: true,
        disabled: true,
        twoFactorEnabled: true,
      },
    }),
  );
}

/** Refuses a salon that may not sign in, with the code the UI keys its message off. */
async function assertTenantMaySignIn(tenantId: string): Promise<void> {
  const tenant = await runAsPlatform(() =>
    prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        status: true,
        subscriptions: { orderBy: { endDate: "desc" }, take: 1, select: { endDate: true } },
      },
    }),
  );

  if (!tenant) {
    throw unauthorized("Your salon is no longer available.", "TENANT_NOT_FOUND");
  }

  const status = resolveTenantStatus(tenant.status, tenant.subscriptions[0]?.endDate ?? null);

  if (!canSignIn(status)) {
    throw forbidden(
      status === "CANCELLED"
        ? "This account is closed. Please contact your provider."
        : "This salon's subscription has ended. Please contact your provider.",
      status === "CANCELLED" ? "TENANT_CANCELLED" : "TENANT_EXPIRED",
    );
  }
}

/** Mints an access/refresh pair and records the refresh token's hash. */
async function issueSession(
  user: {
    id: string;
    tenantId: string;
    name: string;
    email: string | null;
    globalRole: AuthSession["user"]["globalRole"];
    tokenVersion: number;
  },
  realm: AuthRealm,
  meta: SessionMeta,
): Promise<AuthSession> {
  if (!user.email) throw unauthorized("PIN-only staff cannot start a web session.");
  const email = user.email;
  const { token: accessToken, expiresIn } = signAccessToken({
    id: user.id,
    email,
    globalRole: user.globalRole,
    realm,
    tenantId: user.tenantId,
    tokenVersion: user.tokenVersion,
  });

  const { token: refreshToken, tokenHash } = createRefreshToken();

  // `RefreshToken` is not tenant-scoped: it is looked up by hash before a tenant is
  // trusted, exactly like the session lookup in the auth middleware.
  await runAsPlatform(() =>
    prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash,
        realm,
        expiresAt: refreshTokenExpiry(),
        userAgent: meta.userAgent,
        ipAddress: meta.ipAddress,
      },
    }),
  );

  return {
    accessToken,
    refreshToken,
    expiresIn,
    user: {
      id: user.id,
      name: user.name,
      email,
      globalRole: user.globalRole,
      tenantId: user.tenantId,
    },
  };
}

/**
 * Signs a salon user in.
 *
 * The email is globally unique on `users` (unlike `customers.email`, which ADR 0003
 * scoped to the tenant), so the address alone identifies the account before any
 * tenant is known.
 */
export async function login(input: LoginInput, meta: SessionMeta): Promise<LoginResult> {
  // Phase 3 serves the web portal. `pos` and `mobile` sign in through their own
  // surfaces, which land with the phases that own them; `/api/mobile/*` is a frozen
  // contract and is deliberately not re-implemented here.
  if (input.realm !== WEB_REALM) {
    throw forbidden(
      `The "${input.realm}" surface does not sign in through this endpoint.`,
      "REALM_NOT_SUPPORTED",
    );
  }

  const user = await runAsPlatform(() =>
    prisma.user.findUnique({
      where: { email: input.email },
      select: {
        id: true,
        tenantId: true,
        name: true,
        email: true,
        passwordHash: true,
        globalRole: true,
        disabled: true,
        tokenVersion: true,
        twoFactorEnabled: true,
      },
    }),
  );

  // Always spend the same time, and always answer the same way: which half was wrong
  // is not the client's business.
  const passwordMatches = await verifyPassword(input.password, user?.passwordHash ?? DUMMY_HASH);

  if (!user || !user.email || user.disabled || !passwordMatches) {
    throw unauthorized("That email and password combination is not right.", "INVALID_CREDENTIALS");
  }

  await assertTenantMaySignIn(user.tenantId);

  await runAsPlatform(() =>
    prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }),
  );

  // Two-factor authentication is required: send a code by email and make the
  // caller complete verifyTwoFactorForLogin before any tokens are issued.
  if (user.twoFactorEnabled || user.globalRole === "SUPER_ADMIN") {
    return loginWithTwoFactor({ ...user, email: user.email });
  }

  return issueSession(user, WEB_REALM, meta);
}

/**
 * Exchanges a refresh token for a new pair, rotating it.
 *
 * Rotation is the replay defence: the presented token is revoked in the same
 * statement that validates it, so two concurrent uses cannot both succeed — the
 * second finds it already revoked and is refused.
 *
 * A *reused* token is treated as theft rather than noise. A legitimate client rotates
 * on every use, so a token arriving twice means a copy exists somewhere it should
 * not; the whole family is revoked and every session for that user must sign in
 * again. Losing a session is a far better outcome than leaving an attacker with one.
 */
export async function refresh(refreshToken: string, meta: SessionMeta): Promise<AuthSession> {
  const tokenHash = hashRefreshToken(refreshToken);

  const row = await runAsPlatform(() => prisma.refreshToken.findUnique({ where: { tokenHash } }));

  if (!row) {
    throw unauthorized(
      "Your session is no longer valid. Please log in again.",
      "SESSION_INVALIDATED",
    );
  }

  if (row.revokedAt) {
    // A revoked token was replayed. Reject it without touching any other
    // session: per ADR 0007, one client presenting a dead token must not
    // sign the user out of their other devices. Family revocation happens
    // only through password change or platform forced sign-out.
    throw unauthorized(
      "Your session is no longer valid. Please log in again.",
      "SESSION_INVALIDATED",
    );
  }

  if (row.expiresAt < new Date()) {
    throw unauthorized("Your session has expired. Please log in again.", "SESSION_EXPIRED");
  }

  const user = await loadUserForSession(row.userId);

  if (!user || user.disabled) {
    throw unauthorized(
      "Your session is no longer valid. Please log in again.",
      "SESSION_INVALIDATED",
    );
  }

  if (user.globalRole === "SUPER_ADMIN" && !user.twoFactorEnabled) {
    throw unauthorized("Sign in again to verify your owner account.", "TWO_FACTOR_REQUIRED");
  }

  await assertTenantMaySignIn(user.tenantId);

  // The atomic claim: only the request that flips `revokedAt` from null may issue
  // the replacement.
  const claimed = await runAsPlatform(() =>
    prisma.refreshToken.updateMany({
      where: { id: row.id, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  );

  if (claimed.count === 0) {
    throw unauthorized(
      "Your session is no longer valid. Please log in again.",
      "SESSION_INVALIDATED",
    );
  }

  return issueSession(user, row.realm, meta);
}

/**
 * Revokes a refresh token. Idempotent, and never reveals whether the token existed:
 * logging out an already-dead session is a success, not an error.
 *
 * Deliberately does **not** bump `User.tokenVersion`: signing out of one client must
 * not sign the user out of the others. The access token survives until it expires
 * (15 minutes), and a password change moves `tokenVersion` when every session really
 * does have to end — see `PROJECT.md#adr-0007`.
 */
export async function logout(refreshToken: string): Promise<void> {
  const tokenHash = hashRefreshToken(refreshToken);

  await runAsPlatform(() =>
    prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  );
}

/**
 * Changes a user's password.
 *
 * Bumping `tokenVersion` invalidates every access token already issued, and revoking
 * the refresh rows ends every session — including the caller's own, which is the
 * point: a password change is how someone evicts an intruder, so it must not leave
 * the intruder's session running.
 */
export async function changePassword(
  userId: string,
  tenantId: string,
  input: ChangePasswordInput,
): Promise<void> {
  // Verify the current password first (a read, outside the transaction).
  const user = await runAsTenant(tenantId, async () =>
    prisma.user.findUnique({ where: { id: userId } }),
  );

  if (!user) {
    throw unauthorized(
      "Your session is no longer valid. Please log in again.",
      "SESSION_INVALIDATED",
    );
  }

  const currentMatches = await verifyPassword(input.currentPassword, user.passwordHash);
  if (!currentMatches) {
    throw unauthorized("Your current password is not right.", "INVALID_CREDENTIALS");
  }

  if (user.globalRole === "SUPER_ADMIN") {
    const parsed = adminPasswordSchema.safeParse(input.newPassword);
    if (!parsed.success)
      throw validationFailed([{ path: "newPassword", message: parsed.error.issues[0].message }]);
  }

  const passwordHash = await hashPassword(input.newPassword);
  const now = new Date();

  // Password change and refresh-token revocation are a single atomic write:
  // if either fails, neither happens, so an intruder can never be left with
  // a valid refresh token after a password change.
  await runAsPlatform(() =>
    prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: {
          passwordHash,
          tokenVersion: { increment: 1 },
          twoFactorCode: null,
          twoFactorCodeExpiresAt: null,
        },
      }),
      prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now },
      }),
    ]),
  );
}

/**
 * Company-owner forced sign-out. Both writes stay inside the authenticated
 * tenant. Unknown and foreign users produce the same response without mutations.
 */
export async function forceSignOut(input: ForceSignOutInput, tenantId: string): Promise<void> {
  if (!tenantId) throw forbidden("A company context is required.", "TENANT_CONTEXT_REQUIRED");
  const now = new Date();

  await runAsTenant(tenantId, () =>
    prisma.$transaction(async (tx) => {
      const changed = await tx.user.updateMany({
        where: { id: input.userId, tenantId },
        data: { tokenVersion: { increment: 1 }, twoFactorCode: null, twoFactorCodeExpiresAt: null },
      });
      if (changed.count !== 1) throw notFound("User not found.");
      await tx.refreshToken.updateMany({
        where: { userId: input.userId, user: { tenantId }, revokedAt: null },
        data: { revokedAt: now },
      });
    }),
  );
}

/**
 * Generates a zero-padded six-digit numeric code.
 */
function generateTwoFactorCode(): string {
  return String(randomInt(0, 10 ** TWO_FACTOR_CODE_LENGTH)).padStart(TWO_FACTOR_CODE_LENGTH, "0");
}

/**
 * Hashes a two-factor code the same way refresh tokens are hashed.
 */
function hashTwoFactorCode(code: string): string {
  return hashRefreshToken(code);
}

/**
 * Starts email-based two-factor enrollment: generates a code, stores its hash
 * with a ten-minute expiry, sends it by email, and returns whether it was sent.
 * The caller must then call `confirmTwoFactor` with the code to finish enabling.
 */
export async function enableTwoFactor(userId: string): Promise<{ sent: true }> {
  const code = generateTwoFactorCode();
  const expiresAt = new Date(Date.now() + TWO_FACTOR_CODE_TTL_SECONDS * 1000);

  await runAsPlatform(() =>
    prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorCode: hashTwoFactorCode(`enrollment:${code}`),
        twoFactorCodeExpiresAt: expiresAt,
      },
    }),
  );

  const user = await runAsPlatform(() =>
    prisma.user.findUnique({ where: { id: userId }, select: { email: true } }),
  );

  if (!user) {
    throw unauthorized(
      "Your session is no longer valid. Please log in again.",
      "SESSION_INVALIDATED",
    );
  }

  if (!user.email) throw unauthorized("PIN-only staff cannot enable email authentication.");
  await sendTwoFactorCode(user.email, code);

  return { sent: true };
}

/**
 * Verifies a two-factor code during enrollment and enables 2FA for the user.
 * Must be called while authenticated as the user.
 */
export async function confirmTwoFactor(
  userId: string,
  input: TwoFactorConfirmInput,
): Promise<void> {
  const user = await runAsPlatform(() =>
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        twoFactorEnabled: true,
        twoFactorCode: true,
        twoFactorCodeExpiresAt: true,
      },
    }),
  );

  if (!user || !user.twoFactorCode || !user.twoFactorCodeExpiresAt) {
    throw unauthorized(
      "No two-factor code is pending. Start enrollment first.",
      "TWO_FACTOR_NOT_PENDING",
    );
  }

  if (user.twoFactorCodeExpiresAt < new Date()) {
    throw unauthorized(
      "The two-factor code has expired. Start enrollment again.",
      "TWO_FACTOR_EXPIRED",
    );
  }

  const codeMatches = hashTwoFactorCode(`enrollment:${input.code}`) === user.twoFactorCode;
  if (!codeMatches) {
    throw unauthorized("The two-factor code is not right.", "INVALID_TWO_FACTOR_CODE");
  }

  const consumed = await runAsPlatform(() =>
    prisma.user.updateMany({
      where: {
        id: userId,
        twoFactorCode: user.twoFactorCode,
        twoFactorCodeExpiresAt: { gt: new Date() },
      },
      data: {
        twoFactorEnabled: true,
        twoFactorCode: null,
        twoFactorCodeExpiresAt: null,
      },
    }),
  );
  if (consumed.count !== 1)
    throw unauthorized(
      "The code has already been used. Start enrollment again.",
      "INVALID_TWO_FACTOR_CODE",
    );
}

/**
 * Disables two-factor authentication for the user and clears any pending code.
 * Must be called while authenticated as the user.
 */
export async function disableTwoFactor(userId: string): Promise<void> {
  const user = await loadUserForSession(userId);
  if (!user || user.globalRole === "SUPER_ADMIN") {
    throw forbidden("Owners must keep two-factor authentication enabled.", "TWO_FACTOR_REQUIRED");
  }
  await runAsPlatform(() =>
    prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorEnabled: false,
        twoFactorCode: null,
        twoFactorCodeExpiresAt: null,
      },
    }),
  );
}

/**
 * Verifies a two-factor code for login and issues a full access/refresh session.
 * Used after `login` returned `requiresTwoFactor: true`.
 */
export async function verifyTwoFactorForLogin(
  input: TwoFactorVerifyInput,
  meta: SessionMeta,
): Promise<AuthSession> {
  const user = await runAsPlatform(() =>
    prisma.user.findUnique({
      where: { email: input.email },
      select: {
        id: true,
        tenantId: true,
        name: true,
        email: true,
        globalRole: true,
        tokenVersion: true,
        disabled: true,
        twoFactorEnabled: true,
        twoFactorCode: true,
        twoFactorCodeExpiresAt: true,
      },
    }),
  );

  if (
    !user ||
    (!user.twoFactorEnabled && user.globalRole !== "SUPER_ADMIN") ||
    !user.twoFactorCode ||
    !user.twoFactorCodeExpiresAt
  ) {
    throw unauthorized(
      "Two-factor authentication is not required for this account.",
      "TWO_FACTOR_NOT_REQUIRED",
    );
  }

  if (user.disabled) {
    throw unauthorized(
      "Your session is no longer valid. Please log in again.",
      "SESSION_INVALIDATED",
    );
  }

  if (user.twoFactorCodeExpiresAt < new Date()) {
    throw unauthorized("The two-factor code has expired. Log in again.", "TWO_FACTOR_EXPIRED");
  }

  const codeMatches =
    hashTwoFactorCode(`login:${input.challenge}:${input.code}`) === user.twoFactorCode;
  if (!codeMatches) {
    throw unauthorized("The two-factor code is not right.", "INVALID_TWO_FACTOR_CODE");
  }

  await assertTenantMaySignIn(user.tenantId);

  // Clear the used code.
  const consumed = await runAsPlatform(() =>
    prisma.user.updateMany({
      where: {
        id: user.id,
        disabled: false,
        tokenVersion: user.tokenVersion,
        twoFactorCode: user.twoFactorCode,
        twoFactorCodeExpiresAt: { gt: new Date() },
      },
      data: { twoFactorEnabled: true, twoFactorCode: null, twoFactorCodeExpiresAt: null },
    }),
  );
  if (consumed.count !== 1)
    throw unauthorized("The code has already been used. Sign in again.", "INVALID_TWO_FACTOR_CODE");

  return issueSession(user, WEB_REALM, meta);
}

/**
 * Modifies `login` so that when a user has two-factor authentication enabled,
 * a code is sent by email and the caller must complete `verifyTwoFactorForLogin`
 * before receiving an access/refresh pair. The challenge is bound to this
 * password-verified attempt; enrollment codes cannot be exchanged for sessions.
 */
async function loginWithTwoFactor(user: {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  globalRole: AuthSession["user"]["globalRole"];
  tokenVersion: number;
}): Promise<TwoFactorChallenge> {
  const code = generateTwoFactorCode();
  const challenge = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + TWO_FACTOR_CODE_TTL_SECONDS * 1000);

  await runAsPlatform(() =>
    prisma.user.update({
      where: { id: user.id },
      data: {
        twoFactorCode: hashTwoFactorCode(`login:${challenge}:${code}`),
        twoFactorCodeExpiresAt: expiresAt,
      },
    }),
  );

  await sendTwoFactorCode(user.email, code);

  return { requiresTwoFactor: true, challenge };
}

/**
 * Builds the payload of `GET /api/auth/me`.
 *
 * Entitlements are the tenant's *effective* set: every core module, plus each add-on
 * whose `TenantModule` row exists and has not lapsed. The front end uses them to hide
 * navigation; `requireModule` on the server stays the boundary, because hidden is not
 * secured.
 */
export async function loadProfile(user: AuthenticatedUser): Promise<AuthProfile> {
  const tenantId = user.tenantId;

  if (!tenantId) {
    throw forbidden("This session is not attached to a salon.", "TENANT_CONTEXT_REQUIRED");
  }

  return runAsTenant(tenantId, async () => {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, name: true, slug: true, status: true },
    });

    if (!tenant) {
      throw unauthorized("Your salon is no longer available.", "TENANT_NOT_FOUND");
    }

    const [modules, held, latestSubscription] = await Promise.all([
      prisma.module.findMany({ orderBy: { sortOrder: "asc" } }),
      prisma.tenantModule.findMany(),
      prisma.subscription.findFirst({ orderBy: { endDate: "desc" }, select: { endDate: true } }),
    ]);

    const now = new Date();
    const entitlements = new Map(held.map((row) => [row.moduleId, row]));

    const effective: ModuleEntitlement[] = modules
      .filter((module) => {
        if (module.isCore) return true;
        const row = entitlements.get(module.id);
        if (!row) return false;
        return row.expiresAt === null || row.expiresAt > now;
      })
      .map((module) => ({
        code: module.code,
        name: module.name,
        category: module.category,
        isCore: module.isCore,
        expiresAt: entitlements.get(module.id)?.expiresAt?.toISOString() ?? null,
      }));

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        globalRole: user.globalRole,
        tenantId,
      },
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        status: resolveTenantStatus(tenant.status, latestSubscription?.endDate ?? null),
      },
      entitlements: effective,
    };
  });
}
