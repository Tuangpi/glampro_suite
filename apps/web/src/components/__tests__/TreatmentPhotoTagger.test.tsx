import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import TreatmentPhotoTagger from "../treatments/TreatmentPhotoTagger";

const mocks = vi.hoisted(() => ({
  photos: vi.fn(),
  add: vi.fn(),
  remove: vi.fn(),
  blob: vi.fn(),
  readOnly: false,
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ isReadOnly: mocks.readOnly }) }));
vi.mock("@/hooks/useTreatments", () => ({
  useCustomerPhotos: mocks.photos,
  useAddTreatmentPhoto: () => ({ mutateAsync: mocks.add }),
  useRemoveTreatmentPhoto: () => ({ mutateAsync: mocks.remove }),
}));
vi.mock("@/lib/api", () => ({
  default: { get: mocks.blob },
  getErrorMessage: (error: Error) => error.message,
}));
const tagged = {
  id: "tag1",
  tenantId: "tenant",
  treatmentRecordId: "t1",
  customerPhotoId: "old-page",
  photoType: "BEFORE" as const,
  caption: "Original",
  createdAt: "2026-10-22",
};
const onChange = vi.fn();
const props = { customerId: "c1", treatmentRecordId: "t1", existingPhotos: [tagged], onChange };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.readOnly = false;
  mocks.photos.mockReturnValue({ data: { data: [{ id: "p2", caption: "New" }], pageCount: 2 } });
  mocks.add.mockResolvedValue({});
  mocks.remove.mockResolvedValue(undefined);
  mocks.blob.mockImplementation(() => new Promise(() => {}));
});
it("shows tagged photos outside the current gallery page and reserves their type", async () => {
  render(<TreatmentPhotoTagger {...props} />);
  expect(screen.getByText("Before")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Tag before" })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Tag after" }));
  expect(mocks.add).toHaveBeenCalledWith({
    treatmentRecordId: "t1",
    customerPhotoId: "p2",
    photoType: "AFTER",
  });
  await waitFor(() => expect(onChange).toHaveBeenCalled());
  expect(mocks.blob).toHaveBeenCalledWith("/customers/c1/photos/old-page", {
    responseType: "blob",
  });
});
it("keeps failed untagging retryable and removes only the link", async () => {
  mocks.remove.mockRejectedValueOnce(new Error("Try again"));
  render(<TreatmentPhotoTagger {...props} />);
  await userEvent.click(screen.getByRole("button", { name: "Untag" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Try again");
  expect(onChange).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Untag" }));
  expect(mocks.remove).toHaveBeenLastCalledWith({ recordId: "t1", photoId: "tag1" });
  await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
});
it("disables all mutations for read-only salons but allows gallery pagination", async () => {
  mocks.readOnly = true;
  render(<TreatmentPhotoTagger {...props} />);
  for (const name of ["Untag", "Tag before", "Tag after"])
    expect(screen.getByRole("button", { name })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(mocks.photos).toHaveBeenLastCalledWith("c1", 2);
});
it("shows empty and retryable gallery states without hiding existing tags", async () => {
  const refetch = vi.fn();
  mocks.photos.mockReturnValue({ isError: true, refetch });
  const { rerender } = render(<TreatmentPhotoTagger {...props} />);
  expect(screen.getByText("Before")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(refetch).toHaveBeenCalled();
  mocks.photos.mockReturnValue({ data: { data: [], pageCount: 0 } });
  rerender(<TreatmentPhotoTagger {...props} />);
  expect(screen.getByText(/No customer photos on this page/)).toBeInTheDocument();
});
it("releases private blob URLs on unmount", async () => {
  const create = vi.fn(() => "blob:private-photo");
  const revoke = vi.fn();
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
  mocks.blob.mockResolvedValue({ data: new Blob(["image"]) });
  const { unmount } = render(<TreatmentPhotoTagger {...props} existingPhotos={[]} />);
  expect(await screen.findByRole("img")).toHaveAttribute("src", "blob:private-photo");
  unmount();
  expect(revoke).toHaveBeenCalledWith("blob:private-photo");
  vi.unstubAllGlobals();
});
