import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import {
  hairPayrollExample,
  validatePayrollPlan,
  type PayrollPlanDefinition,
} from "@glampro_suite/shared";
import PayrollDefinitionEditor from "./PayrollDefinitionEditor";

function mount(disabled = false, initial = hairPayrollExample()) {
  let current = initial;
  function Editor() {
    const [definition, setDefinition] = useState<PayrollPlanDefinition>(initial);
    return (
      <PayrollDefinitionEditor
        definition={definition}
        disabled={disabled}
        onChange={(value) => {
          current = value;
          setDefinition(value);
        }}
      />
    );
  }
  render(<Editor />);
  return () => current;
}
it("edits tenure ranges while preserving stable stage keys and overrides", async () => {
  const value = mount();
  const user = userEvent.setup();
  await user.clear(screen.getByLabelText("Stage 1 to month (blank = ongoing)"));
  await user.type(screen.getByLabelText("Stage 1 to month (blank = ongoing)"), "4");
  await user.clear(screen.getByLabelText("Stage 2 from month"));
  await user.type(screen.getByLabelText("Stage 2 from month"), "5");
  expect(value().stages[0]).toEqual(expect.objectContaining({ key: "new", toMonth: 4 }));
  expect(value().stages[1]!.fromMonth).toBe(5);
  expect(validatePayrollPlan(value()).errors).toEqual([]);
  expect(value().components[0]!.bands[0]!.stageRates).toEqual({ new: "4" });
});
it("cleans orphaned band overrides when removing a stage", async () => {
  const value = mount();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Remove stage 1" }));
  expect(value().components[0]!.bands[0]!.stageRates).toEqual({});
  // Removing a range does not silently rewrite the remaining stage dates.
  expect(validatePayrollPlan(value()).errors).not.toEqual([]);
  await user.clear(screen.getByLabelText("Stage 1 from month"));
  await user.type(screen.getByLabelText("Stage 1 from month"), "1");
  expect(validatePayrollPlan(value()).errors).toEqual([]);
});
it("adds a contiguous stage and supports no-stage Standard plans", async () => {
  const initial = hairPayrollExample();
  initial.stages = [];
  const value = mount(false, initial);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Add tenure stage" }));
  expect(value().stages[0]).toEqual(expect.objectContaining({ fromMonth: 1, toMonth: null }));
  await user.click(screen.getByRole("button", { name: "Add tenure stage" }));
  expect(value().stages.map((s) => [s.fromMonth, s.toMonth])).toEqual([
    [1, 1],
    [2, null],
  ]);
});
it("edits incentive metrics, scope and exact decimal targets", async () => {
  const value = mount();
  const user = userEvent.setup();
  await user.selectOptions(screen.getByLabelText("Incentive 1 scope"), "OUTLET");
  await user.selectOptions(screen.getByLabelText("Incentive 1 group metric"), "SUM_INDIVIDUAL");
  await user.click(screen.getByLabelText("Incentive 1 counts VP_SALE"));
  await user.clear(screen.getByLabelText("Incentive 1 row 1 award"));
  await user.type(screen.getByLabelText("Incentive 1 row 1 award"), "123.45");
  expect(value().incentives[0]).toEqual(
    expect.objectContaining({
      scope: "OUTLET",
      groupMetric: "SUM_INDIVIDUAL",
      individualMetricTypes: ["SVC", "PKG_SALE", "PRD", "VP_SALE"],
    }),
  );
  expect(value().incentives[0]!.rows[0]!.amount).toBe("123.45");
  expect(validatePayrollPlan(value()).errors).toEqual([]);
});
it("adds and removes incentive rows without silently accepting invalid targets", async () => {
  const value = mount();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Add incentive 1 target row" }));
  expect(validatePayrollPlan(value()).errors).not.toEqual([]);
  await user.type(screen.getByLabelText("Incentive 1 row 4 individual target"), "20000");
  await user.type(screen.getByLabelText("Incentive 1 row 4 group target"), "60000");
  expect(validatePayrollPlan(value()).errors).toEqual([]);
  await user.click(screen.getByRole("button", { name: "Remove incentive 1 row 4" }));
  expect(value().incentives[0]!.rows).toHaveLength(3);
  await user.click(screen.getByRole("button", { name: "Add incentive rule" }));
  expect(value().incentives).toHaveLength(2);
  await user.click(screen.getByRole("button", { name: "Remove incentive 2" }));
  expect(value().incentives).toHaveLength(1);
});
it("reorders components using stable keys and explicit display positions", async () => {
  const value = mount();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Move Product up" }));
  expect(value().components.map((c) => [c.key, c.sort])).toEqual([
    ["product", 1],
    ["cash_pkg", 2],
    ["on_course", 3],
    ["foc", 4],
  ]);
  expect(screen.getByRole("button", { name: "Move Product up" })).toBeDisabled();
});
it("keeps every definition control read-only for managers and stale drafts", () => {
  mount(true);
  expect(screen.getByLabelText("Stage 1 name")).toBeDisabled();
  expect(screen.getByLabelText("Incentive 1 counts SVC")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Add incentive rule" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Move Product up" })).toBeDisabled();
});
