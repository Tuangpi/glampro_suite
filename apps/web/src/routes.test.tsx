import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import routes from "./routes";

describe("legacy outlet route", () => {
  it("replaces the old URL with the Outlets settings section", async () => {
    const outletRoute = routes
      .find((route) => route.path === "/")
      ?.children?.find((route) => route.path === "outlets");
    expect(outletRoute).toBeDefined();
    const router = createMemoryRouter(
      [
        { path: "/outlets", element: outletRoute!.element },
        { path: "/settings", element: <div>Outlet settings destination</div> },
      ],
      { initialEntries: ["/outlets"] },
    );
    render(<RouterProvider router={router} />);
    expect(await screen.findByText("Outlet settings destination")).toBeVisible();
    expect(router.state.location.pathname).toBe("/settings");
    expect(router.state.location.search).toBe("?section=outlets");
    expect(router.state.historyAction).toBe("REPLACE");
  });
});
