import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import TreatmentRetention from "../treatments/TreatmentRetention";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  save: vi.fn(),
  retry: vi.fn(),
  role: "MANAGER",
  readOnly: false,
  pending: false,
}));
vi.mock("@/hooks/useTreatments", () => ({
  useTreatment: mocks.query,
  useReviewTreatmentRetention: () => ({ mutateAsync: mocks.save, isPending: mocks.pending }),
  usePreviewTreatmentDisposal: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDisposeTreatment: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { globalRole: mocks.role }, isReadOnly: mocks.readOnly }),
}));
const record = {
  id: "t1",
  customerId: "c1",
  treatmentType: "Facial",
  updatedAt: "2026-10-22T00:00:00Z",
  retentionReviewAt: "2027-01-22T01:02:03.456Z",
  retentionReason: "Follow-up",
  retentionHold: true,
  retentionHoldReason: "Dispute",
  retentionReviewedById: "witness1",
  retentionReviewedAt: "2026-10-22T01:00:00Z",
};
const panel = () => <TreatmentRetention customerId="c1" recordId="t1" />;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.role = "MANAGER";
  mocks.readOnly = false;
  mocks.pending = false;
  mocks.query.mockReturnValue({ data: record, refetch: mocks.retry });
  mocks.save.mockResolvedValue(record);
});

it("shows current retention evidence and preserves the exact instant on an unchanged review", async () => {
  render(panel());
  expect(screen.getByText("witness1")).toBeInTheDocument();
  expect(screen.getByLabelText("Next review (Asia/Singapore)")).toHaveValue("2027-01-22T09:02");
  await userEvent.click(screen.getByRole("button", { name: "Review changes" }));
  expect(mocks.save).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Confirm retention review" }));
  await waitFor(() =>
    expect(mocks.save).toHaveBeenCalledWith({
      id: "t1",
      input: {
        reviewAt: record.retentionReviewAt,
        reason: "Follow-up",
        hold: true,
        holdReason: "Dispute",
      },
    }),
  );
});

it("converts a changed salon-local date to UTC and requires renewed confirmation after editing", async () => {
  render(panel());
  await userEvent.click(screen.getByRole("button", { name: "Review changes" }));
  const date = screen.getByLabelText("Next review (Asia/Singapore)");
  await userEvent.clear(date);
  await userEvent.type(date, "2027-02-23T10:30");
  expect(
    screen.queryByRole("button", { name: "Confirm retention review" }),
  ).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Review changes" }));
  await userEvent.click(screen.getByRole("button", { name: "Confirm retention review" }));
  expect(mocks.save).toHaveBeenCalledWith({
    id: "t1",
    input: expect.objectContaining({ reviewAt: "2027-02-23T02:30:00.000Z" }),
  });
});

it("warns before releasing a hold and removes the hold reason from the request", async () => {
  render(panel());
  await userEvent.click(screen.getByRole("checkbox", { name: "Retention hold" }));
  expect(screen.getByRole("alert")).toHaveTextContent("release the existing hold");
  await userEvent.click(screen.getByRole("button", { name: "Review changes" }));
  await userEvent.click(screen.getByRole("button", { name: "Confirm retention review" }));
  expect(mocks.save).toHaveBeenCalledWith({
    id: "t1",
    input: expect.objectContaining({ hold: false, holdReason: null }),
  });
});

it("preserves failed drafts for retry", async () => {
  mocks.save.mockRejectedValueOnce(new Error("Review refused"));
  render(panel());
  await userEvent.click(screen.getByRole("button", { name: "Review changes" }));
  await userEvent.click(screen.getByRole("button", { name: "Confirm retention review" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Review refused");
  expect(screen.getByLabelText("Retention hold reason")).toHaveValue("Dispute");
  await userEvent.click(screen.getByRole("button", { name: "Confirm retention review" }));
  expect(mocks.save).toHaveBeenCalledTimes(2);
});

it.each(["Reason for continued retention", "Retention hold reason"])(
  "rejects whitespace in %s without sending a review",
  async (label) => {
    render(panel());
    await userEvent.clear(screen.getByLabelText(label));
    await userEvent.type(screen.getByLabelText(label), "   ");
    await userEvent.click(screen.getByRole("button", { name: "Review changes" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm retention review" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(mocks.save).not.toHaveBeenCalled();
  },
);

it.each(["STAFF", "CASHIER"])(
  "keeps evidence readable without management controls for %s",
  (role) => {
    mocks.role = role;
    render(panel());
    expect(screen.getByText("witness1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Review changes" })).not.toBeInTheDocument();
  },
);

it("removes the editor on role loss or read-only transition", async () => {
  const view = render(panel());
  await userEvent.click(screen.getByRole("button", { name: "Review changes" }));
  mocks.role = "STAFF";
  view.rerender(panel());
  expect(
    screen.queryByRole("button", { name: "Confirm retention review" }),
  ).not.toBeInTheDocument();
  mocks.role = "SUPER_ADMIN";
  mocks.readOnly = true;
  view.rerender(panel());
  expect(screen.queryByLabelText("Reason for continued retention")).not.toBeInTheDocument();
  expect(mocks.save).not.toHaveBeenCalled();
});

it("blocks saves during detail refresh and mutation", () => {
  mocks.query.mockReturnValue({ data: record, isFetching: true });
  const view = render(panel());
  expect(screen.getByRole("button", { name: "Review changes" })).toBeDisabled();
  mocks.query.mockReturnValue({ data: record });
  mocks.pending = true;
  view.rerender(panel());
  expect(screen.getByRole("button", { name: "Review changes" })).toBeDisabled();
});

it("handles loading, retry and customer mismatch without exposing an editor", async () => {
  mocks.query.mockReturnValue({ isPending: true });
  const view = render(panel());
  expect(screen.getByRole("status")).toHaveTextContent("Loading retention");
  mocks.query.mockReturnValue({ isError: true, refetch: mocks.retry });
  view.rerender(panel());
  await userEvent.click(screen.getByRole("button", { name: "Retry retention" }));
  expect(mocks.retry).toHaveBeenCalled();
  mocks.query.mockReturnValue({ data: { ...record, customerId: "foreign" } });
  view.rerender(panel());
  expect(screen.getByRole("alert")).toHaveTextContent("unavailable for this customer");
  expect(screen.queryByRole("button", { name: "Review changes" })).not.toBeInTheDocument();
});
