import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { PAYROLL_DEFAULT_SETTINGS } from "@glampro_suite/shared";
import {
  PayrollProfileForm,
  PayrollSalonSettingsForm,
  PayrollStaffSettingsForm,
  PayrollPlanMetadataForm,
} from "./PayrollSettingsForms";

const profile = {
  revision: 3,
  basicSalary: "1000",
  fixedOvertime: "50",
  levy: "0",
  salesAlertPct: "40",
};

it("submits explicit commission classification without inferring it from login role", async () => {
  const user = userEvent.setup();
  const save = vi.fn();
  const value = { revision: 1, joinDate: "2026-09-01", stageEndOverride: null };
  const { rerender } = render(<PayrollStaffSettingsForm value={value} canEdit save={save} />);
  expect(screen.getByLabelText("Commission role classification")).toHaveValue("");
  await user.selectOptions(
    screen.getByLabelText("Commission role classification"),
    "COMMISSION_EARNING",
  );
  await user.click(screen.getByRole("button", { name: "Save staff payroll settings" }));
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({
      commissionRole: "COMMISSION_EARNING",
      expectedRevision: 1,
    }),
  );
  rerender(
    <PayrollStaffSettingsForm
      value={{ ...value, revision: 2, commissionRole: "NON_COMMISSION" }}
      canEdit
      save={save}
    />,
  );
  expect(screen.getByRole("button", { name: "Save staff payroll settings" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Reload staff payroll settings" }));
  expect(screen.getByLabelText("Commission role classification")).toHaveValue("NON_COMMISSION");
});

it("validates metadata and retains its original revision until explicit reload", async () => {
  const save = vi.fn();
  const user = userEvent.setup();
  const value = { revision: 1, name: "Hair", description: "Initial", positions: [], outletIds: [] };
  const { rerender } = render(<PayrollPlanMetadataForm value={value} canEdit save={save} />);
  await user.clear(screen.getByLabelText("Plan name"));
  expect(screen.getByRole("button", { name: "Save plan metadata" })).toBeDisabled();
  await user.type(screen.getByLabelText("Plan name"), "Hair revised");
  await user.type(
    screen.getByLabelText("Plan positions (comma-separated, blank = all)"),
    "Stylist, Senior, Stylist",
  );
  await user.click(screen.getByRole("button", { name: "Save plan metadata" }));
  expect(save).toHaveBeenCalledWith({
    expectedRevision: 1,
    name: "Hair revised",
    description: "Initial",
    positions: ["Stylist", "Senior"],
    outletIds: [],
  });
  rerender(
    <PayrollPlanMetadataForm
      value={{ ...value, revision: 2, name: "Server name" }}
      canEdit
      save={save}
    />,
  );
  expect(screen.getByLabelText("Plan name")).toHaveValue("Hair revised");
  expect(screen.getByRole("button", { name: "Save plan metadata" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Reload plan metadata" }));
  expect(screen.getByLabelText("Plan name")).toHaveValue("Server name");
  expect(screen.getByLabelText("Plan positions (comma-separated, blank = all)")).toHaveValue("");
});

it("submits exact salary values with the original expected revision", async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  const user = userEvent.setup();
  render(<PayrollProfileForm value={profile} canEdit save={save} />);
  await user.clear(screen.getByLabelText("Basic monthly salary"));
  await user.type(screen.getByLabelText("Basic monthly salary"), "1234.5678");
  await user.click(screen.getByRole("button", { name: "Save salary profile" }));
  expect(save).toHaveBeenCalledWith({
    expectedRevision: 3,
    basicSalary: "1234.5678",
    fixedOvertime: "50",
    levy: "0",
    salesAlertPct: "40",
  });
});

it("validates nonnegative salary and percentage bounds before submission", async () => {
  const save = vi.fn();
  const user = userEvent.setup();
  render(<PayrollProfileForm value={profile} canEdit save={save} />);
  await user.clear(screen.getByLabelText("Monthly levy"));
  await user.type(screen.getByLabelText("Monthly levy"), "-1");
  await user.clear(screen.getByLabelText("Sales alert percentage"));
  await user.type(screen.getByLabelText("Sales alert percentage"), "101");
  expect(screen.getByRole("button", { name: "Save salary profile" })).toBeDisabled();
  expect(screen.getByRole("alert")).toHaveTextContent("Maximum is 100%");
  expect(save).not.toHaveBeenCalled();
});

it("preserves local salary edits and blocks silent rebasing on a newer revision", async () => {
  const save = vi.fn();
  const user = userEvent.setup();
  const { rerender } = render(<PayrollProfileForm value={profile} canEdit save={save} />);
  await user.clear(screen.getByLabelText("Basic monthly salary"));
  await user.type(screen.getByLabelText("Basic monthly salary"), "1200");
  rerender(
    <PayrollProfileForm
      value={{ ...profile, revision: 4, basicSalary: "1500" }}
      canEdit
      save={save}
    />,
  );
  expect(screen.getByLabelText("Basic monthly salary")).toHaveValue("1200");
  expect(screen.getByRole("button", { name: "Save salary profile" })).toBeDisabled();
  expect(screen.getByRole("alert")).toHaveTextContent("changed");
  await user.click(screen.getByRole("button", { name: "Reload salary profile" }));
  expect(screen.getByLabelText("Basic monthly salary")).toHaveValue("1500");
  await user.click(screen.getByRole("button", { name: "Save salary profile" }));
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({ expectedRevision: 4, basicSalary: "1500" }),
  );
});

it("keeps all controls read-only for manager or pending requests", () => {
  render(<PayrollProfileForm value={profile} canEdit={false} save={vi.fn()} />);
  expect(screen.getByLabelText("Basic monthly salary")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Save salary profile" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Reload salary profile" })).toBeDisabled();
});

it("requires a valid join date and supports explicit zero or automatic stage override", async () => {
  const save = vi.fn();
  const user = userEvent.setup();
  render(
    <PayrollStaffSettingsForm
      value={{ revision: 2, joinDate: null, stageEndOverride: null }}
      canEdit
      save={save}
    />,
  );
  expect(screen.getByRole("button", { name: "Save staff payroll settings" })).toBeDisabled();
  await user.type(screen.getByLabelText("Staff join date"), "2026-09-01");
  const override = screen.getByLabelText("Stage end override (tenure month, blank = automatic)");
  await user.type(override, "0");
  await user.click(screen.getByRole("button", { name: "Save staff payroll settings" }));
  expect(save).toHaveBeenLastCalledWith({
    expectedRevision: 2,
    expectedJoinDate: null,
    joinDate: "2026-09-01",
    stageEndOverride: 0,
  });
  await user.clear(override);
  await user.click(screen.getByRole("button", { name: "Save staff payroll settings" }));
  expect(save).toHaveBeenLastCalledWith({
    expectedRevision: 2,
    expectedJoinDate: null,
    joinDate: "2026-09-01",
    stageEndOverride: null,
  });
  await user.type(override, "1201");
  expect(screen.getByRole("button", { name: "Save staff payroll settings" })).toBeDisabled();
});

it("validates staff settings revision conflicts before a reload", async () => {
  const save = vi.fn();
  const user = userEvent.setup();
  const value = { revision: 1, joinDate: "2026-09-01", stageEndOverride: null };
  const { rerender } = render(<PayrollStaffSettingsForm value={value} canEdit save={save} />);
  rerender(
    <PayrollStaffSettingsForm
      value={{ ...value, revision: 2, stageEndOverride: 6 }}
      canEdit
      save={save}
    />,
  );
  expect(screen.getByRole("button", { name: "Save staff payroll settings" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Reload staff payroll settings" }));
  await user.click(screen.getByRole("button", { name: "Save staff payroll settings" }));
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({ expectedRevision: 2, stageEndOverride: 6 }),
  );
});

it("detects employment date changes from the staff API even when the payroll revision is unchanged", async () => {
  const save = vi.fn();
  const user = userEvent.setup();
  const value = { revision: 1, joinDate: "2026-09-01", stageEndOverride: null };
  const { rerender } = render(<PayrollStaffSettingsForm value={value} canEdit save={save} />);
  rerender(
    <PayrollStaffSettingsForm value={{ ...value, joinDate: "2026-08-01" }} canEdit save={save} />,
  );
  expect(screen.getByLabelText("Staff join date")).toHaveValue("2026-09-01");
  expect(screen.getByRole("button", { name: "Save staff payroll settings" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Reload staff payroll settings" }));
  expect(screen.getByLabelText("Staff join date")).toHaveValue("2026-08-01");
  await user.click(screen.getByRole("button", { name: "Save staff payroll settings" }));
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({ expectedJoinDate: "2026-08-01", expectedRevision: 1 }),
  );
});

it("submits structured salon settings and preserves nullable cutoff semantics", async () => {
  const save = vi.fn();
  const user = userEvent.setup();
  render(
    <PayrollSalonSettingsForm
      value={{ revision: 5, ...PAYROLL_DEFAULT_SETTINGS }}
      canEdit
      save={save}
    />,
  );
  await user.type(screen.getByLabelText("Join-after cutoff day (blank = no cutoff)"), "15");
  await user.selectOptions(screen.getByLabelText("Negative commission base policy"), "WRITE_OFF");
  await user.clear(screen.getByLabelText("Minimum package deposit percentage"));
  await user.type(screen.getByLabelText("Minimum package deposit percentage"), "35.5");
  await user.clear(screen.getByLabelText("Refund administration fee"));
  await user.type(screen.getByLabelText("Refund administration fee"), "99.90");
  await user.click(screen.getByLabelText("Require staff attribution"));
  await user.click(screen.getByRole("button", { name: "Save salon commission settings" }));
  expect(save).toHaveBeenLastCalledWith({
    expectedRevision: 5,
    joinAfterDay: 15,
    negativeBase: "WRITE_OFF",
    minimumDepositPct: "35.5",
    refundAdminFee: "99.90",
    requireAttribution: false,
  });
  await user.clear(screen.getByLabelText("Join-after cutoff day (blank = no cutoff)"));
  await user.click(screen.getByRole("button", { name: "Save salon commission settings" }));
  expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ joinAfterDay: null }));
});

it("rejects invalid salon settings and blocks saving newer revisions until reloaded", async () => {
  const save = vi.fn();
  const user = userEvent.setup();
  const value = { revision: 0, ...PAYROLL_DEFAULT_SETTINGS };
  const { rerender } = render(<PayrollSalonSettingsForm value={value} canEdit save={save} />);
  await user.type(screen.getByLabelText("Join-after cutoff day (blank = no cutoff)"), "32");
  expect(screen.getByRole("button", { name: "Save salon commission settings" })).toBeDisabled();
  rerender(
    <PayrollSalonSettingsForm
      value={{ ...value, revision: 1, minimumDepositPct: "45" }}
      canEdit
      save={save}
    />,
  );
  expect(screen.getByLabelText("Minimum package deposit percentage")).toHaveValue("30");
  await user.click(screen.getByRole("button", { name: "Reload salon commission settings" }));
  await user.click(screen.getByRole("button", { name: "Save salon commission settings" }));
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({ expectedRevision: 1, minimumDepositPct: "45" }),
  );
});
