import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import type { CreateTreatmentRecordInput } from "@glampro_suite/shared";

const { create, update } = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn() }));
vi.mock("@/hooks/useTreatments", () => ({
  useCreateTreatment: () => ({ mutateAsync: create, isPending: false }),
  useUpdateTreatment: () => ({ mutateAsync: update, isPending: false }),
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
  await user.type(screen.getByLabelText("POS package redemption reference"), "redemption-1");
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
  await user.clear(screen.getByLabelText("POS package redemption reference"));
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
