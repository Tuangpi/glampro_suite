import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
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
      <Routes>
        <Route path="/" element={<AcceptInvitation />} />
        <Route path="/login" element={<h1>Sign in destination</h1>} />
      </Routes>
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
  expect(await screen.findByRole("link", { name: "Continue to sign in" })).toHaveAttribute(
    "href",
    "/login",
  );
  expect(request.mock.calls[0][0]).toBe("/api/owner-invitations/accept");
  expect(JSON.parse(request.mock.calls[0][1].body).token).toBe("a".repeat(43));
  expect(window.location.hash).toBe("");
  expect(localStorage.length).toBe(0);
  expect(screen.getByRole("heading", { name: "Your account is ready" })).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Your password has been set.");
  expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("link", { name: "Continue to sign in" }));
  expect(await screen.findByRole("heading", { name: "Sign in destination" })).toBeInTheDocument();
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
  expect(screen.queryByRole("link", { name: "Continue to sign in" })).not.toBeInTheDocument();
});
it("toggles each password independently without losing values or submitting", () => {
  const request = vi.fn();
  vi.stubGlobal("fetch", request);
  mount();
  const password = screen.getByLabelText("New password");
  const confirm = screen.getByLabelText("Confirm password");
  for (const input of [password, confirm]) {
    expect(input).toHaveAttribute("type", "password");
    fireEvent.change(input, { target: { value: "a-private-owner-passphrase" } });
  }
  fireEvent.click(screen.getByRole("button", { name: "Show new password" }));
  expect(password).toHaveAttribute("type", "text");
  expect(confirm).toHaveAttribute("type", "password");
  fireEvent.click(screen.getByRole("button", { name: "Show confirm password" }));
  expect(confirm).toHaveAttribute("type", "text");
  fireEvent.click(screen.getByRole("button", { name: "Hide new password" }));
  expect(password).toHaveAttribute("type", "password");
  expect(confirm).toHaveAttribute("type", "text");
  fireEvent.click(screen.getByRole("button", { name: "Hide confirm password" }));
  expect(confirm).toHaveAttribute("type", "password");
  expect(password).toHaveValue("a-private-owner-passphrase");
  expect(confirm).toHaveValue("a-private-owner-passphrase");
  expect(request).not.toHaveBeenCalled();
});

it("disables password fields and toggles while accepting the invitation", () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise(() => {})),
  );
  mount();
  for (const label of ["New password", "Confirm password"]) {
    fireEvent.change(screen.getByLabelText(label), {
      target: { value: "a-private-owner-passphrase" },
    });
  }
  fireEvent.click(screen.getByRole("button", { name: "Set password" }));
  expect(screen.getByLabelText("New password")).toBeDisabled();
  expect(screen.getByLabelText("Confirm password")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Show new password" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Show confirm password" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Setting up…" })).toBeDisabled();
});
