import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), save: vi.fn() }));
vi.mock("@/hooks/useConsent", () => ({
  usePrivacyNotice: mocks.query,
  useConfigurePrivacyNotice: () => ({ mutateAsync: mocks.save, isPending: false }),
}));
vi.mock("@/lib/api", () => ({ getErrorMessage: () => "Use a new version." }));
import PrivacyNoticeCard from "./PrivacyNoticeCard";
beforeEach(() => {
  mocks.query.mockReturnValue({ data: null, isPending: false, isError: false });
  mocks.save.mockReset().mockResolvedValue({});
});
describe("privacy notice settings", () => {
  it("does not invent legal wording and publishes both separate texts", async () => {
    const user = userEvent.setup();
    render(<PrivacyNoticeCard canEdit />);
    expect(screen.getByText(/No notice configured/)).toBeInTheDocument();
    expect(screen.getByLabelText("Personal-data consent notice")).toHaveValue("");
    await user.type(screen.getByLabelText("New notice version"), "v1");
    await user.type(screen.getByLabelText("Personal-data consent notice"), "Approved data purpose");
    await user.type(
      screen.getByLabelText("Optional marketing consent notice"),
      "Optional promotions",
    );
    await user.click(screen.getByRole("button", { name: "Publish privacy notice" }));
    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith({
        version: "v1",
        dataConsentText: "Approved data purpose",
        marketingConsentText: "Optional promotions",
      }),
    );
  });
  it("keeps notice configuration read-only for unauthorized roles", () => {
    render(<PrivacyNoticeCard canEdit={false} />);
    expect(screen.getByLabelText("Personal-data consent notice")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Publish privacy notice" })).toBeDisabled();
  });
});
