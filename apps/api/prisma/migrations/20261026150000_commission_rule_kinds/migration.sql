-- Support foundation kinds internally; public rule publication remains SERVICE/PRODUCT only.
ALTER TABLE commission_rules DROP CONSTRAINT "commission_rules_itemKind_check";
ALTER TABLE commission_rules ADD CONSTRAINT "commission_rules_itemKind_check" CHECK (
  "itemKind" IN ('SERVICE','PRODUCT','PACKAGE_SALE','PACKAGE_REDEMPTION','FOC','STORED_CREDIT_SALE','STORED_CREDIT_SPEND')
);
ALTER TABLE commission_rules DROP CONSTRAINT "commission_rules_scope_check";
ALTER TABLE commission_rules ADD CONSTRAINT "commission_rules_scope_check" CHECK (
  scope IN ('COMPANY','STAFF','DEPARTMENT','ITEM','PACKAGE')
);
ALTER TABLE commission_rules DROP CONSTRAINT commission_rule_scope;
ALTER TABLE commission_rules ADD CONSTRAINT commission_rule_scope CHECK (
  (scope = 'COMPANY' AND "staffId" IS NULL AND "targetId" IS NULL AND rate IS NOT NULL) OR
  (scope = 'STAFF' AND "staffId" IS NOT NULL AND "targetId" IS NULL) OR
  (scope IN ('DEPARTMENT','ITEM') AND "staffId" IS NOT NULL AND "targetId" IS NOT NULL) OR
  (scope = 'PACKAGE' AND "staffId" IS NULL AND "targetId" IS NOT NULL
    AND "itemKind" IN ('PACKAGE_SALE','PACKAGE_REDEMPTION','STORED_CREDIT_SALE','STORED_CREDIT_SPEND'))
);