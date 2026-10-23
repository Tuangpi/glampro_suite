-- Additive only: no salon rows or existing sessions are changed.
ALTER TYPE "AuthRealm" ADD VALUE 'platform';
ALTER TABLE "platform_admins"
  ADD COLUMN "loginChallengeHash" TEXT,
  ADD COLUMN "loginCodeHash" TEXT,
  ADD COLUMN "loginChallengeExpiresAt" TIMESTAMP(3),
  ADD COLUMN "loginAttempts" INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX "platform_admins_loginChallengeHash_key"
  ON "platform_admins"("loginChallengeHash");
CREATE TABLE "platform_sessions" (
  "id" TEXT NOT NULL,
  "adminId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "tokenVersion" INTEGER NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "platform_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "platform_sessions_adminId_fkey" FOREIGN KEY ("adminId")
    REFERENCES "platform_admins"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "platform_sessions_tokenHash_key" ON "platform_sessions"("tokenHash");
CREATE INDEX "platform_sessions_adminId_idx" ON "platform_sessions"("adminId");