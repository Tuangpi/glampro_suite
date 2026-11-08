/**
 * Incentives (FR-INC). Pays the amount of the HIGHEST row whose conditions are all met.
 * Rows are not cumulative.
 */
import { IncentiveResult, IncentiveRule } from '../types.js';
import { D, money2 } from '../money.js';

export function evaluateIncentive(rule: IncentiveRule, individualMetric: string, groupMetric: string | null): IncentiveResult {
  let best: number | null = null;
  rule.rows.forEach((row, i) => {
    const indOk = D(individualMetric).gte(D(row.individualTarget));
    const grpOk = rule.type === 'INDIVIDUAL_TARGET' || (groupMetric !== null && D(groupMetric).gte(D(row.groupTarget ?? '0')));
    if (indOk && grpOk && (best === null || D(row.amount).gt(D(rule.rows[best].amount)))) best = i;
  });
  return {
    ruleKey: rule.key,
    name: rule.name,
    individualMetric: money2(individualMetric),
    groupMetric: rule.type === 'GROUP_AND_INDIVIDUAL' && groupMetric !== null ? money2(groupMetric) : null,
    rowIndex: best,
    amount: best === null ? '0.00' : money2(rule.rows[best].amount),
  };
}
