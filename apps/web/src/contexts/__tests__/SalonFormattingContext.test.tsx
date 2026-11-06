import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { auth, get, patch } = vi.hoisted(() => ({
  auth: { status: "authenticated", tenant: { id: "salon-a" } },
  get: vi.fn(),
  patch: vi.fn(),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("@/lib/api", () => ({ get, patch }));

import { queryKeys } from "@/constants/queryKeys";
import { SalonFormattingProvider, useSalonFormatting } from "@/contexts/SalonFormattingContext";
import { useUpdateSalonProfile } from "@/hooks/useSettings";

function profile(id = "salon-a", timeZone = "Asia/Singapore", locale = "en-SG") {
  return {
    id,
    timeZone,
    locale,
    name: "Salon",
    lowStockThreshold: 5,
    gstEnabled: false,
    gstRegistrationNumber: null,
  };
}

function Consumer() {
  const { formatDate, formatPrice, gstEnabled } = useSalonFormatting();
  const update = useUpdateSalonProfile();
  return (
    <>
      <p>{formatDate("2026-03-04T23:30:00Z")}</p>
      <p>{formatPrice("1234.50")}</p>
      <p>GST {gstEnabled ? "on" : "off"}</p>
      <button
        onClick={() =>
          update.mutate({
            name: "Salon",
            lowStockThreshold: 5,
            locale: "fr-FR",
            timeZone: "Europe/Paris",
          })
        }
      >
        Save
      </button>
    </>
  );
}

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = () => (
    <QueryClientProvider client={client}>
      <SalonFormattingProvider>
        <Consumer />
      </SalonFormattingProvider>
    </QueryClientProvider>
  );
  return { client, tree, ...render(tree()) };
}

beforeEach(() => {
  auth.status = "authenticated";
  auth.tenant = { id: "salon-a" };
  get.mockReset().mockResolvedValue(profile());
  patch.mockReset();
});

describe("SalonFormattingProvider", () => {
  it("waits for the saved profile and shares the tenant-keyed query", async () => {
    const { client } = setup();
    expect(screen.getByRole("status")).toHaveTextContent("Loading salon preferences");
    expect(await screen.findByText("05/03/2026")).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith("/settings/profile");
    expect(client.getQueryData(queryKeys.settings.general("salon-a"))).toEqual(profile());
  });

  it("carries the salon's GST switch with the formatters", async () => {
    get.mockResolvedValue({ ...profile(), gstEnabled: true });
    setup();
    expect(await screen.findByText("GST on")).toBeInTheDocument();
  });

  it("updates consumers immediately after a successful settings save", async () => {
    patch.mockResolvedValue(profile("salon-a", "Europe/Paris", "fr-FR"));
    setup();
    await screen.findByText("S$1,234.50");
    await userEvent.setup().click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("1 234,50 S$")).toBeInTheDocument();
  });

  it("does not fetch preferences for public routes", () => {
    auth.status = "anonymous";
    setup();
    expect(get).not.toHaveBeenCalled();
    expect(screen.getByText("S$1,234.50")).toBeInTheDocument();
  });

  it("does not reuse the previous salon's cached formatting during a tenant switch", async () => {
    const { rerender, tree } = setup();
    await screen.findByText("05/03/2026");
    get.mockReturnValue(new Promise(() => {}));
    auth.tenant = { id: "salon-b" };
    rerender(tree());
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByText("05/03/2026")).not.toBeInTheDocument();
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  });

  it("shows a retry instead of silently rendering incorrect fallback preferences", async () => {
    get.mockRejectedValueOnce(new Error("offline"));
    setup();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Salon preferences could not be loaded",
    );
    expect(screen.queryByText("S$1,234.50")).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("05/03/2026")).toBeInTheDocument();
  });

  it("refuses a mismatched cached profile", async () => {
    const { client } = setup();
    await screen.findByText("05/03/2026");
    await act(async () =>
      client.setQueryData(queryKeys.settings.general("salon-a"), profile("salon-b")),
    );
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});
