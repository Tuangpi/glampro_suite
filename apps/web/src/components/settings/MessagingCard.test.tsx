import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { messagingSettingsSchema } from "@glampro_suite/shared";
const mocks = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), post: vi.fn() }));
vi.mock("@/lib/api", () => ({ ...mocks, getErrorMessage: () => "Configure the sender first." }));
import MessagingCard from "./MessagingCard";
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ tenant: { id: "test-salon" } }) }));
function mount(canEdit = true) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MessagingCard canEdit={canEdit} />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.get.mockImplementation((url: string) =>
    Promise.resolve(
      url.includes("history") ? { rows: [], total: 0 } : messagingSettingsSchema.parse({}),
    ),
  );
  mocks.put.mockResolvedValue({});
});
describe("messaging settings", () => {
  it("loads delivery history only when requested", async () => {
    mount();
    await screen.findByLabelText("Enable SMS");
    expect(mocks.get).not.toHaveBeenCalledWith(expect.stringContaining("history"));
    await userEvent.click(screen.getByText("View delivery history"));
    await screen.findByText("Message delivery history");
    await waitFor(() => expect(mocks.get).toHaveBeenCalledWith("/messaging/history?page=1"));
  });

  it("starts disabled and saves timing/channel settings without credentials", async () => {
    mount();
    const user = userEvent.setup();
    const sms = await screen.findByLabelText("Enable SMS");
    expect(sms).not.toBeChecked();
    expect(screen.getByLabelText("Enable WhatsApp")).not.toBeChecked();
    expect(screen.getByLabelText("Reminder lead time (hours)")).toHaveValue(24);
    await user.click(sms);
    await user.click(screen.getByRole("button", { name: "Save messaging settings" }));
    await waitFor(() =>
      expect(mocks.put).toHaveBeenCalledWith(
        "/messaging/settings",
        expect.objectContaining({ smsEnabled: true, whatsappEnabled: false }),
      ),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Messaging settings saved.");
  });
  it("shows configuration errors rather than claiming a successful activation", async () => {
    mocks.put.mockRejectedValue(new Error("missing sender"));
    mount();
    await screen.findByLabelText("Enable SMS");
    await userEvent.click(screen.getByRole("button", { name: "Save messaging settings" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Configure the sender first.");
  });
  it("does not allow read-only configuration or history actions", async () => {
    mount(false);
    expect(await screen.findByLabelText("Enable SMS")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save messaging settings" })).toBeDisabled();
    expect(mocks.get).not.toHaveBeenCalledWith(expect.stringContaining("history"));
  });
});
