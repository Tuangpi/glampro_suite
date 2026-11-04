-- Hard-delete one company and every row that belongs to it.
--
-- Suspend / reactivate / cancel keep the data and stay reversible; a purge does
-- not, so it gets its own break-glass instead of a fourth lifecycle status.
--
-- Two things block a plain `DELETE FROM tenants`:
--   1. eleven tenant foreign keys are ON DELETE RESTRICT (`treatment_consent_events`,
--      `commission_periods`, `employee_commissions`, the payroll ledgers, ...), so the
--      purge service deletes children explicitly in dependency order, and
--   2. append-only guards RAISE EXCEPTION on DELETE unless the parent tenant row is
--      already gone -- a state the purge can never reach while the tenant still exists.
--
-- The functions below are the applied bodies, reproduced verbatim except for one
-- added escape clause: a DELETE passes when the transaction-local
-- `glampro.purge_tenant` setting equals the row's tenant. Only
-- `services/company-purge.service.ts` sets it, with `set_config(..., true)`, inside
-- the purge transaction. `true` makes it transaction-local, so a pooled connection
-- cannot carry it into a later salon request. Every other DELETE still hits the
-- guard that follows it, and every guard keeps its original error message.
--
-- Triggers, tables and constraints are untouched: this migration only replaces
-- function bodies.

CREATE OR REPLACE FUNCTION commission_rule_no_direct_delete()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Tenant purge break-glass. Only an operator-issued purge of *this*
  -- tenant sets the GUC, and only inside its own transaction, so salon
  -- traffic can never see it. Ordinary deletes still hit the guard below.
  IF TG_OP = 'DELETE'
     AND current_setting('glampro.purge_tenant', true) = OLD."tenantId" THEN
    RETURN OLD;
  END IF;
  IF pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'Commission rules are append-only; publish an inheritance event';
  END IF;
  RETURN OLD;
END;
$function$;

CREATE OR REPLACE FUNCTION guard_commission_attribution_policy()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Tenant purge break-glass. Only an operator-issued purge of *this*
  -- tenant sets the GUC, and only inside its own transaction, so salon
  -- traffic can never see it. Ordinary deletes still hit the guard below.
  IF TG_OP = 'DELETE'
     AND current_setting('glampro.purge_tenant', true) = OLD."tenantId" THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM tenants WHERE id = OLD."tenantId") THEN RETURN OLD; END IF;
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Attribution policies are append-only'; END IF;
  IF NOT EXISTS (SELECT 1 FROM users u WHERE u.id = NEW."actorId"
    AND u."tenantId" = NEW."tenantId" AND NOT u.disabled AND u."globalRole" IN ('MANAGER','SUPER_ADMIN')) THEN
    RAISE EXCEPTION 'Attribution policies require an enabled salon manager';
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION guard_commission_collection()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Tenant purge break-glass. Only an operator-issued purge of *this*
  -- tenant sets the GUC, and only inside its own transaction, so salon
  -- traffic can never see it. Ordinary deletes still hit the guard below.
  IF TG_OP = 'DELETE'
     AND current_setting('glampro.purge_tenant', true) = OLD."tenantId" THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM tenants WHERE id = OLD."tenantId") THEN RETURN OLD; END IF;
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Collection evidence is append-only'; END IF;
  -- Serialize both direct inserts and application callers with POS before configuration.
  PERFORM pg_advisory_xact_lock(hashtextextended('prepaid:' || NEW."tenantId", 0));
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = NEW."actorId" AND "tenantId" = NEW."tenantId" AND NOT disabled)
    OR NOT EXISTS (SELECT 1 FROM sales WHERE id = NEW."saleId" AND "tenantId" = NEW."tenantId" AND status = 'COMPLETED')
    OR EXISTS (SELECT 1 FROM sale_refunds WHERE "saleId" = NEW."saleId") THEN
    RAISE EXCEPTION 'Collection requires a current actor and completed unrefunded salon sale';
  END IF;
  IF NEW."sourceType" = 'SALE_PAYMENT' THEN
    IF NOT EXISTS (SELECT 1 FROM sale_payments WHERE id = NEW."sourceId"
      AND "tenantId" = NEW."tenantId" AND "saleId" = NEW."saleId"
      AND method NOT IN ('PACKAGE', 'PREPAID_CREDIT') AND "sessionId" IS NULL
      AND amount * 100 = NEW."grossCents" AND "createdAt" = NEW."occurredAt") THEN
      RAISE EXCEPTION 'Collection payment source mismatch or unsupported settlement';
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM customer_outstanding_payments p
      JOIN customer_outstandings o ON o.id = p."outstandingId"
      JOIN sales s ON s.id = p."saleId"
      WHERE p.id = NEW."sourceId" AND p."tenantId" = NEW."tenantId"
      AND p."saleId" = NEW."saleId" AND o."tenantId" = NEW."tenantId"
      AND o."saleId" = p."saleId" AND o."customerId" = p."customerId"
      AND s."customerId" = p."customerId" AND p."paidAmount" * 100 = NEW."grossCents"
      AND p."paidAt" = NEW."occurredAt") THEN
      RAISE EXCEPTION 'Outstanding collection source mismatch';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM commission_collections WHERE "tenantId" = NEW."tenantId"
    AND "saleId" = NEW."saleId" AND currency <> NEW.currency) THEN
    RAISE EXCEPTION 'Collection currency differs from original evidence';
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION guard_commission_collection_allocation()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  source commission_collections%ROWTYPE;
  line sale_lines%ROWTYPE;
  prior_gross BIGINT;
  prior_tax BIGINT;
  line_gross BIGINT;
  line_tax BIGINT;
  expected_tax BIGINT;
BEGIN
  -- Tenant purge break-glass. Only an operator-issued purge of *this*
  -- tenant sets the GUC, and only inside its own transaction, so salon
  -- traffic can never see it. Ordinary deletes still hit the guard below.
  IF TG_OP = 'DELETE'
     AND current_setting('glampro.purge_tenant', true) = OLD."tenantId" THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM tenants WHERE id = OLD."tenantId") THEN RETURN OLD; END IF;
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Collection allocations are append-only'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('prepaid:' || NEW."tenantId", 0));
  SELECT * INTO source FROM commission_collections WHERE id = NEW."collectionId" AND "tenantId" = NEW."tenantId";
  SELECT * INTO line FROM sale_lines WHERE id = NEW."saleLineId" AND "tenantId" = NEW."tenantId" AND "saleId" = source."saleId";
  IF source.id IS NULL OR line.id IS NULL THEN RAISE EXCEPTION 'Allocation source or line tenant mismatch'; END IF;
  line_gross := (line."lineTotal" - line."voucherDiscountAmount") * 100;
  line_tax := line."taxAmount" * 100;
  SELECT COALESCE(SUM("grossCents"), 0), COALESCE(SUM("taxCents"), 0) INTO prior_gross, prior_tax
    FROM commission_collection_allocations WHERE "tenantId" = NEW."tenantId" AND "saleLineId" = NEW."saleLineId";
  IF line_gross <= 0 OR line_tax < 0 OR line_tax > line_gross OR prior_gross + NEW."grossCents" > line_gross THEN
    RAISE EXCEPTION 'Allocation exceeds contracted line consideration';
  END IF;
  expected_tax := floor(((prior_gross + NEW."grossCents")::numeric * line_tax * 2 + line_gross) / (line_gross::numeric * 2)) - prior_tax;
  IF NEW."taxCents" <> expected_tax THEN RAISE EXCEPTION 'Allocation tax is not the exact cumulative delta'; END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION guard_commission_event()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Tenant purge break-glass. Only an operator-issued purge of *this*
  -- tenant sets the GUC, and only inside its own transaction, so salon
  -- traffic can never see it. Ordinary deletes still hit the guard below.
  IF TG_OP = 'DELETE'
     AND current_setting('glampro.purge_tenant', true) = OLD."tenantId" THEN
    RETURN OLD;
  END IF;
  IF OLD."ledgerVersion" IS NOT NULL OR (TG_OP = 'UPDATE' AND NEW."ledgerVersion" IS NOT NULL) THEN
    RAISE EXCEPTION 'Commission event evidence is immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION guard_commission_redemption_snapshot()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Tenant purge break-glass. Only an operator-issued purge of *this*
  -- tenant sets the GUC, and only inside its own transaction, so salon
  -- traffic can never see it. Ordinary deletes still hit the guard below.
  IF TG_OP = 'DELETE'
     AND current_setting('glampro.purge_tenant', true) = OLD."tenantId" THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM tenants WHERE id = OLD."tenantId") THEN RETURN OLD; END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Commission redemption evidence is append-only';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM customer_redemptions r
    WHERE r.id = NEW."redemptionId" AND r."tenantId" = NEW."tenantId" AND r."itemType" = 'PACKAGE')
    OR (NEW."actorId" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM users u WHERE u.id = NEW."actorId" AND u."tenantId" = NEW."tenantId" AND NOT u.disabled)) THEN
    RAISE EXCEPTION 'Commission redemption source or actor tenant mismatch';
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION protect_assistant_draft_event()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Tenant purge break-glass. Only an operator-issued purge of *this*
  -- tenant sets the GUC, and only inside its own transaction, so salon
  -- traffic can never see it. Ordinary deletes still hit the guard below.
  IF TG_OP = 'DELETE'
     AND current_setting('glampro.purge_tenant', true) = OLD."tenantId" THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Assistant draft evidence is append-only';
END;
$function$;

CREATE OR REPLACE FUNCTION protect_package_valuation_evidence()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Tenant purge break-glass. Only an operator-issued purge of *this*
  -- tenant sets the GUC, and only inside its own transaction, so salon
  -- traffic can never see it. Ordinary deletes still hit the guard below.
  IF TG_OP = 'DELETE'
     AND current_setting('glampro.purge_tenant', true) = OLD."tenantId" THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM tenants WHERE id = OLD."tenantId") THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Package valuation evidence is append-only';
END;
$function$;

CREATE OR REPLACE FUNCTION protect_payroll_close_history()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Tenant purge break-glass. Only an operator-issued purge of *this*
  -- tenant sets the GUC, and only inside its own transaction, so salon
  -- traffic can never see it. Ordinary deletes still hit the guard below.
  IF TG_OP = 'DELETE'
     AND current_setting('glampro.purge_tenant', true) = OLD."tenantId" THEN
    RETURN OLD;
  END IF;
  IF TG_TABLE_NAME = 'payroll_close_events' OR TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Payroll close history is append-only';
  END IF;
  IF NEW."tenantId" <> OLD."tenantId" OR NEW."periodKey" <> OLD."periodKey" OR NEW.id <> OLD.id
     OR NEW.revision <> OLD.revision + 1 THEN
    RAISE EXCEPTION 'Payroll close identity/revision is immutable';
  END IF;
  IF OLD.status = 'APPROVED' AND (
    NEW.status <> 'APPROVED' OR OLD.state->'payout' <> 'null'::jsonb
    OR NEW.state->'payout' IS NULL OR NEW.state->'payout' = 'null'::jsonb
    OR (NEW.state - 'payout' - 'revision') IS DISTINCT FROM (OLD.state - 'payout' - 'revision')
  ) THEN
    RAISE EXCEPTION 'Approved payroll entitlement is immutable';
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION protect_payroll_configuration()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Tenant purge break-glass. Only an operator-issued purge of *this*
  -- tenant sets the GUC, and only inside its own transaction, so salon
  -- traffic can never see it. Ordinary deletes still hit the guard below.
  IF TG_OP = 'DELETE'
     AND current_setting('glampro.purge_tenant', true) = OLD."tenantId" THEN
    RETURN OLD;
  END IF;
  IF TG_TABLE_NAME = 'payroll_plan_versions' THEN
    IF TG_OP = 'UPDATE' THEN
      IF OLD.status = 'DRAFT' AND NEW.id = OLD.id AND NEW."tenantId" = OLD."tenantId"
         AND NEW."planId" = OLD."planId" AND NEW."versionNo" = OLD."versionNo" THEN
        RETURN NEW;
      END IF;
    END IF;
  END IF;
  RAISE EXCEPTION 'Published payroll versions and configuration audit events are immutable';
END;
$function$;

CREATE OR REPLACE FUNCTION protect_payroll_source_events()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Tenant purge break-glass. Only an operator-issued purge of *this*
  -- tenant sets the GUC, and only inside its own transaction, so salon
  -- traffic can never see it. Ordinary deletes still hit the guard below.
  IF TG_OP = 'DELETE'
     AND current_setting('glampro.purge_tenant', true) = OLD."tenantId" THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM tenants WHERE id = OLD."tenantId") THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Payroll source events are append-only; reverse and repost with a reason';
END;
$function$;

CREATE OR REPLACE FUNCTION protect_prepaid_balance_event()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Tenant purge break-glass. Only an operator-issued purge of *this*
  -- tenant sets the GUC, and only inside its own transaction, so salon
  -- traffic can never see it. Ordinary deletes still hit the guard below.
  IF TG_OP = 'DELETE'
     AND current_setting('glampro.purge_tenant', true) = OLD."tenantId" THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM tenants WHERE id = OLD."tenantId") THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Prepaid balance history is append-only';
END;
$function$;

CREATE OR REPLACE FUNCTION protect_prepaid_family_event()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Tenant purge break-glass. Only an operator-issued purge of *this*
  -- tenant sets the GUC, and only inside its own transaction, so salon
  -- traffic can never see it. Ordinary deletes still hit the guard below.
  IF TG_OP = 'DELETE'
     AND current_setting('glampro.purge_tenant', true) = OLD."tenantId" THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM tenants WHERE id = OLD."tenantId") THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Prepaid family history is append-only';
END;
$function$;

CREATE OR REPLACE FUNCTION protect_prepaid_refund_settlement()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Tenant purge break-glass. Only an operator-issued purge of *this*
  -- tenant sets the GUC, and only inside its own transaction, so salon
  -- traffic can never see it. Ordinary deletes still hit the guard below.
  IF TG_OP = 'DELETE'
     AND current_setting('glampro.purge_tenant', true) = OLD."tenantId" THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM tenants WHERE id = OLD."tenantId") THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Prepaid refund settlements are append-only';
END;
$function$;

CREATE OR REPLACE FUNCTION protect_prepaid_transfer_event()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Tenant purge break-glass. Only an operator-issued purge of *this*
  -- tenant sets the GUC, and only inside its own transaction, so salon
  -- traffic can never see it. Ordinary deletes still hit the guard below.
  IF TG_OP = 'DELETE'
     AND current_setting('glampro.purge_tenant', true) = OLD."tenantId" THEN
    RETURN OLD;
  END IF;
  -- Preserve ordinary evidence. Allow only the parent tenant's FK cascade.
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM tenants WHERE id = OLD."tenantId") THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Prepaid transfer history is append-only';
END;
$function$;

CREATE OR REPLACE FUNCTION protect_sale_line_payroll_economics()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Tenant purge break-glass. Only an operator-issued purge of *this*
  -- tenant sets the GUC, and only inside its own transaction, so salon
  -- traffic can never see it. Ordinary deletes still hit the guard below.
  IF TG_OP = 'DELETE'
     AND current_setting('glampro.purge_tenant', true) = OLD."tenantId" THEN
    RETURN OLD;
  END IF;
  IF OLD."payrollEconomics" IS NOT NULL THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Original payroll sale economics are immutable';
    END IF;
    IF NEW."payrollEconomics" IS DISTINCT FROM OLD."payrollEconomics"
      OR NEW.id <> OLD.id OR NEW."tenantId" <> OLD."tenantId" OR NEW."saleId" <> OLD."saleId" THEN
      RAISE EXCEPTION 'Original payroll sale economics are immutable';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION protect_session_package_transfer_event()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Tenant purge break-glass. Only an operator-issued purge of *this*
  -- tenant sets the GUC, and only inside its own transaction, so salon
  -- traffic can never see it. Ordinary deletes still hit the guard below.
  IF TG_OP = 'DELETE'
     AND current_setting('glampro.purge_tenant', true) = OLD."tenantId" THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM tenants WHERE id = OLD."tenantId") THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Session package transfer history is append-only';
END;
$function$;

CREATE OR REPLACE FUNCTION protect_treatment_retention_hold()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Tenant purge break-glass. Only an operator-issued purge of *this*
  -- tenant sets the GUC, and only inside its own transaction, so salon
  -- traffic can never see it. Ordinary deletes still hit the guard below.
  IF TG_OP = 'DELETE'
     AND current_setting('glampro.purge_tenant', true) = OLD."tenantId" THEN
    RETURN OLD;
  END IF;
  IF OLD."retentionHold" THEN
    RAISE EXCEPTION 'Treatment has an active retention hold' USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END;
$function$;

CREATE OR REPLACE FUNCTION record_prepaid_balance_event()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  h customer_value_package_holdings;
  before_amount DECIMAL(12,2) := 0;
  after_amount DECIMAL(12,2) := 0;
  old_customer TEXT;
  old_family TEXT;
  event_kind TEXT;
BEGIN
  -- Tenant purge break-glass. Only an operator-issued purge of *this*
  -- tenant sets the GUC, and only inside its own transaction, so salon
  -- traffic can never see it. Ordinary deletes still hit the guard below.
  IF TG_OP = 'DELETE'
     AND current_setting('glampro.purge_tenant', true) = OLD."tenantId" THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM tenants WHERE id = OLD."tenantId") THEN RETURN OLD; END IF;
  IF TG_OP = 'UPDATE' AND NEW."amountRemaining" = OLD."amountRemaining"
    AND NEW."customerId" = OLD."customerId" AND NEW."sharedFamilyId" IS NOT DISTINCT FROM OLD."sharedFamilyId"
    AND NEW."expiresAt" IS NOT DISTINCT FROM OLD."expiresAt" THEN RETURN NEW; END IF;
  IF TG_OP = 'DELETE' THEN h := OLD; ELSE h := NEW; after_amount := NEW."amountRemaining"; END IF;
  IF TG_OP <> 'INSERT' THEN before_amount := OLD."amountRemaining"; old_customer := OLD."customerId"; old_family := OLD."sharedFamilyId"; END IF;
  IF TG_OP = 'INSERT' THEN event_kind := 'GRANT';
  ELSIF TG_OP = 'DELETE' THEN event_kind := 'REMOVAL';
  ELSIF NEW."customerId" <> OLD."customerId" THEN event_kind := 'TRANSFER';
  ELSIF NEW."sharedFamilyId" IS DISTINCT FROM OLD."sharedFamilyId" THEN event_kind := 'SHARING';
  ELSIF after_amount < before_amount THEN event_kind := 'SPEND';
  ELSIF after_amount > before_amount THEN event_kind := 'RESTORE';
  ELSE event_kind := 'EXPIRY_CHANGE'; END IF;
  INSERT INTO prepaid_balance_events(id, "tenantId", "holdingId", "customerId", "previousCustomerId", "actorId", "saleId",
    kind, "amountBefore", "amountAfter", delta, "sharedFamilyId", "previousSharedFamilyId", "expiresAt", reason)
  VALUES(gen_random_uuid()::text, h."tenantId", h.id, h."customerId", old_customer,
    nullif(current_setting('glampro.actor_id', true), ''), nullif(current_setting('glampro.sale_id', true), ''),
    event_kind, before_amount, after_amount, after_amount-before_amount, h."sharedFamilyId", old_family, h."expiresAt",
    nullif(current_setting('glampro.prepaid_reason', true), ''));
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION protect_payroll_cutover_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Tenant purge break-glass. Only an operator-issued purge of *this*
  -- tenant sets the GUC, and only inside its own transaction, so salon
  -- traffic can never see it. Ordinary deletes still hit the guard below.
  IF TG_OP = 'DELETE'
     AND current_setting('glampro.purge_tenant', true) = OLD."tenantId" THEN
    RETURN OLD;
  END IF;
  IF TG_TABLE_NAME = 'payroll_cutover_events' OR TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Payroll cutover history is append-only';
  END IF;
  IF NEW."tenantId" <> OLD."tenantId" OR NEW.id <> OLD.id
     OR NEW.revision <> OLD.revision + 1 THEN
    RAISE EXCEPTION 'Payroll cutover identity/revision is immutable';
  END IF;
  IF NOT ((OLD.status = 'ACTIVE' AND NEW.status = 'ROLLED_BACK')
       OR (OLD.status = 'ROLLED_BACK' AND NEW.status = 'ACTIVE')) THEN
    RAISE EXCEPTION 'Payroll cutover status must alternate between active and rolled back';
  END IF;
  RETURN NEW;
END $$;
