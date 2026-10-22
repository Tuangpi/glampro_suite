import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import type { CreateTreatmentRecordInput } from "@glampro_suite/shared";

const { create, update, redemptions } = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  redemptions: vi.fn(),
}));
vi.mock("@/hooks/useTreatments", () => ({
  useCreateTreatment: () => ({ mutateAsync: create, isPending: false }),
  useUpdateTreatment: () => ({ mutateAsync: update, isPending: false }),
  useTreatmentRedemptions: redemptions,
}));
import TreatmentRecordForm from "../treatments/TreatmentRecordForm";

const record: CreateTreatmentRecordInput = {
  customerId: "customer-1",
  serviceId: "service-1",
  treatmentType: "Facial",
  status: "COMPLETED",
  quantityConsumed: 2,
};
beforeEach(() => {
  vi.clearAllMocks();
  create.mockResolvedValue({});
  update.mockResolvedValue({});
  redemptions.mockReturnValue({
    data: {
      data: [
        {
          id: "redemption-1",
          receiptNumber: 42,
          usedAt: "2026-10-22T01:00:00Z",
          packageName: "Facial package",
          quantity: 2,
          services: [{ id: "service-1", name: "Facial" }],
        },
      ],
      pageCount: 2,
    },
    isPending: false,
    isFetching: false,
    isError: false,
    refetch: vi.fn(),
  });
});

it("links POS evidence without accepting another deduction quantity", async () => {
  const user = userEvent.setup();
  render(
    <TreatmentRecordForm
      open
      record={record}
      recordId={null}
      onClose={vi.fn()}
      onSaved={vi.fn()}
    />,
  );
  expect(screen.queryByLabelText("Package sessions consumed")).not.toBeInTheDocument();
  expect(screen.getByText(/never deducts again/)).toBeInTheDocument();
  await user.selectOptions(
    screen.getByLabelText("POS package redemption"),
    "redemption-1:service-1",
  );
  await user.click(screen.getByRole("button", { name: "Create record" }));
  await waitFor(() =>
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ packageRedemptionId: "redemption-1", quantityConsumed: 0 }),
    ),
  );
});

it("preserves historical quantities on ordinary clinical edits", async () => {
  const user = userEvent.setup();
  render(
    <TreatmentRecordForm
      open
      record={record}
      recordId="treatment-1"
      onClose={vi.fn()}
      onSaved={vi.fn()}
    />,
  );
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(update).toHaveBeenCalled());
  expect(update.mock.calls[0]![0].input).not.toHaveProperty("quantityConsumed");
  expect(update.mock.calls[0]![0].input).not.toHaveProperty("packageRedemptionId");
});

it("explicitly clears linkage without asking POS to restore sessions", async () => {
  const user = userEvent.setup();
  render(
    <TreatmentRecordForm
      open
      record={{ ...record, packageRedemptionId: "redemption-1" }}
      recordId="treatment-1"
      onClose={vi.fn()}
      onSaved={vi.fn()}
    />,
  );
  await user.selectOptions(screen.getByLabelText("POS package redemption"), "");
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ packageRedemptionId: null }) }),
    ),
  );
});

it("shows salon-local date/time and leaves unchanged instants out of clinical patches", async () => {
  const user = userEvent.setup();
  render(
    <TreatmentRecordForm
      open
      record={{ ...record, startedAt: "2026-10-22T01:30:45.000Z" }}
      recordId="treatment-1"
      onClose={vi.fn()}
      onSaved={vi.fn()}
    />,
  );
  expect(screen.getByLabelText("Started at")).toHaveValue("2026-10-22T09:30");
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(update).toHaveBeenCalled());
  expect(update.mock.calls[0]![0].input).not.toHaveProperty("startedAt");
});

it("converts salon-local treatment times into UTC instants", async () => {
  const user = userEvent.setup();
  render(
    <TreatmentRecordForm
      open
      record={record}
      recordId={null}
      onClose={vi.fn()}
      onSaved={vi.fn()}
    />,
  );
  await user.type(screen.getByLabelText("Started at"), "2026-10-22T09:30");
  await user.click(screen.getByRole("button", { name: "Create record" }));
  await waitFor(() =>
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ startedAt: "2026-10-22T01:30:00.000Z" }),
    ),
  );
});

it("fills the covered service from POS evidence and clears the link when customer changes", async () => {
  const user = userEvent.setup();
  render(
    <TreatmentRecordForm
      open
      record={{ ...record, serviceId: undefined }}
      recordId={null}
      onClose={vi.fn()}
      onSaved={vi.fn()}
    />,
  );
  await user.selectOptions(
    screen.getByLabelText("POS package redemption"),
    "redemption-1:service-1",
  );
  expect(screen.getByLabelText("Service reference")).toHaveValue("service-1");
  expect(screen.getByLabelText("Service reference")).toBeDisabled();
  await user.clear(screen.getByLabelText("Customer reference"));
  await user.type(screen.getByLabelText("Customer reference"), "customer-2");
  expect(screen.getByLabelText("POS package redemption")).toHaveValue("");
  expect(redemptions).toHaveBeenLastCalledWith("customer-2", undefined, 1);
});

it("pages eligible evidence without losing the selected redemption", async () => {
  const user = userEvent.setup();
  const { rerender } = render(
    <TreatmentRecordForm
      open
      record={record}
      recordId={null}
      onClose={vi.fn()}
      onSaved={vi.fn()}
    />,
  );
  await user.selectOptions(
    screen.getByLabelText("POS package redemption"),
    "redemption-1:service-1",
  );
  await user.click(screen.getByRole("button", { name: "Next redemptions" }));
  expect(redemptions).toHaveBeenLastCalledWith("customer-1", undefined, 2);
  redemptions.mockReturnValue({
    data: { data: [], pageCount: 2 },
    isPending: false,
    isFetching: false,
    isError: false,
  });
  rerender(
    <TreatmentRecordForm
      open
      record={record}
      recordId={null}
      onClose={vi.fn()}
      onSaved={vi.fn()}
    />,
  );
  expect(screen.getByLabelText("POS package redemption")).toHaveValue("redemption-1:service-1");
  expect(
    screen.getByRole("option", { name: /Receipt #42.*Facial package.*2 session/ }),
  ).toBeInTheDocument();
});

it("preserves unavailable or reversed existing evidence on ordinary edits", async () => {
  redemptions.mockReturnValue({
    data: { data: [], pageCount: 0 },
    isPending: false,
    isFetching: false,
    isError: false,
  });
  const user = userEvent.setup();
  render(
    <TreatmentRecordForm
      open
      record={{ ...record, packageRedemptionId: "old-redemption" }}
      recordId="treatment-1"
      onClose={vi.fn()}
      onSaved={vi.fn()}
    />,
  );
  expect(screen.getByRole("option", { name: /kept unchanged.*reversed/ })).toBeInTheDocument();
  expect(redemptions).toHaveBeenLastCalledWith("customer-1", "service-1", 1);
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  expect(update.mock.calls[0]![0].input).not.toHaveProperty("packageRedemptionId");
});

it("shows loading and retryable errors without removing existing evidence", async () => {
  const refetch = vi.fn();
  redemptions.mockReturnValue({ isPending: true, isFetching: true, isError: false });
  const props = {
    open: true,
    record: { ...record, packageRedemptionId: "old-redemption" },
    recordId: "treatment-1",
    onClose: vi.fn(),
    onSaved: vi.fn(),
  };
  const { rerender } = render(<TreatmentRecordForm {...props} />);
  expect(screen.getByRole("status")).toHaveTextContent("Loading POS redemptions");
  redemptions.mockReturnValue({
    isPending: false,
    isFetching: false,
    isError: true,
    error: new Error("Evidence unavailable"),
    refetch,
  });
  rerender(<TreatmentRecordForm {...props} />);
  expect(screen.getByRole("alert")).toHaveTextContent("Evidence unavailable");
  await userEvent.click(screen.getByRole("button", { name: "Retry redemptions" }));
  expect(refetch).toHaveBeenCalledOnce();
  expect(screen.getByLabelText("POS package redemption")).toHaveValue("old-redemption:service-1");
});

it("does not offer linkage for immutable historical records without a service", () => {
  render(
    <TreatmentRecordForm
      open
      record={{ ...record, serviceId: undefined }}
      recordId="treatment-1"
      onClose={vi.fn()}
      onSaved={vi.fn()}
    />,
  );
  expect(screen.getByLabelText("POS package redemption")).toBeDisabled();
  expect(screen.getByText(/historical record has no service/)).toBeInTheDocument();
});
