-- Glampro commission module – PostgreSQL DDL (equivalent to prisma/schema.prisma).
-- Use EITHER `npx prisma migrate dev` OR run this file manually (psql -f). Not both.

CREATE TABLE comm_plan (
  id TEXT PRIMARY KEY,
  "salonId" TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  positions TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX comm_plan_salon_idx ON comm_plan ("salonId");

CREATE TABLE comm_plan_version (
  id TEXT PRIMARY KEY,
  "planId" TEXT NOT NULL REFERENCES comm_plan(id),
  "versionNo" INTEGER NOT NULL,
  "effectiveFrom" TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL,
  definition JSONB NOT NULL,
  "publishedBy" TEXT,
  "publishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("planId", "versionNo")
);
CREATE INDEX comm_plan_version_lookup_idx ON comm_plan_version ("planId", status, "effectiveFrom");

CREATE TABLE comm_staff (
  id TEXT PRIMARY KEY,
  "salonId" TEXT NOT NULL,
  name TEXT NOT NULL,
  position TEXT,
  "joinDate" TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  "stageEndOverride" INTEGER
);
CREATE INDEX comm_staff_salon_idx ON comm_staff ("salonId");

CREATE TABLE comm_staff_plan_assignment (
  id TEXT PRIMARY KEY,
  "staffId" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "fromDate" TEXT NOT NULL,
  "toDate" TEXT,
  reason TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX comm_assignment_staff_idx ON comm_staff_plan_assignment ("staffId", "fromDate");

CREATE TABLE comm_payroll_profile (
  "staffId" TEXT NOT NULL,
  "effectiveFrom" TEXT NOT NULL,
  "basicSalary" DECIMAL(12,2) NOT NULL,
  "fixedOt" DECIMAL(12,2) NOT NULL,
  "fwlLevy" DECIMAL(12,2) NOT NULL,
  "payrollSalesAlertPct" DECIMAL(6,2) NOT NULL,
  PRIMARY KEY ("staffId", "effectiveFrom")
);

CREATE TABLE comm_holding (
  id TEXT PRIMARY KEY,
  "salonId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "packageId" TEXT NOT NULL,
  "packageName" TEXT NOT NULL,
  "netPrice" DECIMAL(12,2) NOT NULL,
  "sessionsTotal" INTEGER NOT NULL,
  "sessionsUsed" INTEGER NOT NULL DEFAULT 0,
  "sessionValue" DECIMAL(14,4) NOT NULL,
  "cashCollected" DECIMAL(12,2) NOT NULL,
  sellers JSONB NOT NULL,
  "saleCommMode" TEXT NOT NULL DEFAULT 'FOLLOW_PLAN',
  "saleFixedAmount" DECIMAL(12,2),
  "redCommMode" TEXT NOT NULL DEFAULT 'FOLLOW_PLAN',
  "redFixedAmount" DECIMAL(12,2),
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX comm_holding_customer_idx ON comm_holding ("salonId", "customerId");

CREATE TABLE comm_session_usage (
  id TEXT PRIMARY KEY,
  "holdingId" TEXT NOT NULL,
  "usedAt" TIMESTAMP(3) NOT NULL,
  "businessDate" TEXT NOT NULL,
  "serviceId" TEXT,
  "appointmentId" TEXT,
  "sessionValue" DECIMAL(14,4) NOT NULL,
  performers JSONB NOT NULL,
  "overrideBy" TEXT,
  "overrideReason" TEXT,
  "voidedAt" TIMESTAMP(3),
  "voidReason" TEXT
);
CREATE INDEX comm_session_usage_holding_idx ON comm_session_usage ("holdingId");

CREATE TABLE comm_base_line (
  id TEXT PRIMARY KEY,
  "salonId" TEXT NOT NULL,
  "staffId" TEXT NOT NULL,
  "commissionType" TEXT NOT NULL,
  "productCategory" TEXT,
  "baseAmount" DECIMAL(14,4) NOT NULL,
  "splitPct" DECIMAL(7,4) NOT NULL,
  units INTEGER NOT NULL DEFAULT 1,
  "fixedCommission" DECIMAL(14,4),
  "businessDate" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "holdingId" TEXT,
  status TEXT NOT NULL DEFAULT 'EARNED',
  "reversedById" TEXT,
  reason TEXT,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX comm_base_line_date_idx ON comm_base_line ("salonId", "businessDate");
CREATE INDEX comm_base_line_staff_idx ON comm_base_line ("salonId", "staffId", "businessDate");
CREATE INDEX comm_base_line_source_idx ON comm_base_line ("sourceId");
CREATE INDEX comm_base_line_holding_idx ON comm_base_line ("holdingId");

CREATE TABLE comm_period (
  id TEXT PRIMARY KEY,
  "salonId" TEXT NOT NULL,
  "periodKey" TEXT NOT NULL,
  status TEXT NOT NULL,
  "calculatedAt" TIMESTAMP(3),
  "approvedBy" TEXT,
  "approvedAt" TIMESTAMP(3),
  UNIQUE ("salonId", "periodKey")
);

CREATE TABLE comm_period_result (
  "salonId" TEXT NOT NULL,
  "periodKey" TEXT NOT NULL,
  "staffId" TEXT NOT NULL,
  result JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("salonId", "periodKey", "staffId")
);

CREATE TABLE comm_adjustment (
  id TEXT PRIMARY KEY,
  "salonId" TEXT NOT NULL,
  "periodKey" TEXT NOT NULL,
  "staffId" TEXT NOT NULL,
  kind TEXT NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  reason TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX comm_adjustment_period_idx ON comm_adjustment ("salonId", "periodKey");

CREATE TABLE comm_settings (
  "salonId" TEXT PRIMARY KEY,
  "requireStaffOnLines" BOOLEAN NOT NULL DEFAULT TRUE,
  "refundAdminFee" DECIMAL(12,2) NOT NULL DEFAULT 100,
  "defaultMinDepositPct" DECIMAL(6,2) NOT NULL DEFAULT 30,
  "joinAfterDayCountsNextMonth" INTEGER,
  "negativeBase" TEXT NOT NULL DEFAULT 'CARRY_FORWARD',
  "fallbackRates" JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE comm_audit_log (
  id BIGSERIAL PRIMARY KEY,
  "salonId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  before JSONB,
  after JSONB,
  reason TEXT,
  at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX comm_audit_salon_idx ON comm_audit_log ("salonId", at);
