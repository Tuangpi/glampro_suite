import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import routes from "./routes";

describe("legacy outlet route", () => {
  it("replaces the old URL with Settings, now that outlets are parked", async () => {
    const outletRoute = routes
      .find((route) => route.path === "/")
      ?.children?.find((route) => route.path === "outlets");
    expect(outletRoute).toBeDefined();
    const router = createMemoryRouter(
      [
        { path: "/outlets", element: outletRoute!.element },
        { path: "/settings", element: <div>Settings destination</div> },
      ],
      { initialEntries: ["/outlets"] },
    );
    render(<RouterProvider router={router} />);
    expect(await screen.findByText("Settings destination")).toBeVisible();
    expect(router.state.location.pathname).toBe("/settings");
    // The destination used to be `?section=outlets`; that category is parked, so
    // the redirect must not name a section the screen no longer offers.
    expect(router.state.location.search).toBe("");
    expect(router.state.historyAction).toBe("REPLACE");
  });
});
