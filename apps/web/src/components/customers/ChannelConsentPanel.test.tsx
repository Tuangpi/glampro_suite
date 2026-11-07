import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { messagingSettingsSchema } from "@glampro_suite/shared";
import { beforeEach, expect, it, vi } from "vitest";
import ChannelConsentPanel from "./ChannelConsentPanel";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  capabilities: { whatsappAvailable: false, smsAvailable: false },
  smsEnabled: true,
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ tenant: { id: "salon" }, isReadOnly: false }),
}));
vi.mock("@/lib/api", () => ({
  get: mocks.get,
  post: vi.fn(),
  getErrorMessage: () => "Unavailable",
}));

function mount() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ChannelConsentPanel customerId="customer" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.capabilities = { whatsappAvailable: false, smsAvailable: false };
  mocks.smsEnabled = true;
  mocks.get.mockImplementation(async (url: string) => {
    if (url === "/messaging/capabilities") return mocks.capabilities;
    const settings = messagingSettingsSchema.parse({
      smsEnabled: mocks.smsEnabled,
      whatsappEnabled: true,
    });
    if (url === "/messaging/settings") return settings;
    return { settings, choices: [] };
  });
});

it("hides consent controls and skips customer consent requests while system channels are unavailable", async () => {
  mount();
  await waitFor(() => expect(mocks.get).toHaveBeenCalledWith("/messaging/settings"));
  expect(screen.queryByRole("region", { name: "Messaging consent" })).toBeNull();
  expect(mocks.get).not.toHaveBeenCalledWith("/messaging/customers/customer");
});

it("shows consent only for a system-ready, salon-enabled channel", async () => {
  mocks.capabilities = { whatsappAvailable: false, smsAvailable: true };
  mount();
  expect(await screen.findByRole("button", { name: "Save SMS choices" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Save WHATSAPP choices" })).toBeNull();
});

it("hides consent for channels the salon has disabled", async () => {
  mocks.capabilities = { whatsappAvailable: false, smsAvailable: true };
  mocks.smsEnabled = false;
  mount();
  await waitFor(() => expect(mocks.get).toHaveBeenCalledWith("/messaging/settings"));
  expect(screen.queryByRole("region", { name: "Messaging consent" })).toBeNull();
  expect(mocks.get).not.toHaveBeenCalledWith("/messaging/customers/customer");
});
