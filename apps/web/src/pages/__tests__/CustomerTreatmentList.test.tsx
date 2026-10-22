import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import CustomerTreatmentList from "../CustomerTreatmentList";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  detail: vi.fn(),
  remove: vi.fn(),
  readOnly: false,
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ isReadOnly: mocks.readOnly }) }));
vi.mock("@/hooks/useCustomers", () => ({ useCustomer: () => ({ data: { name: "Mina" } }) }));
vi.mock("@/hooks/useTreatments", () => ({
  useTreatmentList: mocks.list,
  useTreatment: mocks.detail,
  useDeleteTreatment: () => ({ mutateAsync: mocks.remove, isPending: false }),
}));
vi.mock("@/components/treatments/TreatmentPhotoTagger", () => ({
  default: ({
    customerId,
    treatmentRecordId,
  }: {
    customerId: string;
    treatmentRecordId: string;
  }) => (
    <p>
      Photo tagger {customerId} {treatmentRecordId}
    </p>
  ),
}));
vi.mock("@/components/treatments/TreatmentRecordForm", () => ({
  default: ({
    record,
    recordId,
    onClose,
    onSaved,
  }: {
    record: { customerId: string };
    recordId: string | null;
    onClose: () => void;
    onSaved: () => void;
  }) => (
    <div role="dialog" aria-label="Treatment editor">
      {record.customerId} {recordId ?? "new"}
      <button
        onClick={() => {
          onSaved();
          onClose();
        }}
      >
        Save editor
      </button>
      <button onClick={onClose}>Close editor</button>
    </div>
  ),
}));
const record = {
  id: "t1",
  customerId: "c1",
  treatmentType: "Facial",
  status: "COMPLETED",
  quantityConsumed: 2,
  packageRedemptionId: "r1",
  createdAt: "2026-10-22T01:00:00Z",
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.readOnly = false;
  mocks.detail.mockReturnValue({ data: { ...record, photos: [] } });
  mocks.remove.mockResolvedValue(undefined);
  mocks.list.mockReturnValue({ data: { data: [record], pageCount: 2 }, isPending: false });
});
it("opens photos for the selected treatment even when writes are disabled", async () => {
  mocks.readOnly = true;
  render(<CustomerTreatmentList customerId="c1" />);
  await userEvent.click(screen.getByRole("button", { name: "Before/after photos" }));
  expect(screen.getByRole("dialog", { name: "Treatment before/after photos" })).toHaveTextContent(
    "Photo tagger c1 t1",
  );
  expect(mocks.detail).toHaveBeenLastCalledWith("t1");
});
it("opens scoped create and edit forms and keeps new available on nonempty lists", async () => {
  const user = userEvent.setup();
  render(<CustomerTreatmentList customerId="c1" />);
  await user.click(screen.getByRole("button", { name: "New treatment" }));
  expect(screen.getByRole("dialog", { name: "Treatment editor" })).toHaveTextContent("c1 new");
  await user.click(screen.getByText("Close editor"));
  await user.click(screen.getByRole("button", { name: "Edit" }));
  expect(screen.getByRole("dialog", { name: "Treatment editor" })).toHaveTextContent("c1 t1");
  await user.click(screen.getByText("Save editor"));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
it("requires confirmation and deletes only the selected record", async () => {
  const user = userEvent.setup();
  render(<CustomerTreatmentList customerId="c1" />);
  await user.click(screen.getByRole("button", { name: "Delete" }));
  expect(mocks.remove).not.toHaveBeenCalled();
  expect(screen.getByText(/Package balances will not change/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Confirm delete" }));
  await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith("t1"));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
it("keeps a failed deletion visible for retry", async () => {
  mocks.remove.mockRejectedValue(new Error("Deletion refused"));
  const user = userEvent.setup();
  render(<CustomerTreatmentList customerId="c1" />);
  await user.click(screen.getByRole("button", { name: "Delete" }));
  await user.click(screen.getByRole("button", { name: "Confirm delete" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Deletion refused");
});
it("requests server pages and disables writes for read-only salons", async () => {
  mocks.readOnly = true;
  const user = userEvent.setup();
  render(<CustomerTreatmentList customerId="c1" />);
  for (const name of ["New treatment", "Edit", "Delete"])
    expect(screen.getByRole("button", { name })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: /next/i }));
  expect(mocks.list).toHaveBeenLastCalledWith({ customerId: "c1", page: 2, pageSize: 20 });
});
it("distinguishes reversed POS evidence from historical quantities", () => {
  mocks.list.mockReturnValue({
    data: {
      data: [
        { ...record, packageRedemptionRevertedAt: "2026-10-22" },
        { ...record, id: "t2", packageRedemptionId: null },
      ],
      pageCount: 1,
    },
  });
  render(<CustomerTreatmentList customerId="c1" />);
  expect(screen.getByText("2 — POS reversed")).toBeInTheDocument();
  expect(screen.getByText("2 — historical, unverified")).toBeInTheDocument();
});
