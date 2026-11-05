import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CustomerDetail, PrivacyNotice } from "@glampro_suite/shared";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  record: vi.fn(),
  notice: null as PrivacyNotice | null,
  noticePending: false,
  toast: vi.fn(),
}));

vi.mock("@/hooks/useCustomers", () => ({
  useCreateCustomer: () => ({ mutateAsync: mocks.create, isPending: false }),
  useUpdateCustomer: () => ({ mutateAsync: mocks.update, isPending: false }),
}));
vi.mock("@/hooks/useConsent", () => ({
  usePrivacyNotice: () => ({ data: mocks.notice, isPending: mocks.noticePending }),
  useRecordConsentForNewCustomer: () => ({ mutateAsync: mocks.record, isPending: false }),
  useCustomerConsent: () => ({
    data: undefined,
    isPending: true,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  }),
  useRecordCustomerConsent: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/components/ui/toast-store", () => ({ showToast: mocks.toast }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ isReadOnly: false, tenant: { id: "tenant-1" } }),
}));
vi.mock("@/contexts/SalonFormattingContext", () => ({
  useSalonFormatting: () => ({ formatDate: (value: string) => value }),
}));
vi.mock("@/lib/api", () => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
  getPaginated: vi.fn(),
  getErrorMessage: (error: unknown) => (error instanceof Error ? error.message : "Request failed"),
  getValidationDetails: () => ({}),
}));

import CustomerFormDrawer from "./CustomerFormDrawer";

const notice = {
  id: "n1",
  version: "v2",
  dataConsentText: "Approved personal-data purposes",
  marketingConsentText: "Optional promotional messages",
  createdAt: "2026-10-19T00:00:00Z",
} as PrivacyNotice;

const created = { id: "new-1", name: "Aina Rahman" } as CustomerDetail;

const DATA_CONSENT = "Personal-data consent granted";
const MARKETING = "Optional marketing opt-in";
const REVIEWED = "I presented this notice and recorded the customer's choices";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.notice = notice;
  mocks.noticePending = false;
  mocks.create.mockResolvedValue(created);
  mocks.record.mockResolvedValue({});
});

async function fillAndSubmit(): Promise<void> {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/^Name/), "Aina Rahman");
  await user.click(screen.getByRole("button", { name: "Add customer" }));
}

describe("adding a customer with consent", () => {
  it("records the choices against the new record at revision 0", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<CustomerFormDrawer open customer={null} onClose={onClose} />);

    await user.type(screen.getByLabelText(/^Name/), "Aina Rahman");
    await user.click(screen.getByLabelText(DATA_CONSENT));
    await user.click(screen.getByLabelText(REVIEWED));
    await user.click(screen.getByRole("button", { name: "Add customer" }));

    await waitFor(() =>
      expect(mocks.record).toHaveBeenCalledWith({
        id: "new-1",
        input: {
          pdpaConsent: true,
          marketingOptIn: false,
          expectedRevision: 0,
          noticeId: "n1",
        },
      }),
    );
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ name: "Aina Rahman" }));
    expect(mocks.toast).toHaveBeenCalledWith("success", "Customer added and consent recorded.");
    expect(onClose).toHaveBeenCalled();
  });

  it("carries a marketing opt-in alongside the data consent", async () => {
    const user = userEvent.setup();
    render(<CustomerFormDrawer open customer={null} onClose={vi.fn()} />);

    await user.type(screen.getByLabelText(/^Name/), "Aina Rahman");
    await user.click(screen.getByLabelText(DATA_CONSENT));
    await user.click(screen.getByLabelText(MARKETING));
    await user.click(screen.getByLabelText(REVIEWED));
    await user.click(screen.getByRole("button", { name: "Add customer" }));

    await waitFor(() =>
      expect(mocks.record).toHaveBeenCalledWith({
        id: "new-1",
        input: {
          pdpaConsent: true,
          marketingOptIn: true,
          expectedRevision: 0,
          noticeId: "n1",
        },
      }),
    );
  });

  it("saves the customer alone when no choice was made", async () => {
    const onClose = vi.fn();
    render(<CustomerFormDrawer open customer={null} onClose={onClose} />);
    await fillAndSubmit();

    await waitFor(() => expect(mocks.create).toHaveBeenCalled());
    expect(mocks.record).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith("success", "Customer added.");
    expect(onClose).toHaveBeenCalled();
  });

  it("saves the customer with no consent when the salon has published no notice", async () => {
    mocks.notice = null;
    render(<CustomerFormDrawer open customer={null} onClose={vi.fn()} />);

    expect(
      screen.getByText(/Consent capture is disabled until a manager publishes a privacy notice/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(DATA_CONSENT)).toBeDisabled();

    await fillAndSubmit();
    await waitFor(() => expect(mocks.create).toHaveBeenCalled());
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it("will not create the customer until the notice has been presented", async () => {
    const user = userEvent.setup();
    render(<CustomerFormDrawer open customer={null} onClose={vi.fn()} />);

    await user.type(screen.getByLabelText(/^Name/), "Aina Rahman");
    await user.click(screen.getByLabelText(DATA_CONSENT));
    await user.click(screen.getByRole("button", { name: "Add customer" }));

    expect(
      await screen.findByText("Confirm you presented the privacy notice before recording consent."),
    ).toBeInTheDocument();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it("keeps the drawer on the new record when the consent request fails", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onCreated = vi.fn();
    mocks.record.mockRejectedValue(new Error("A newer privacy notice is in force."));
    render(<CustomerFormDrawer open customer={null} onClose={onClose} onCreated={onCreated} />);

    await user.type(screen.getByLabelText(/^Name/), "Aina Rahman");
    await user.click(screen.getByLabelText(DATA_CONSENT));
    await user.click(screen.getByLabelText(REVIEWED));
    await user.click(screen.getByRole("button", { name: "Add customer" }));

    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(
        "error",
        "Customer added, but consent was not saved: A newer privacy notice is in force.",
      ),
    );
    // The record exists, so the drawer is handed it and stays open to finish.
    expect(onCreated).toHaveBeenCalledWith(created);
    expect(onClose).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalledWith("success", "Customer added and consent recorded.");
  });
});
