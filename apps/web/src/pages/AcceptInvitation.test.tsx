import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import AcceptInvitation from "./AcceptInvitation";

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});
function mount() {
  window.history.replaceState(null, "", `/accept-invitation#${"a".repeat(43)}`);
  render(
    <MemoryRouter>
      <AcceptInvitation />
    </MemoryRouter>,
  );
}
it("accepts an invitation through POST body without storing the token or auto-login", async () => {
  const request = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify({ data: { success: true } })));
  vi.stubGlobal("fetch", request);
  mount();
  fireEvent.change(screen.getByLabelText("New password"), {
    target: { value: "a-private-owner-passphrase" },
  });
  fireEvent.change(screen.getByLabelText("Confirm password"), {
    target: { value: "a-private-owner-passphrase" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Set password" }));
  expect(await screen.findByRole("link", { name: "Go to sign in" })).toHaveAttribute(
    "href",
    "/login",
  );
  expect(request.mock.calls[0][0]).toBe("/api/owner-invitations/accept");
  expect(JSON.parse(request.mock.calls[0][1].body).token).toBe("a".repeat(43));
  expect(window.location.hash).toBe("");
  expect(localStorage.length).toBe(0);
});
it("shows password mismatch without sending a request", async () => {
  const request = vi.fn();
  vi.stubGlobal("fetch", request);
  mount();
  fireEvent.change(screen.getByLabelText("New password"), {
    target: { value: "a-private-owner-passphrase" },
  });
  fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "different" } });
  fireEvent.click(screen.getByRole("button", { name: "Set password" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Passwords do not match");
  expect(request).not.toHaveBeenCalled();
});
it("shows an expired invitation response without claiming success", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ message: "Invitation expired" }), { status: 400 }),
      ),
  );
  mount();
  for (const label of ["New password", "Confirm password"])
    fireEvent.change(screen.getByLabelText(label), {
      target: { value: "a-private-owner-passphrase" },
    });
  fireEvent.click(screen.getByRole("button", { name: "Set password" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Invitation expired");
  expect(screen.queryByRole("link", { name: "Go to sign in" })).not.toBeInTheDocument();
});
