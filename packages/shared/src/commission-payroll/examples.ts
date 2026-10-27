import { payrollPlanDefinitionSchema } from "./contracts.js";

/** SRS sample definitions only. Importing these never seeds or activates a salon. */
export function hairPayrollExample() {
  return payrollPlanDefinitionSchema.parse({
    stages: [
      { key: "new", name: "New staff", fromMonth: 1, toMonth: 3 },
      { key: "std", name: "Standard", fromMonth: 4, toMonth: null },
    ],
    components: [
      {
        key: "cash_pkg",
        name: "Cash Service & Package",
        sort: 1,
        basePct: "100",
        method: "TIER_WHOLE",
        commissionTypes: ["SVC", "PKG_SALE", "VP_SALE"],
        bands: [
          { upperLimit: "4000", ratePct: "0", stageRates: { new: "4" }, applyMode: "WHOLE" },
          { upperLimit: "6000", ratePct: "4", applyMode: "WHOLE" },
          { upperLimit: "10000", ratePct: "8", applyMode: "WHOLE" },
          { upperLimit: "14000", ratePct: "10", applyMode: "SLICE" },
          { upperLimit: "17000", ratePct: "15", applyMode: "SLICE" },
          { upperLimit: "20000", ratePct: "20", applyMode: "SLICE" },
          { upperLimit: null, ratePct: "25", applyMode: "SLICE" },
        ],
      },
      {
        key: "product",
        name: "Product",
        sort: 2,
        basePct: "100",
        method: "FLAT",
        flatRatePct: "10",
        commissionTypes: ["PRD"],
        bands: [],
      },
      {
        key: "on_course",
        name: "On course",
        sort: 3,
        basePct: "100",
        method: "TIER_WHOLE",
        commissionTypes: ["PKG_RED", "VP_SPEND"],
        bands: [
          { upperLimit: "7000", ratePct: "5", applyMode: "WHOLE" },
          { upperLimit: "15000", ratePct: "7", applyMode: "SLICE" },
          { upperLimit: null, ratePct: "10", applyMode: "SLICE" },
        ],
      },
      {
        key: "foc",
        name: "FOC service",
        sort: 4,
        basePct: "50",
        method: "FLAT",
        flatRatePct: "5",
        commissionTypes: ["FOC"],
        bands: [],
      },
    ],
    incentives: [
      {
        key: "group_ind",
        name: "Group + individual target",
        type: "GROUP_AND_INDIVIDUAL",
        individualMetricTypes: ["SVC", "PKG_SALE", "PRD"],
        groupMetric: "SALON_CASH",
        scope: "SALON",
        rows: [
          { groupTarget: "30000", individualTarget: "12000", amount: "100" },
          { groupTarget: "40000", individualTarget: "15000", amount: "200" },
          { groupTarget: "50000", individualTarget: "17000", amount: "300" },
        ],
      },
    ],
  });
}

export function tpPayrollExample() {
  return payrollPlanDefinitionSchema.parse({
    stages: [{ key: "std", name: "Standard", fromMonth: 1, toMonth: null }],
    components: [
      {
        key: "cash_course",
        name: "Cash & Course Services",
        sort: 1,
        basePct: "100",
        method: "FLAT",
        flatRatePct: "10",
        commissionTypes: ["SVC", "PKG_RED", "VP_SPEND"],
        bands: [],
      },
      {
        key: "product",
        name: "Product",
        sort: 2,
        basePct: "100",
        method: "FLAT",
        flatRatePct: "10",
        commissionTypes: ["PRD"],
        categoryExclude: ["Beauty"],
        bands: [],
      },
      {
        key: "package",
        name: "Package",
        sort: 3,
        basePct: "100",
        method: "TIER_WHOLE",
        commissionTypes: ["PKG_SALE", "VP_SALE"],
        bands: [
          { upperLimit: "4000", ratePct: "2" },
          { upperLimit: "6000", ratePct: "4" },
          { upperLimit: "8000", ratePct: "5" },
          { upperLimit: null, ratePct: "7" },
        ],
      },
      {
        key: "beauty",
        name: "Beauty product",
        sort: 4,
        basePct: "100",
        method: "FLAT",
        flatRatePct: "5",
        commissionTypes: ["PRD"],
        categoryInclude: ["Beauty"],
        bands: [],
      },
    ],
    incentives: [
      {
        key: "personal",
        name: "Personal target",
        type: "INDIVIDUAL_TARGET",
        individualMetricTypes: ["SVC", "PKG_SALE", "PRD"],
        groupMetric: "SALON_CASH",
        scope: "SALON",
        rows: [
          { individualTarget: "10000", amount: "50" },
          { individualTarget: "13000", amount: "100" },
          { individualTarget: "16000", amount: "150" },
        ],
      },
    ],
  });
}
