import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import TreatmentDisposal from "../treatments/TreatmentDisposal";

const mocks = vi.hoisted(() => ({
  preview: vi.fn(),
  dispose: vi.fn(),
  role: "SUPER_ADMIN",
  readOnly: false,
  busy: false,
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { globalRole: mocks.role }, isReadOnly: mocks.readOnly }),
}));
vi.mock("@/hooks/useTreatments", () => ({
  usePreviewTreatmentDisposal: () => ({ mutateAsync: mocks.preview, isPending: mocks.busy }),
  useDisposeTreatment: () => ({ mutateAsync: mocks.dispose, isPending: mocks.busy }),
}));
const preview = {
  treatmentRecordId: "t1",
  customerId: "c1",
  consentEvents: 3,
  signatures: 1,
  photoLinks: 2,
  previewToken: "signed",
  expiresAt: "2099-01-01T00:00:00.000Z",
};
const panel = (blocked = false) => (
  <TreatmentDisposal recordId="t1" customerId="c1" blocked={blocked} />
);
beforeEach(() => {
  vi.resetAllMocks();
  mocks.role = "SUPER_ADMIN";
  mocks.readOnly = false;
  mocks.busy = false;
  mocks.preview.mockResolvedValue(preview);
  mocks.dispose.mockResolvedValue({
    receiptId: "receipt1",
    treatmentRecordId: "t1",
    disposedAt: "2026-10-22T12:00:00.000Z",
  });
});

it("requires preview, reason and exact confirmation and displays a minimal receipt", async () => {
  render(panel());
  expect(screen.getByText(/Original customer photos/)).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Permanently dispose treatment" }),
  ).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Preview disposal" }));
  expect(mocks.preview).toHaveBeenCalledWith("t1");
  expect(
    await screen.findByText(/3 consent events, 1 signatures and 2 photo links/),
  ).toBeInTheDocument();
  const submit = screen.getByRole("button", { name: "Permanently dispose treatment" });
  expect(submit).toBeDisabled();
  await userEvent.type(screen.getByLabelText("Disposal reason"), "Review complete");
  await userEvent.type(screen.getByLabelText(/Type DISPOSE/), "DISPOSE");
  await userEvent.click(submit);
  expect(mocks.dispose).toHaveBeenCalledWith({
    id: "t1",
    input: { previewToken: "signed", reason: "Review complete", confirmation: "DISPOSE" },
  });
  expect(await screen.findByRole("status")).toHaveTextContent("receipt1");
  expect(screen.queryByRole("button", { name: "Preview disposal" })).not.toBeInTheDocument();
});

it("preserves the reason but requires a fresh preview after a failed disposal", async () => {
  mocks.dispose.mockRejectedValueOnce(new Error("Treatment changed"));
  render(panel());
  await userEvent.click(screen.getByRole("button", { name: "Preview disposal" }));
  await userEvent.type(screen.getByLabelText("Disposal reason"), "Review complete");
  await userEvent.type(screen.getByLabelText(/Type DISPOSE/), "DISPOSE");
  await userEvent.click(screen.getByRole("button", { name: "Permanently dispose treatment" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Treatment changed");
  expect(screen.getByLabelText("Disposal reason")).toHaveValue("Review complete");
  expect(
    screen.queryByRole("button", { name: "Permanently dispose treatment" }),
  ).not.toBeInTheDocument();
});

it("cancels the preview and renews confirmation after a reason change", async () => {
  render(panel());
  await userEvent.click(screen.getByRole("button", { name: "Preview disposal" }));
  await userEvent.type(screen.getByLabelText(/Type DISPOSE/), "DISPOSE");
  await userEvent.type(screen.getByLabelText("Disposal reason"), "Reviewed");
  expect(screen.getByLabelText(/Type DISPOSE/)).toHaveValue("");
  await userEvent.click(screen.getByRole("button", { name: "Cancel disposal" }));
  expect(mocks.dispose).not.toHaveBeenCalled();
  expect(screen.queryByLabelText(/Type DISPOSE/)).not.toBeInTheDocument();
});

it("handles failed previews, customer mismatch and expiration", async () => {
  mocks.preview.mockRejectedValueOnce(new Error("Preview failed"));
  render(panel());
  await userEvent.click(screen.getByRole("button", { name: "Preview disposal" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Preview failed");
  mocks.preview.mockResolvedValueOnce({ ...preview, customerId: "other" });
  await userEvent.click(screen.getByRole("button", { name: "Preview disposal" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("does not match");
  mocks.preview.mockResolvedValueOnce({ ...preview, expiresAt: "2000-01-01T00:00:00.000Z" });
  await userEvent.click(screen.getByRole("button", { name: "Preview disposal" }));
  await userEvent.type(screen.getByLabelText("Disposal reason"), "Reviewed");
  await userEvent.type(screen.getByLabelText(/Type DISPOSE/), "DISPOSE");
  expect(screen.getByRole("button", { name: "Permanently dispose treatment" })).toBeDisabled();
});

it("blocks held, stale or in-flight controls and removes them on role/read-only loss", async () => {
  const view = render(panel(true));
  expect(screen.getByRole("button", { name: "Preview disposal" })).toBeDisabled();
  view.rerender(panel());
  await userEvent.click(screen.getByRole("button", { name: "Preview disposal" }));
  mocks.busy = true;
  view.rerender(panel());
  expect(screen.getByRole("button", { name: "Preview disposal" })).toBeDisabled();
  mocks.role = "MANAGER";
  view.rerender(panel());
  expect(screen.queryByRole("button", { name: "Preview disposal" })).not.toBeInTheDocument();
  mocks.role = "SUPER_ADMIN";
  mocks.readOnly = true;
  view.rerender(panel());
  expect(screen.queryByRole("button", { name: "Preview disposal" })).not.toBeInTheDocument();
});
