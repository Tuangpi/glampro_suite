import type { PayrollIncentive, PayrollPlanDefinition, PayrollStage } from "@glampro_suite/shared";
import { payrollCommissionTypeSchema } from "@glampro_suite/shared";
import Button from "@/components/ui/Button";
import Checkbox from "@/components/ui/Checkbox";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";

/** All edits stay in the parent's revision-bound draft. Publication validates the whole plan. */
export default function PayrollDefinitionEditor({
  definition,
  disabled,
  onChange,
}: {
  definition: PayrollPlanDefinition;
  disabled: boolean;
  onChange: (definition: PayrollPlanDefinition) => void;
}) {
  function stageChange(index: number, patch: Partial<PayrollStage>) {
    onChange({
      ...definition,
      stages: definition.stages.map((stage, i) => (i === index ? { ...stage, ...patch } : stage)),
    });
  }
  function removeStage(key: string) {
    onChange({
      ...definition,
      stages: definition.stages.filter((stage) => stage.key !== key),
      components: definition.components.map((component) => ({
        ...component,
        bands: component.bands.map((band) => ({
          ...band,
          stageRates: Object.fromEntries(
            Object.entries(band.stageRates ?? {}).filter(([stageKey]) => stageKey !== key),
          ),
        })),
      })),
    });
  }
  function incentiveChange(index: number, patch: Partial<PayrollIncentive>) {
    onChange({
      ...definition,
      incentives: definition.incentives.map((rule, i) =>
        i === index ? { ...rule, ...patch } : rule,
      ),
    });
  }
  function moveComponent(index: number, direction: -1 | 1) {
    const components = [...definition.components].sort((a, b) => a.sort - b.sort);
    const target = index + direction;
    if (target < 0 || target >= components.length) return;
    [components[index], components[target]] = [components[target], components[index]];
    onChange({
      ...definition,
      components: components.map((component, i) => ({ ...component, sort: i + 1 })),
    });
  }
  return (
    <fieldset
      disabled={disabled}
      className="space-y-5"
      aria-label="Plan stages, incentives and ordering"
    >
      <section aria-label="Tenure stages" className="space-y-3">
        <h3>Tenure stages</h3>
        <p className="text-sm text-ink-muted">
          Months start at 1. Stages must cover tenure without gaps or overlap; only the last stage
          is open-ended. No stages means Standard for everyone.
        </p>
        {definition.stages.map((stage, index) => (
          <div key={stage.key} className="space-y-2 rounded border border-line p-3">
            <Input
              label={`Stage ${index + 1} name`}
              value={stage.name}
              onChange={(e) => stageChange(index, { name: e.target.value })}
            />
            <Input
              label={`Stage ${index + 1} from month`}
              type="number"
              min={1}
              max={1200}
              step={1}
              value={Number.isFinite(stage.fromMonth) ? stage.fromMonth : ""}
              onChange={(e) =>
                stageChange(index, {
                  fromMonth: e.target.value === "" ? NaN : Number(e.target.value),
                })
              }
            />
            <Input
              label={`Stage ${index + 1} to month (blank = ongoing)`}
              type="number"
              min={1}
              max={1200}
              step={1}
              value={stage.toMonth === null || !Number.isFinite(stage.toMonth) ? "" : stage.toMonth}
              onChange={(e) =>
                stageChange(index, {
                  toMonth: e.target.value === "" ? null : Number(e.target.value),
                })
              }
            />
            <Button variant="secondary" onClick={() => removeStage(stage.key)}>
              Remove stage {index + 1}
            </Button>
          </div>
        ))}
        <Button
          variant="secondary"
          disabled={definition.stages.length >= 50}
          onClick={() => {
            const stages = [...definition.stages].sort((a, b) => a.fromMonth - b.fromMonth);
            const last = stages.at(-1);
            const end = last?.toMonth ?? last?.fromMonth ?? 0;
            onChange({
              ...definition,
              stages: [
                ...stages.map((stage) =>
                  stage === last && stage.toMonth === null ? { ...stage, toMonth: end } : stage,
                ),
                { key: crypto.randomUUID(), name: "New stage", fromMonth: end + 1, toMonth: null },
              ],
            });
          }}
        >
          Add tenure stage
        </Button>
      </section>
      <section aria-label="Incentive rules" className="space-y-3">
        <h3>Incentive rules</h3>
        <p className="text-sm text-ink-muted">
          Only the highest qualifying target row pays; rows do not stack. Individual targets must
          increase, and group targets must not decrease.
        </p>
        {definition.incentives.map((rule, index) => (
          <div key={rule.key} className="space-y-3 rounded border border-line p-3">
            <Input
              label={`Incentive ${index + 1} name`}
              value={rule.name}
              onChange={(e) => incentiveChange(index, { name: e.target.value })}
            />
            <Select
              label={`Incentive ${index + 1} type`}
              value={rule.type}
              options={[
                { value: "INDIVIDUAL_TARGET", label: "Individual target" },
                { value: "GROUP_AND_INDIVIDUAL", label: "Group and individual targets" },
              ]}
              onChange={(e) =>
                incentiveChange(index, {
                  type: e.target.value as PayrollIncentive["type"],
                  rows: rule.rows.map((row) => ({ ...row, groupTarget: row.groupTarget ?? "0" })),
                })
              }
            />
            <div
              className="flex flex-wrap gap-3"
              aria-label={`Incentive ${index + 1} individual metric`}
            >
              {payrollCommissionTypeSchema.options.map((type) => (
                <Checkbox
                  key={type}
                  label={`Incentive ${index + 1} counts ${type}`}
                  checked={rule.individualMetricTypes.includes(type)}
                  onChange={(e) =>
                    incentiveChange(index, {
                      individualMetricTypes: e.target.checked
                        ? [...rule.individualMetricTypes, type]
                        : rule.individualMetricTypes.filter((value) => value !== type),
                    })
                  }
                />
              ))}
            </div>
            <Select
              label={`Incentive ${index + 1} scope`}
              value={rule.scope}
              options={[
                { value: "SALON", label: "Whole salon" },
                { value: "OUTLET", label: "Each outlet" },
              ]}
              onChange={(e) =>
                incentiveChange(index, { scope: e.target.value as PayrollIncentive["scope"] })
              }
            />
            {rule.type === "GROUP_AND_INDIVIDUAL" && (
              <Select
                label={`Incentive ${index + 1} group metric`}
                value={rule.groupMetric}
                options={[
                  { value: "SALON_CASH", label: "Actual net cash collected" },
                  { value: "SUM_INDIVIDUAL", label: "Sum of staff individual metrics" },
                ]}
                onChange={(e) =>
                  incentiveChange(index, {
                    groupMetric: e.target.value as PayrollIncentive["groupMetric"],
                  })
                }
              />
            )}
            {rule.rows.map((row, rowIndex) => (
              <div key={rowIndex} className="grid gap-2 sm:grid-cols-2">
                <Input
                  label={`Incentive ${index + 1} row ${rowIndex + 1} individual target`}
                  inputMode="decimal"
                  value={row.individualTarget}
                  onChange={(e) =>
                    incentiveChange(index, {
                      rows: rule.rows.map((value, i) =>
                        i === rowIndex ? { ...value, individualTarget: e.target.value } : value,
                      ),
                    })
                  }
                />
                {rule.type === "GROUP_AND_INDIVIDUAL" && (
                  <Input
                    label={`Incentive ${index + 1} row ${rowIndex + 1} group target`}
                    inputMode="decimal"
                    value={row.groupTarget ?? ""}
                    onChange={(e) =>
                      incentiveChange(index, {
                        rows: rule.rows.map((value, i) =>
                          i === rowIndex ? { ...value, groupTarget: e.target.value } : value,
                        ),
                      })
                    }
                  />
                )}
                <Input
                  label={`Incentive ${index + 1} row ${rowIndex + 1} award`}
                  inputMode="decimal"
                  value={row.amount}
                  onChange={(e) =>
                    incentiveChange(index, {
                      rows: rule.rows.map((value, i) =>
                        i === rowIndex ? { ...value, amount: e.target.value } : value,
                      ),
                    })
                  }
                />
                <Button
                  variant="secondary"
                  onClick={() =>
                    incentiveChange(index, { rows: rule.rows.filter((_, i) => i !== rowIndex) })
                  }
                >
                  Remove incentive {index + 1} row {rowIndex + 1}
                </Button>
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                disabled={rule.rows.length >= 100}
                onClick={() =>
                  incentiveChange(index, {
                    rows: [...rule.rows, { individualTarget: "", groupTarget: "", amount: "0" }],
                  })
                }
              >
                Add incentive {index + 1} target row
              </Button>
              <Button
                variant="secondary"
                onClick={() =>
                  onChange({
                    ...definition,
                    incentives: definition.incentives.filter((_, i) => i !== index),
                  })
                }
              >
                Remove incentive {index + 1}
              </Button>
            </div>
          </div>
        ))}
        <Button
          variant="secondary"
          disabled={definition.incentives.length >= 50}
          onClick={() =>
            onChange({
              ...definition,
              incentives: [
                ...definition.incentives,
                {
                  key: crypto.randomUUID(),
                  name: "New incentive",
                  type: "INDIVIDUAL_TARGET",
                  individualMetricTypes: ["SVC", "PKG_SALE", "PRD"],
                  groupMetric: "SALON_CASH",
                  scope: "SALON",
                  rows: [{ individualTarget: "0", amount: "0" }],
                },
              ],
            })
          }
        >
          Add incentive rule
        </Button>
      </section>
      <section aria-label="Component display order" className="space-y-2">
        <h3>Component display order</h3>
        {[...definition.components]
          .sort((a, b) => a.sort - b.sort)
          .map((component, index) => (
            <div key={component.key} className="flex flex-wrap items-center gap-2">
              <span>
                {index + 1}. {component.name}
              </span>
              <Button
                variant="secondary"
                disabled={index === 0}
                onClick={() => moveComponent(index, -1)}
              >
                Move {component.name} up
              </Button>
              <Button
                variant="secondary"
                disabled={index === definition.components.length - 1}
                onClick={() => moveComponent(index, 1)}
              >
                Move {component.name} down
              </Button>
            </div>
          ))}
      </section>
    </fieldset>
  );
}
