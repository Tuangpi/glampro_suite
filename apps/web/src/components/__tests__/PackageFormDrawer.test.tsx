import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PackageDetail } from "@glampro_suite/shared";

const { create, update } = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn() }));
vi.mock("@/hooks/usePackages", () => ({
  useCreatePackage: () => ({ mutateAsync: create, isPending: false }),
  useUpdatePackage: () => ({ mutateAsync: update, isPending: false }),
}));
vi.mock("@/hooks/useServices", () => ({
  useServiceList: () => ({ data: { data: [], pageCount: 0 }, isPending: false, isError: false }),
}));
vi.mock("@/components/ui/toast-store", () => ({ showToast: vi.fn() }));

import PackageFormDrawer from "../catalogue/PackageFormDrawer";

const bundle: PackageDetail = {
  id: "package-1",
  name: "Facial",
  status: "ACTIVE",
  sessionCount: 5,
  memberPrice: "100.00",
  nonmemberPrice: "120.00",
  description: null,
  validityDays: 30,
  serviceCount: 0,
  services: [],
  createdAt: "2026-10-22T00:00:00Z",
  updatedAt: "2026-10-22T00:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  create.mockResolvedValue(bundle);
  update.mockResolvedValue(bundle);
});

describe("package validity editor", () => {
  it("loads a rule and explicitly clears it without changing existing holdings", async () => {
    const user = userEvent.setup();
    render(<PackageFormDrawer open bundle={bundle} onClose={vi.fn()} />);
    const input = screen.getByLabelText("Validity (days)");
    expect(input).toHaveValue(30);
    expect(screen.getByText(/Existing holdings are unchanged/)).toBeInTheDocument();
    await user.clear(input);
    await user.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({
        id: bundle.id,
        input: expect.objectContaining({ validityDays: null }),
      }),
    );
  });

  it("saves whole-day validity", async () => {
    const user = userEvent.setup();
    render(<PackageFormDrawer open bundle={bundle} onClose={vi.fn()} />);
    await user.clear(screen.getByLabelText("Validity (days)"));
    await user.type(screen.getByLabelText("Validity (days)"), "90");
    await user.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({
        id: bundle.id,
        input: expect.objectContaining({ validityDays: 90 }),
      }),
    );
  });
});
