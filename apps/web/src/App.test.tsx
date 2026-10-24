import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import App from "./App";

const { salonMount } = vi.hoisted(() => ({ salonMount: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => {
    salonMount();
    return children;
  },
}));
vi.mock("@/contexts/SalonFormattingContext", () => ({
  SalonFormattingProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/routes", () => ({
  default: [{ path: "/login", element: <h1>Salon sign in</h1> }],
}));

describe("portal routing", () => {
  it.each(["/platform/login", "/platform", "/platform/unknown"])(
    "opens %s without mounting salon authentication or making salon requests",
    async (path) => {
      salonMount.mockClear();
      const fetcher = vi.spyOn(globalThis, "fetch");
      try {
        render(
          <MemoryRouter initialEntries={[path]}>
            <App />
          </MemoryRouter>,
        );
        // Cold lazy-module transforms can outlast the DOM query timeout under
        // suite load. Await the actual import without mocking the portal tree.
        await act(async () => {
          await vi.dynamicImportSettled();
        });
        expect(
          await screen.findByRole("heading", { name: "Operator sign in" }),
        ).toBeInTheDocument();
        expect(salonMount).not.toHaveBeenCalled();
        expect(fetcher).not.toHaveBeenCalled();
      } finally {
        fetcher.mockRestore();
      }
    },
  );

  it("keeps /login in the salon provider tree", async () => {
    salonMount.mockClear();
    render(
      <MemoryRouter initialEntries={["/login"]}>
        <App />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("heading", { name: "Salon sign in" })).toBeInTheDocument();
    expect(salonMount).toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "Operator sign in" })).not.toBeInTheDocument();
  });
});
