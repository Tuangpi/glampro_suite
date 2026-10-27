import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { hairPayrollExample } from "@glampro_suite/shared";
import PayrollVersionComparison from "./PayrollVersionComparison";
import { payrollDefinitionChanges } from "./payroll-version-diff";

it("compares stable component keys and reports exact changes, additions and removals", () => {
  expect(
    payrollDefinitionChanges(
      [{ key: "a", rate: "1" }, { key: "b" }],
      [{ key: "b" }, { key: "a", rate: "2" }],
    ),
  ).toEqual([{ path: "definition[a].rate", before: "1", after: "2" }]);
  expect(payrollDefinitionChanges({ a: "1" }, { b: "2" })).toEqual([
    { path: "definition.a", before: "1", after: undefined },
    { path: "definition.b", before: undefined, after: "2" },
  ]);
});

it("selects saved versions and unsaved rules without claiming historical impact", async () => {
  const original = hairPayrollExample();
  const revised = structuredClone(original);
  revised.components[0]!.name = "Revised cash";
  const draft = structuredClone(revised);
  draft.components[0]!.name = "Unsaved cash";
  render(
    <PayrollVersionComparison
      versions={[
        {
          id: "v2",
          versionNo: 2,
          status: "DRAFT",
          effectiveFrom: "2027-01-01",
          definition: revised,
        },
        {
          id: "v1",
          versionNo: 1,
          status: "PUBLISHED",
          effectiveFrom: "2026-01-01",
          definition: original,
        },
      ]}
      draft={draft}
    />,
  );
  expect(screen.getByText(/After:/)).toHaveTextContent("Revised cash");
  await userEvent.selectOptions(screen.getByLabelText("Compare to version"), "unsaved");
  expect(screen.getByText(/After:/)).toHaveTextContent("Unsaved cash");
  expect(screen.getByText(/not a historical payroll impact/)).toBeInTheDocument();
});
