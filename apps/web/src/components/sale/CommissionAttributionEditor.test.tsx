import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import CommissionAttributionEditor from "./CommissionAttributionEditor";

const team = [
  { id: "amy", name: "Amy" },
  { id: "ben", name: "Ben" },
];
describe("CommissionAttributionEditor", () => {
  it("records seller and performer independently, including the same person", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <CommissionAttributionEditor
        sellers={team}
        performers={team}
        disabled={false}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Commission attribution" }));
    await user.click(screen.getByRole("button", { name: "Add seller" }));
    await user.selectOptions(screen.getByLabelText("sellers staff 1"), "amy");
    await user.click(screen.getByRole("button", { name: "Add therapist" }));
    await user.selectOptions(screen.getByLabelText("performers staff 1"), "amy");
    await user.click(screen.getByRole("button", { name: "Save attribution" }));
    expect(onChange).toHaveBeenCalledWith({
      sellers: [{ staffId: "amy", share: 10000 }],
      performers: [{ staffId: "amy", share: 10000 }],
    });
  });
  it("refuses duplicate staff and incomplete split totals", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <CommissionAttributionEditor
        sellers={team}
        disabled={false}
        onChange={onChange}
        value={{
          sellers: [
            { staffId: "amy", share: 5000 },
            { staffId: "ben", share: 5000 },
          ],
        }}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Commission attribution" }));
    await user.selectOptions(screen.getByLabelText("sellers staff 2"), "amy");
    await user.click(screen.getByRole("button", { name: "Save attribution" }));
    expect(screen.getByRole("alert")).toHaveTextContent("only once");
    await user.selectOptions(screen.getByLabelText("sellers staff 2"), "ben");
    await user.clear(screen.getByLabelText("sellers percent 2"));
    await user.type(screen.getByLabelText("sellers percent 2"), "40");
    await user.click(screen.getByRole("button", { name: "Save attribution" }));
    expect(screen.getByRole("alert")).toHaveTextContent("100%");
    expect(onChange).not.toHaveBeenCalled();
  });
  it("does not open while disabled", () => {
    render(<CommissionAttributionEditor sellers={team} disabled onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Commission attribution" })).toBeDisabled();
  });
});
