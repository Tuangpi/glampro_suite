CREATE TABLE "owner_invitations" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "acceptedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "owner_invitations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "owner_invitations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "owner_invitations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "owner_invitations_tokenHash_key" ON "owner_invitations"("tokenHash");
CREATE INDEX "owner_invitations_tenantId_createdAt_idx" ON "owner_invitations"("tenantId", "createdAt");
CREATE INDEX "owner_invitations_userId_idx" ON "owner_invitations"("userId");