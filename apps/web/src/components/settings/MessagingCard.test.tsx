import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { messagingSettingsSchema, type MessagingSettingsInput } from "@glampro_suite/shared";

/**
 * The card talks to four things: the API, the session (for the role), the toast
 * store, and the URL (the tab lives in `?messages=`). All four are mocked or
 * provided here, so an assertion about "no request was made" is about the card
 * and not about a query client's retry policy.
 */
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
  post: vi.fn(),
  getErrorMessage: vi.fn(),
  getValidationDetails: vi.fn(),
  showToast: vi.fn(),
  role: "SUPER_ADMIN",
}));

vi.mock("@/lib/api", () => ({
  get: mocks.get,
  put: mocks.put,
  post: mocks.post,
  getErrorMessage: mocks.getErrorMessage,
  getValidationDetails: mocks.getValidationDetails,
}));

vi.mock("@/components/ui/toast-store", () => ({ showToast: mocks.showToast }));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ tenant: { id: "test-salon" }, user: { globalRole: mocks.role } }),
}));

import MessagingCard from "./MessagingCard";

/** The API's own defaults, so the fixture cannot drift from the contract. */
const settings = (patch: Partial<MessagingSettingsInput> = {}) =>
  messagingSettingsSchema.parse(patch);

const published = () =>
  settings({
    whatsappEnabled: true,
    consentVersion: "2026-01",
    serviceConsentText: "We text you about your appointments.",
    marketingConsentText: "We may send offers. You can decline.",
  });

interface Row {
  id: string;
  kind: string;
  channel: string | null;
  status: string;
  attempts: number;
  errorCode: string | null;
  dueAt: string;
  createdAt: string;
}

const row = (patch: Partial<Row> = {}): Row => ({
  id: "job-1",
  kind: "CONFIRMATION",
  channel: "SMS",
  status: "SENT",
  attempts: 1,
  errorCode: null,
  dueAt: "2026-11-06T09:00:00.000Z",
  createdAt: "2026-11-05T09:00:00.000Z",
  ...patch,
});

function mount({ canEdit = true, route = "/settings?section=messages" } = {}) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[route]}>
        <MessagingCard canEdit={canEdit} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const historyCalls = () =>
  mocks.get.mock.calls.filter(([url]) => String(url).startsWith("/messaging/history"));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.role = "SUPER_ADMIN";
  mocks.getErrorMessage.mockReturnValue("Configure the sender first.");
  mocks.getValidationDetails.mockReturnValue({});
  mocks.get.mockImplementation((url: string) =>
    Promise.resolve(url.startsWith("/messaging/history") ? { rows: [], total: 0 } : settings()),
  );
  mocks.put.mockImplementation((_url: string, body: MessagingSettingsInput) =>
    Promise.resolve(body),
  );
  mocks.post.mockResolvedValue({ queued: true });
});

describe("messaging card", () => {
  it("opens on the settings tab and does not request history", async () => {
    mount();

    expect(await screen.findByLabelText("Send SMS messages")).not.toBeChecked();
    expect(screen.getByLabelText("Send WhatsApp messages")).not.toBeChecked();
    expect(screen.getByLabelText("Reminder")).toHaveValue(24);
    expect(screen.getByLabelText("Rebooking prompt")).toHaveValue(28);
    expect(screen.getByText("Delivery channels")).toBeInTheDocument();
    expect(screen.getByText("Message timing")).toBeInTheDocument();
    expect(screen.getByText("Consent wording")).toBeInTheDocument();
    expect(screen.getByText("Off")).toBeInTheDocument();
    expect(historyCalls()).toHaveLength(0);
  });

  it("keeps the save off until something changes", async () => {
    mount();
    const user = userEvent.setup();

    const save = await screen.findByRole("button", { name: "Save messaging settings" });
    expect(save).toBeDisabled();
    expect(screen.getByRole("button", { name: "Discard changes" })).toBeDisabled();

    await user.click(screen.getByLabelText("Send SMS messages"));
    expect(save).toBeEnabled();
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(save).toBeDisabled();
    expect(screen.getByLabelText("Send SMS messages")).not.toBeChecked();
  });

  it("saves a switched-on channel and says so once", async () => {
    mocks.get.mockResolvedValue(published());
    mount();
    const user = userEvent.setup();

    await user.click(await screen.findByLabelText("Send SMS messages"));
    await user.click(screen.getByRole("button", { name: "Save messaging settings" }));

    await waitFor(() =>
      expect(mocks.put).toHaveBeenCalledWith(
        "/messaging/settings",
        expect.objectContaining({ smsEnabled: true, whatsappEnabled: true }),
      ),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Messaging settings saved.");
    expect(mocks.showToast).toHaveBeenCalledWith("success", "Messaging settings saved.");
    expect(screen.getByText("WhatsApp + SMS")).toBeInTheDocument();
  });

  it("requires consent wording and a version before a channel can go on", async () => {
    mount();
    const user = userEvent.setup();

    await user.click(await screen.findByLabelText("Send WhatsApp messages"));
    await user.click(screen.getByRole("button", { name: "Save messaging settings" }));

    expect(await screen.findByText("Add a version before switching a channel on.")).toBeVisible();
    expect(
      screen.getAllByText("Add the wording customers agree to before switching a channel on."),
    ).toHaveLength(2);
    expect(screen.getByText("Check the highlighted settings.")).toBeInTheDocument();
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it("requires a new version when the wording changes", async () => {
    mocks.get.mockResolvedValue(published());
    mount();
    const user = userEvent.setup();

    const wording = await screen.findByLabelText("Appointment and receipt wording");
    await user.clear(wording);
    await user.type(wording, "New wording.");
    await user.click(screen.getByRole("button", { name: "Save messaging settings" }));

    expect(await screen.findByText("New wording needs a new version.")).toBeVisible();
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it("sends new wording once a new version is given", async () => {
    mocks.get.mockResolvedValue(published());
    mount();
    const user = userEvent.setup();

    const wording = await screen.findByLabelText("Appointment and receipt wording");
    await user.clear(wording);
    await user.type(wording, "New wording.");
    const version = screen.getByLabelText("Consent version");
    await user.clear(version);
    await user.type(version, "2026-02");
    await user.click(screen.getByRole("button", { name: "Save messaging settings" }));

    await waitFor(() =>
      expect(mocks.put).toHaveBeenCalledWith(
        "/messaging/settings",
        expect.objectContaining({
          consentVersion: "2026-02",
          serviceConsentText: "New wording.",
        }),
      ),
    );
  });

  it("shows the server's refusal in the server's words", async () => {
    mocks.get.mockResolvedValue(published());
    mocks.put.mockRejectedValue(new Error("refused"));
    mocks.getErrorMessage.mockReturnValue("Configure this channel's sender and template first.");
    mount();
    const user = userEvent.setup();

    await user.click(await screen.findByLabelText("Send SMS messages"));
    await user.click(screen.getByRole("button", { name: "Save messaging settings" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Configure this channel's sender and template first.",
    );
    // The draft stays: nothing was saved, so throwing the edit away would lie.
    expect(screen.getByLabelText("Send SMS messages")).toBeChecked();
  });

  it("puts a field error the server reports on that field", async () => {
    mocks.get.mockResolvedValue(published());
    mocks.put.mockRejectedValue(new Error("validation"));
    mocks.getValidationDetails.mockReturnValue({
      consentVersion: "That version is already in use.",
    });
    mount();
    const user = userEvent.setup();

    await user.click(await screen.findByLabelText("Send SMS messages"));
    await user.click(screen.getByRole("button", { name: "Save messaging settings" }));

    expect(await screen.findByText("That version is already in use.")).toBeVisible();
  });

  it("re-seeds the draft from what the server stored", async () => {
    mocks.get.mockResolvedValue(published());
    mocks.put.mockResolvedValue({ ...published(), smsEnabled: true, reminderHours: 48 });
    mount();
    const user = userEvent.setup();

    await user.click(await screen.findByLabelText("Send SMS messages"));
    await user.click(screen.getByRole("button", { name: "Save messaging settings" }));

    await waitFor(() => expect(screen.getByLabelText("Reminder")).toHaveValue(48));
    expect(screen.getByRole("button", { name: "Save messaging settings" })).toBeDisabled();
  });

  it("shows the settings read-only without offering a save", async () => {
    mount({ canEdit: false });

    expect(await screen.findByLabelText("Send SMS messages")).toBeDisabled();
    expect(screen.getByLabelText("Consent version")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save messaging settings" })).toBeDisabled();
    expect(screen.getByText(/You can read these settings but not change them/)).toBeInTheDocument();
  });

  it("loads delivery history only when its tab is opened, and once", async () => {
    mount();
    const user = userEvent.setup();

    await screen.findByLabelText("Send SMS messages");
    expect(historyCalls()).toHaveLength(0);

    await user.click(screen.getByRole("tab", { name: "Delivery history" }));
    await waitFor(() => expect(mocks.get).toHaveBeenCalledWith("/messaging/history", { page: 1 }));

    await user.click(screen.getByRole("tab", { name: "Channels & timing" }));
    await user.click(screen.getByRole("tab", { name: "Delivery history" }));
    expect(historyCalls()).toHaveLength(1);
  });

  it("opens straight onto history when the URL says so", async () => {
    mount({ route: "/settings?section=messages&messages=history" });

    expect(await screen.findByText("No messages yet")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Delivery history" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(historyCalls()).toHaveLength(1);
  });

  it("hides the history tab from a role that cannot read it", async () => {
    mocks.role = "STAFF";
    mount();

    await screen.findByLabelText("Send SMS messages");
    expect(screen.queryByRole("tab", { name: "Delivery history" })).not.toBeInTheDocument();
  });

  it("does not open history for a staff role even when the URL asks", async () => {
    mocks.role = "STAFF";
    mount({ route: "/settings?section=messages&messages=history" });

    expect(await screen.findByLabelText("Send SMS messages")).toBeInTheDocument();
    expect(historyCalls()).toHaveLength(0);
  });
});

describe("delivery history", () => {
  const serveRows = (rows: Row[], total = rows.length) =>
    mocks.get.mockImplementation((url: string) =>
      Promise.resolve(url.startsWith("/messaging/history") ? { rows, total } : settings()),
    );

  it("names the outcome and why a message was not sent", async () => {
    serveRows([
      row({ id: "job-1", status: "DELIVERED" }),
      row({
        id: "job-2",
        kind: "REMINDER",
        status: "SUPPRESSED",
        errorCode: "QUIET_HOURS_MISSED",
      }),
    ]);
    mount({ route: "/settings?section=messages&messages=history" });

    expect(await screen.findByText("Delivered")).toBeInTheDocument();
    expect(screen.getByText("Not sent")).toBeInTheDocument();
    expect(screen.getByText("Quiet hours pushed it past the appointment.")).toBeInTheDocument();
    expect(screen.getByText("Appointment reminder")).toBeInTheDocument();
  });

  it("offers Retry only on the rows the API would accept", async () => {
    serveRows([
      row({ id: "job-1", status: "FAILED", errorCode: "30007" }),
      row({ id: "job-2", status: "FAILED", errorCode: "21610", attempts: 3 }),
    ]);
    mount({ route: "/settings?section=messages&messages=history" });
    const user = userEvent.setup();

    const retry = await screen.findAllByRole("button", { name: "Retry" });
    expect(retry).toHaveLength(1);
    // The STOP reply is a refusal, not a transient failure — the row says so.
    expect(screen.getByText("The customer replied STOP.")).toBeInTheDocument();

    await user.click(retry[0]);
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith("/messaging/history/job-1/retry"));
    expect(mocks.showToast).toHaveBeenCalledWith("success", "Message queued again.");
  });

  it("offers no Retry to a reader who cannot write", async () => {
    serveRows([row({ status: "FAILED", errorCode: "30007" })]);
    mount({ canEdit: false, route: "/settings?section=messages&messages=history" });

    expect(await screen.findByText("Failed")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("explains an empty history rather than showing a bare grid", async () => {
    mount({ route: "/settings?section=messages&messages=history" });

    expect(await screen.findByText("No messages yet")).toBeInTheDocument();
    expect(screen.getByText(/appear here once a channel is on/)).toBeInTheDocument();
  });

  it("says so when the history cannot be loaded", async () => {
    mocks.get.mockImplementation((url: string) =>
      url.startsWith("/messaging/history")
        ? Promise.reject(new Error("offline"))
        : Promise.resolve(settings()),
    );
    mount({ route: "/settings?section=messages&messages=history" });

    expect(await screen.findByText("Delivery history could not be loaded.")).toBeInTheDocument();
  });
});
