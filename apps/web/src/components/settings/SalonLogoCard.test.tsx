import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The card owns no query of its own: it reads the salon profile the Settings
 * screen already fetched and writes through two mutations. Both are stubbed here
 * so an assertion about "no upload happened" is about the card's own checks, not
 * about a transport.
 */
const mocks = vi.hoisted(() => ({
  profile: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  showToast: vi.fn(),
  readOnly: false,
}));

vi.mock("@/hooks/useSettings", () => ({
  useSalonProfile: mocks.profile,
  useUploadSalonLogo: () => ({ mutateAsync: mocks.upload, isPending: false }),
  useDeleteSalonLogo: () => ({ mutateAsync: mocks.remove, isPending: false }),
}));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ tenant: { id: "tenant-1" } }) }));
vi.mock("@/components/ui/toast-store", () => ({ showToast: mocks.showToast }));
vi.mock("@/lib/api", () => ({ getErrorMessage: () => "Logo could not be saved." }));

import SalonLogoCard from "./SalonLogoCard";

/** The profile as `GET /settings/profile` returns it, minus the fields this card ignores. */
function profileWith(logoUrl: string | null) {
  return {
    data: { id: "tenant-1", name: "Glow Room", logoUrl },
    isPending: false,
    isError: false,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.upload.mockResolvedValue({});
  mocks.remove.mockResolvedValue({});
  mocks.profile.mockReturnValue(profileWith(null));
});

describe("SalonLogoCard", () => {
  it("previews the initials the receipt would print and uploads the chosen image", async () => {
    const user = userEvent.setup();
    render(<SalonLogoCard canEdit />);

    // No logo yet: the preview is the monogram, and it says so rather than
    // looking like a broken image.
    expect(screen.getByText("GR")).toBeInTheDocument();
    expect(screen.getByText(/receipts print the salon's initials/)).toBeInTheDocument();
    const submit = screen.getByRole("button", { name: "Upload logo" });
    expect(submit).toBeDisabled();

    await user.upload(
      screen.getByLabelText("Logo image"),
      new File(["png"], "logo.png", { type: "image/png" }),
    );
    expect(submit).toBeEnabled();
    await user.click(submit);

    expect(mocks.upload).toHaveBeenCalledWith(expect.any(File));
    expect(mocks.showToast).toHaveBeenCalledWith("success", "Salon logo saved.");
  });

  it("refuses the wrong kind of file before it leaves the browser", async () => {
    // `accept` is a filter the browser applies to the picker, not a guarantee —
    // a drag-and-drop or a renamed file still arrives, so the card checks.
    const user = userEvent.setup({ applyAccept: false });
    render(<SalonLogoCard canEdit />);

    await user.upload(
      screen.getByLabelText("Logo image"),
      new File(["gif"], "logo.gif", { type: "image/gif" }),
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Choose a PNG or JPEG image.");
    await user.click(screen.getByRole("button", { name: "Upload logo" }));
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("refuses an image larger than the API accepts", async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(<SalonLogoCard canEdit />);

    await user.upload(
      screen.getByLabelText("Logo image"),
      new File([new Uint8Array(513 * 1024)], "huge.png", { type: "image/png" }),
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Choose an image up to 512 KB.");
    await user.click(screen.getByRole("button", { name: "Upload logo" }));
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("offers to replace or remove a logo once one exists", async () => {
    mocks.profile.mockReturnValue(profileWith("/messaging/public/salon/logo"));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    const { container } = render(<SalonLogoCard canEdit />);

    expect(container.querySelector("img")).toHaveAttribute("src", "/messaging/public/salon/logo");
    expect(screen.getByText("A custom logo is in use.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Replace logo" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Remove logo" }));
    expect(confirm).toHaveBeenCalled();
    expect(mocks.remove).toHaveBeenCalled();
    confirm.mockRestore();
  });

  it("keeps the removal deliberate rather than one stray click", async () => {
    mocks.profile.mockReturnValue(profileWith("/messaging/public/salon/logo"));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();
    render(<SalonLogoCard canEdit />);

    await user.click(screen.getByRole("button", { name: "Remove logo" }));
    expect(mocks.remove).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it("reports a failed upload without claiming the logo changed", async () => {
    mocks.upload.mockRejectedValue(new Error("too large"));
    const user = userEvent.setup();
    render(<SalonLogoCard canEdit />);

    await user.upload(
      screen.getByLabelText("Logo image"),
      new File(["png"], "logo.png", { type: "image/png" }),
    );
    await user.click(screen.getByRole("button", { name: "Upload logo" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Logo could not be saved.");
    expect(mocks.showToast).not.toHaveBeenCalled();
  });

  it("blocks every control for a salon that may not be edited", () => {
    mocks.profile.mockReturnValue(profileWith("/messaging/public/salon/logo"));
    render(<SalonLogoCard canEdit={false} />);
    expect(screen.getByLabelText("Logo image")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Replace logo" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Remove logo" })).toBeDisabled();
  });

  it("says the logo cannot be changed when the profile did not load", () => {
    mocks.profile.mockReturnValue({ isPending: false, isError: true });
    render(<SalonLogoCard canEdit />);
    expect(screen.getByRole("alert")).toHaveTextContent("The salon profile could not be loaded");
    expect(screen.queryByLabelText("Logo image")).toBeNull();
  });
});
