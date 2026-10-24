import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PosStaffSwitch from "./PosStaffSwitch";
import { clearPosIdentity, getPosIdentity } from "@/lib/pos-identity";

const post = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/useStaff", () => ({
  useStaffList: () => ({
    data: { data: [{ id: "staff-1", name: "Ava", email: null }], pageCount: 1 },
  }),
}));
vi.mock("@/lib/api", () => ({ post, getErrorMessage: (error: Error) => error.message }));

describe("POS staff switching", () => {
  beforeEach(() => {
    clearPosIdentity();
    post.mockReset();
  });
  it("verifies an email-free staff identity without replacing the authenticated session", async () => {
    const user = userEvent.setup();
    post.mockResolvedValue({
      token: "assertion",
      staffId: "staff-1",
      name: "Ava",
      expiresAt: Date.now() + 900_000,
    });
    render(<PosStaffSwitch disabled={false} />);
    expect(screen.queryByLabelText("Staff PIN")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Switch staff" }));
    await user.selectOptions(screen.getByLabelText("POS staff"), "staff-1");
    await user.type(screen.getByLabelText("Staff PIN"), "123456");
    await user.click(screen.getByRole("button", { name: "Verify staff PIN" }));
    await waitFor(() => expect(getPosIdentity()?.staffId).toBe("staff-1"));
    expect(post).toHaveBeenCalledWith("/staff/pos-pin/verify", {
      staffId: "staff-1",
      pin: "123456",
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("Staff: Ava")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Switch staff" }));
    expect(screen.getByLabelText("Staff PIN")).toHaveValue("");
    await user.click(screen.getByRole("button", { name: "Use authenticated operator" }));
    expect(getPosIdentity()).toBeNull();
  });
  it("blocks verification for read-only salons", () => {
    render(<PosStaffSwitch disabled />);
    expect(screen.getByRole("button", { name: "Switch staff" })).toBeDisabled();
  });
});
