import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import Switch from "../Switch";

describe("Switch", () => {
  it("takes its name from the label and reports its state", () => {
    const { rerender } = render(<Switch label="Packages" checked={false} onChange={vi.fn()} />);
    const control = screen.getByRole("switch", { name: "Packages" });

    expect(control).toHaveAttribute("aria-checked", "false");

    rerender(<Switch label="Packages" checked onChange={vi.fn()} />);
    expect(control).toHaveAttribute("aria-checked", "true");
  });

  it("toggles from the keyboard with Space and Enter", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Switch label="Packages" checked={false} onChange={onChange} />);

    await user.tab();
    expect(screen.getByRole("switch")).toHaveFocus();

    await user.keyboard(" ");
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenNthCalledWith(1, true);
    expect(onChange).toHaveBeenNthCalledWith(2, true);
  });

  it("sends the opposite of the state it is showing", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Switch label="Packages" checked onChange={onChange} />);

    await user.click(screen.getByRole("switch"));
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("describes the setting without renaming the control", () => {
    render(
      <Switch
        label="Packages"
        description="Off. Sign-in uses only your password."
        checked={false}
        onChange={vi.fn()}
      />,
    );

    const control = screen.getByRole("switch", { name: "Packages" });
    expect(control).toHaveAccessibleDescription("Off. Sign-in uses only your password.");
  });

  it("refuses input while a change is in flight", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Switch label="Packages" checked={false} onChange={onChange} loading />);

    const control = screen.getByRole("switch");
    expect(control).toBeDisabled();
    expect(control).toHaveAttribute("aria-busy", "true");

    await user.click(control);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("stays inert when the setting cannot be changed from here", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Switch label="Customers" checked disabled onChange={onChange} />);

    await user.click(screen.getByRole("switch"));
    expect(onChange).not.toHaveBeenCalled();
  });
});
