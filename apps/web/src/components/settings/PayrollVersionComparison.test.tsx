import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { hairPayrollExample } from "@glampro_suite/shared";
import PayrollVersionComparison from "./PayrollVersionComparison";
import type { PayrollPostedMoney } from "./payroll-impact";
import { payrollDefinitionChanges } from "./payroll-version-diff";

function plans() {
  const original = hairPayrollExample();
  const revised = structuredClone(original);
  revised.components[0]!.name = "Revised cash";
  return {
    original,
    revised,
    list: [
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
    ],
  };
}
/** Money the readiness check published, calculated against one saved version. */
function posted(
  version: { id: string; versionNo: number; status: string; effectiveFrom: string } = {
    id: "v2",
    versionNo: 2,
    status: "DRAFT",
    effectiveFrom: "2027-01-01",
  },
): PayrollPostedMoney {
  return {
    periodKey: "2026-09",
    inputSource: "FROZEN_CLOSE",
    impact: {
      currency: "SGD",
      calculationVersion: 1,
      inputHash: "hash",
      afterVersion: version,
      rows: [
        {
          staffId: "amy",
          staffName: "Amy",
          disabled: false,
          assignedVersion: { id: "v1", versionNo: 1 },
          beforeTotal: "120.00",
          afterTotal: "135.50",
          change: "15.50",
        },
        {
          staffId: "bob",
          staffName: "Bob",
          disabled: true,
          assignedVersion: { id: "v1", versionNo: 1 },
          beforeTotal: "80.00",
          afterTotal: "75.00",
          change: "-5.00",
        },
      ],
      staffWithoutActivity: [{ staffId: "cat", staffName: "Cat", disabled: false }],
      totals: { before: "200.00", after: "210.50", change: "10.50" },
    },
  };
}

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

it("selects saved versions and unsaved rules and never invents money for them", async () => {
  const { revised, list } = plans();
  const draft = structuredClone(revised);
  draft.components[0]!.name = "Unsaved cash";
  render(<PayrollVersionComparison versions={list} draft={draft} />);
  expect(screen.getByText(/After:/)).toHaveTextContent("Revised cash");
  expect(screen.getByText(/Posted money is not part of a rule diff/)).toHaveTextContent(
    "Check historical inputs",
  );
  await userEvent.selectOptions(screen.getByLabelText("Compare to version"), "unsaved");
  expect(screen.getByText(/After:/)).toHaveTextContent("Unsaved cash");
  expect(
    screen.queryByRole("region", { name: "Posted money under the selected version" }),
  ).not.toBeInTheDocument();
});

it("shows the published money against the version it was calculated for", () => {
  const { list } = plans();
  render(<PayrollVersionComparison versions={list} postedMoney={posted()} />);
  const money = screen.getByRole("region", { name: "Posted money under the selected version" });
  expect(money).toHaveTextContent("Posted 2026-09 commission: S$200.00");
  expect(money).toHaveTextContent("with version 2 (DRAFT, effective 2027-01-01): S$210.50");
  expect(money).toHaveTextContent("change +S$10.50");
  expect(money).toHaveTextContent("Money source: the month's frozen approved calculation");
  expect(screen.getByRole("row", { name: /Amy/ })).toHaveTextContent("+S$15.50");
  expect(screen.getByRole("row", { name: /Bob/ })).toHaveTextContent("-S$5.00");
  expect(screen.getByRole("row", { name: /Salon total/ })).toHaveTextContent("S$210.50");
  // The posted month is valued under one version; it is not a version-to-version delta.
  expect(money).toHaveTextContent(
    "not the difference between the two rule versions selected above",
  );
  // A staff member without authoritative activity is named, never given a zero.
  expect(screen.getByText(/Cat/)).toHaveTextContent("no zero amount is assumed");
});

it("withholds money calculated for another version until that version is selected", async () => {
  const { list } = plans();
  render(
    <PayrollVersionComparison
      versions={list}
      postedMoney={posted({
        id: "v1",
        versionNo: 1,
        status: "PUBLISHED",
        effectiveFrom: "2026-01-01",
      })}
    />,
  );
  expect(screen.getByText(/Posted money was calculated against version 1/)).toHaveTextContent(
    "not recalculated per rule version",
  );
  expect(
    screen.queryByRole("region", { name: "Posted money under the selected version" }),
  ).not.toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText("Compare to version"), "v1");
  expect(
    screen.getByRole("region", { name: "Posted money under the selected version" }),
  ).toHaveTextContent("with version 1 (PUBLISHED, effective 2026-01-01): S$210.50");
});

it("separates an unvalued month, a draft selection and money already published", async () => {
  const { revised, list } = plans();
  const draft = structuredClone(revised);
  const { rerender } = render(
    <PayrollVersionComparison versions={list} postedMoney={null} draft={draft} />,
  );
  expect(screen.getByText(/could not value the posted month/)).toHaveTextContent(
    "no posted money is shown here",
  );
  rerender(<PayrollVersionComparison versions={list} postedMoney={posted()} draft={draft} />);
  expect(
    screen.getByRole("region", { name: "Posted money under the selected version" }),
  ).toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText("Compare to version"), "unsaved");
  expect(screen.getByText(/unsaved draft has no posted-money estimate/)).toHaveTextContent(
    "save it and check historical inputs",
  );
  expect(
    screen.queryByRole("region", { name: "Posted money under the selected version" }),
  ).not.toBeInTheDocument();
});
