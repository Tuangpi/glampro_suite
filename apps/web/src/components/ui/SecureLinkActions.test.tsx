import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { messagingSettingsSchema } from "@glampro_suite/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  del: vi.fn(),
  get: vi.fn(),
  readOnly: false,
}));

vi.mock("@/lib/api", () => ({
  post: mocks.post,
  del: mocks.del,
  get: mocks.get,
  getErrorMessage: () => "Channel is disabled.",
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ isReadOnly: mocks.readOnly, tenant: { id: "test-salon" } }),
}));

import SecureLinkActions from "./SecureLinkActions";

/** Both channels on, every other field the API's own default. */
const BOTH_CHANNELS = messagingSettingsSchema.parse({ whatsappEnabled: true, smsEnabled: true });

/**
 * A real query client rather than a stubbed hook: the dialog promises to offer
 * only the channels the salon switched on, and that decision runs through
 * `useMessagingSettings` — mocking it away would leave the promise untested.
 */
function renderActions(props: React.ComponentProps<typeof SecureLinkActions>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SecureLinkActions {...props} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readOnly = false;
  mocks.get.mockResolvedValue(BOTH_CHANNELS);
});

describe("secure link actions", () => {
  it("creates a link only on request and discloses bearer access", async () => {
    mocks.post.mockResolvedValue({ url: "https://example.test/secret" });
    renderActions({ resource: "appointments", id: "booking" });
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
    renderActions({ resource: "sales", id: "sale", receipt: true });
    await userEvent.click(await screen.findByRole("button", { name: "Send receipt by SMS" }));
    expect(mocks.post).toHaveBeenCalledWith("/messaging/sales/sale/send", { channel: "SMS" });
    expect(await screen.findByRole("status")).toHaveTextContent("Queued does not mean delivered");
  });

  it("shows provider configuration failure without a delivery claim", async () => {
    mocks.post.mockRejectedValue(new Error());
    renderActions({ resource: "sales", id: "sale", receipt: true });
    await userEvent.click(await screen.findByRole("button", { name: "Send receipt by WhatsApp" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Channel is disabled.");
  });

  it("disables mutations in read-only salons", async () => {
    mocks.readOnly = true;
    renderActions({ resource: "sales", id: "sale", receipt: true });
    expect(screen.getByRole("button", { name: "Create secure receipt link" })).toBeDisabled();
    expect(await screen.findByRole("button", { name: "Send receipt by SMS" })).toBeDisabled();
  });

  it("offers only the channels the salon has switched on", async () => {
    mocks.get.mockResolvedValue(
      messagingSettingsSchema.parse({ whatsappEnabled: false, smsEnabled: true }),
    );
    renderActions({ resource: "sales", id: "sale", receipt: true });
    expect(await screen.findByRole("button", { name: "Send receipt by SMS" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Send receipt by WhatsApp" })).toBeNull();
    // The missing button is explained, not merely absent.
    expect(screen.getByText(/WhatsApp is off\. Turn it on in Settings/)).toBeInTheDocument();
  });

  it("sends nothing when the channel settings cannot be read", async () => {
    mocks.get.mockRejectedValue(new Error("boom"));
    renderActions({ resource: "sales", id: "sale", receipt: true });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Channel settings could not be loaded",
    );
    expect(screen.queryByRole("button", { name: "Send receipt by SMS" })).toBeNull();
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it("waits for the settings rather than guessing at the channels", () => {
    // Never settles: the dialog must not draw a send button it has no answer for.
    mocks.get.mockReturnValue(new Promise(() => {}));
    renderActions({ resource: "sales", id: "sale", receipt: true });
    expect(screen.getByText("Checking which channels are on…")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send receipt by SMS" })).toBeNull();
  });

  it("does not offer a send when the record has no customer to message", () => {
    renderActions({ resource: "sales", id: "sale", receipt: true, canMessage: false });
    expect(screen.getByText(/Save the customer on this record first/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send receipt by SMS" })).toBeNull();
    // The bearer link is still available — that is not a message.
    expect(screen.getByRole("button", { name: "Create secure receipt link" })).toBeEnabled();
  });
});
