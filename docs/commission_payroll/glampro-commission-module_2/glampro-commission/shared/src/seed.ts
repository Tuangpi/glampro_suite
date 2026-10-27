/**
 * Seed plans from Eurosense's real schemes (SRS §11). Used by backend seed and frontend mock mode.
 * Hair Commission Scheme (2022) and TP Mani & Pedi Commission Scheme (May 2019).
 */
import { PlanDefinition } from './types.js';

export const HAIR_2022: PlanDefinition = {
  stages: [
    { key: 'new', name: 'New staff', fromMonth: 1, toMonth: 3 },
    { key: 'std', name: 'Standard', fromMonth: 4, toMonth: null },
  ],
  components: [
    {
      key: 'cash_pkg', name: 'Cash Service & Package', sort: 1, basePct: '100', method: 'TIER_WHOLE',
      commissionTypes: ['SVC', 'PKG_SALE', 'VP_SALE'],
      bands: [
        { upperLimit: '4000', ratePct: '0', stageRates: { new: '4' }, applyMode: 'WHOLE' },
        { upperLimit: '6000', ratePct: '4', applyMode: 'WHOLE' },
        { upperLimit: '10000', ratePct: '8', applyMode: 'WHOLE' },
        { upperLimit: '14000', ratePct: '10', applyMode: 'SLICE' },
        { upperLimit: '17000', ratePct: '15', applyMode: 'SLICE' },
        { upperLimit: '20000', ratePct: '20', applyMode: 'SLICE' },
        { upperLimit: null, ratePct: '25', applyMode: 'SLICE' },
      ],
    },
    { key: 'product', name: 'Product', sort: 2, basePct: '100', method: 'FLAT', flatRatePct: '10', commissionTypes: ['PRD'], bands: [] },
    {
      key: 'on_course', name: 'On course', sort: 3, basePct: '100', method: 'TIER_WHOLE',
      commissionTypes: ['PKG_RED', 'VP_SPEND'],
      bands: [
        { upperLimit: '7000', ratePct: '5', applyMode: 'WHOLE' },
        { upperLimit: '15000', ratePct: '7', applyMode: 'SLICE' },
        { upperLimit: null, ratePct: '10', applyMode: 'SLICE' },
      ],
    },
    { key: 'foc', name: 'FOC service', sort: 4, basePct: '50', method: 'FLAT', flatRatePct: '5', commissionTypes: ['FOC'], bands: [] },
  ],
  incentives: [
    {
      key: 'group_ind', name: 'Group + individual target', type: 'GROUP_AND_INDIVIDUAL',
      individualMetricTypes: ['SVC', 'PKG_SALE', 'PRD'], groupMetric: 'SALON_CASH',
      rows: [
        { groupTarget: '30000', individualTarget: '12000', amount: '100' },
        { groupTarget: '40000', individualTarget: '15000', amount: '200' },
        { groupTarget: '50000', individualTarget: '17000', amount: '300' },
      ],
    },
  ],
};

export const TP_MANI_PEDI_2019: PlanDefinition = {
  stages: [{ key: 'std', name: 'Standard', fromMonth: 1, toMonth: null }],
  components: [
    { key: 'cash_course', name: 'Cash & Course Services', sort: 1, basePct: '100', method: 'FLAT', flatRatePct: '10', commissionTypes: ['SVC', 'PKG_RED', 'VP_SPEND'], bands: [] },
    { key: 'product', name: 'Product', sort: 2, basePct: '100', method: 'FLAT', flatRatePct: '10', commissionTypes: ['PRD'], categoryExclude: ['Beauty'], bands: [] },
    {
      key: 'package', name: 'Package', sort: 3, basePct: '100', method: 'TIER_WHOLE', commissionTypes: ['PKG_SALE', 'VP_SALE'],
      bands: [
        { upperLimit: '4000', ratePct: '2' },
        { upperLimit: '6000', ratePct: '4' },
        { upperLimit: '8000', ratePct: '5' },
        { upperLimit: null, ratePct: '7' },
      ],
    },
    { key: 'beauty', name: 'Beauty product', sort: 4, basePct: '100', method: 'FLAT', flatRatePct: '5', commissionTypes: ['PRD'], categoryInclude: ['Beauty'], bands: [] },
  ],
  incentives: [
    {
      key: 'personal', name: 'Personal target', type: 'INDIVIDUAL_TARGET', individualMetricTypes: ['SVC', 'PKG_SALE', 'PRD'], groupMetric: 'SALON_CASH',
      rows: [
        { individualTarget: '10000', amount: '50' },
        { individualTarget: '13000', amount: '100' },
        { individualTarget: '16000', amount: '150' },
      ],
    },
  ],
};

export const SEED_PLANS = [
  { id: 'plan_hair_2022', name: 'Hair Commission Scheme 2022', positions: ['Hair stylist', 'Hair therapist'], effectiveFrom: '2022-01-01', definition: HAIR_2022 },
  { id: 'plan_tp_2019', name: 'TP Mani & Pedi Scheme', positions: ['Nail technician'], effectiveFrom: '2019-05-01', definition: TP_MANI_PEDI_2019 },
];
