import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResourceSummary } from "@glampro_suite/shared";

const mocks = vi.hoisted(() => ({
  resources: vi.fn(),
  services: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/hooks/useResources", () => ({
  useResourceList: () => mocks.resources(),
  useResourceServices: () => mocks.services(),
  useCreateResource: () => ({ mutateAsync: mocks.create, isPending: false }),
  useUpdateResource: () => ({ mutateAsync: mocks.update, isPending: false }),
}));
vi.mock("@/lib/api", () => ({
  getErrorMessage: () => "A room or equipment called Room 1 already exists.",
  getValidationDetails: () => ({ "body.name": "This name is already in use." }),
}));

import ResourcesCard from "./ResourcesCard";

function resource(overrides: Partial<ResourceSummary> = {}): ResourceSummary {
  return {
    id: "room-1",
    name: "Room 1",
    kind: "ROOM",
    status: "ACTIVE",
    serviceIds: ["colour"],
    createdAt: "2026-11-01T09:00:00.000Z",
    updatedAt: "2026-11-01T09:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resources.mockReturnValue({
    data: [
      resource(),
      resource({ id: "steamer", name: "Steamer", kind: "EQUIPMENT", serviceIds: [] }),
    ],
    isPending: false,
    isError: false,
  });
  mocks.services.mockReturnValue({
    data: {
      data: [
        { id: "colour", name: "Colour" },
        { id: "cut", name: "Cut" },
      ],
      total: 2,
    },
    isPending: false,
  });
  mocks.create.mockResolvedValue(resource());
  mocks.update.mockResolvedValue(resource());
});

describe("rooms and equipment settings card", () => {
  it("lists each resource with the services that may use it", () => {
    render(<ResourcesCard canEdit />);

    expect(screen.getByText("Room 1")).toBeInTheDocument();
    expect(screen.getByText("Equipment")).toBeInTheDocument();
    expect(screen.getByText("Colour")).toBeInTheDocument();
    expect(screen.getByText("No service yet")).toBeInTheDocument();
  });

  it("creates a room with the ticked services", async () => {
    render(<ResourcesCard canEdit />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Add resource" }));
    await user.type(screen.getByLabelText("Name"), "Room 2");
    await user.click(screen.getByLabelText("Cut"));
    await user.click(screen.getByRole("button", { name: "Add room or equipment" }));

    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith({
        name: "Room 2",
        kind: "ROOM",
        status: "ACTIVE",
        serviceIds: ["cut"],
      }),
    );
  });

  it("shows a duplicate name on the name field instead of a silent conflict", async () => {
    mocks.create.mockRejectedValue(new Error("duplicate"));
    render(<ResourcesCard canEdit />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Add resource" }));
    await user.type(screen.getByLabelText("Name"), "Room 1");
    await user.click(screen.getByRole("button", { name: "Add room or equipment" }));

    expect(await screen.findByText("This name is already in use.")).toBeInTheDocument();
    expect(
      screen.getByText("A room or equipment called Room 1 already exists."),
    ).toBeInTheDocument();
  });

  it("lets a read-only member look but not edit", async () => {
    render(<ResourcesCard canEdit={false} />);

    expect(screen.getByRole("button", { name: "Add resource" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Edit Room 1" })).toBeDisabled();
  });

  it("blocks editing when the service catalogue is incomplete", () => {
    mocks.services.mockReturnValue({ isError: true, isPending: false });
    render(<ResourcesCard canEdit />);
    expect(screen.getByRole("alert")).toHaveTextContent("Services could not be loaded");
    expect(screen.getByRole("button", { name: "Add resource" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Edit Room 1" })).toBeDisabled();
  });
});
