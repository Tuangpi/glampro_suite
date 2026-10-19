import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn(), save: vi.fn(), readOnly: false }));
vi.mock("@/hooks/useConsent", () => ({
  useCustomerConsent: mocks.query,
  useRecordCustomerConsent: () => ({ mutateAsync: mocks.save, isPending: false }),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ isReadOnly: mocks.readOnly }) }));
vi.mock("@/lib/api", () => ({
  getErrorMessage: () => "Consent changed. Reload before recording a new choice.",
}));
import CustomerConsentPanel from "./CustomerConsentPanel";

const notice = {
  id: "n1",
  version: "v1",
  dataConsentText: "Approved personal-data purposes",
  marketingConsentText: "Optional promotional messages",
  createdAt: "2026-10-19T00:00:00Z",
};
function data(overrides = {}) {
  return {
    pdpaConsent: false,
    marketingOptIn: false,
    revision: 0,
    currentNotice: notice,
    history: [],
    total: 0,
    page: 1,
    pageSize: 10,
    ...overrides,
  };
}
beforeEach(() => {
  mocks.readOnly = false;
  mocks.save.mockReset().mockResolvedValue({});
  mocks.query.mockReturnValue({ data: data(), isPending: false, isError: false });
});
describe("customer consent", () => {
  it("starts unchecked and requires presenting the notice before recording a grant", async () => {
    const user = userEvent.setup();
    render(<CustomerConsentPanel customerId="c1" />);
    expect(screen.getByText(notice.dataConsentText)).toBeInTheDocument();
    expect(screen.getByLabelText("Personal-data consent granted")).not.toBeChecked();
    expect(screen.getByLabelText("Optional marketing opt-in")).not.toBeChecked();
    await user.click(screen.getByLabelText("Personal-data consent granted"));
    expect(screen.getByRole("button", { name: "Save consent choices" })).toBeDisabled();
    await user.click(
      screen.getByLabelText("I presented this notice and recorded the customer's choices"),
    );
    await user.click(screen.getByRole("button", { name: "Save consent choices" }));
    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith({
        pdpaConsent: true,
        marketingOptIn: false,
        expectedRevision: 0,
        noticeId: "n1",
      }),
    );
  });
  it("disables grants before configuration but still permits withdrawal", async () => {
    mocks.query.mockReturnValue({ data: data({ currentNotice: null }), isPending: false });
    const view = render(<CustomerConsentPanel customerId="c1" />);
    expect(screen.getByLabelText("Personal-data consent granted")).toBeDisabled();
    view.unmount();
    mocks.query.mockReturnValue({
      data: data({ currentNotice: null, pdpaConsent: true, marketingOptIn: true, revision: 4 }),
      isPending: false,
    });
    render(<CustomerConsentPanel customerId="c1" />);
    const user = userEvent.setup();
    await user.click(screen.getByLabelText("Personal-data consent granted"));
    expect(screen.getByLabelText("Optional marketing opt-in")).not.toBeChecked();
    await user.click(screen.getByRole("button", { name: "Save consent choices" }));
    expect(mocks.save).toHaveBeenCalledWith({
      pdpaConsent: false,
      marketingOptIn: false,
      expectedRevision: 4,
      noticeId: null,
    });
  });
  it("blocks editing in a read-only tenant", () => {
    mocks.readOnly = true;
    render(<CustomerConsentPanel customerId="c1" />);
    expect(screen.getByLabelText("Personal-data consent granted")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save consent choices" })).toBeDisabled();
  });
  it("shows fetch failure rather than assuming no consent", () => {
    mocks.query.mockReturnValue({ isError: true, refetch: vi.fn() });
    render(<CustomerConsentPanel customerId="c1" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Consent could not be loaded");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
  it("shows failed writes without claiming success", async () => {
    mocks.query.mockReturnValue({
      data: data({ pdpaConsent: true, marketingOptIn: true }),
      isPending: false,
    });
    mocks.save.mockRejectedValue(new Error("conflict"));
    render(<CustomerConsentPanel customerId="c1" />);
    const user = userEvent.setup();
    await user.click(screen.getByLabelText("Optional marketing opt-in"));
    await user.click(screen.getByRole("button", { name: "Save consent choices" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Consent changed");
    expect(screen.queryByText("Consent choices saved.")).not.toBeInTheDocument();
  });
});
