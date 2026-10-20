import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ post: vi.fn(), del: vi.fn(), readOnly: false }));
vi.mock("@/lib/api", () => ({
  post: mocks.post,
  del: mocks.del,
  getErrorMessage: () => "Channel is disabled.",
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ isReadOnly: mocks.readOnly }) }));
import SecureLinkActions from "./SecureLinkActions";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.readOnly = false;
});
describe("secure link actions", () => {
  it("creates a link only on request and discloses bearer access", async () => {
    mocks.post.mockResolvedValue({ url: "https://example.test/secret" });
    render(<SecureLinkActions resource="appointments" id="booking" />);
    expect(mocks.post).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Create secure booking link" }));
    expect(await screen.findByLabelText("Secure sharing link")).toHaveValue(
      "https://example.test/secret",
    );
    expect(mocks.post).toHaveBeenCalledWith("/messaging/appointments/booking/link");
    expect(screen.getByText(/Anyone with this link/)).toBeInTheDocument();
  });
  it("reports queue status separately from delivery and uses the explicit selected channel", async () => {
    mocks.post.mockResolvedValue({ status: "PENDING" });
    render(<SecureLinkActions resource="sales" id="sale" receipt />);
    await userEvent.click(screen.getByRole("button", { name: "Send receipt by SMS" }));
    expect(mocks.post).toHaveBeenCalledWith("/messaging/sales/sale/send", { channel: "SMS" });
    expect(await screen.findByRole("status")).toHaveTextContent("Queued does not mean delivered");
  });
  it("shows provider configuration failure without a delivery claim", async () => {
    mocks.post.mockRejectedValue(new Error());
    render(<SecureLinkActions resource="sales" id="sale" receipt />);
    await userEvent.click(screen.getByRole("button", { name: "Send receipt by WhatsApp" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Channel is disabled.");
  });
  it("disables mutations in read-only salons", () => {
    mocks.readOnly = true;
    render(<SecureLinkActions resource="sales" id="sale" receipt />);
    expect(screen.getByRole("button", { name: "Create secure receipt link" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send receipt by SMS" })).toBeDisabled();
  });
});
