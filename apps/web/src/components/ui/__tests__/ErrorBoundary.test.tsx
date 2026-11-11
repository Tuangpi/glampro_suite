import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ErrorBoundary from "../ErrorBoundary";
import { captureUnexpectedError } from "@/lib/monitoring";

vi.mock("@/lib/monitoring", () => ({ captureUnexpectedError: vi.fn() }));

function Boom(): never {
  throw new Error("kaboom");
}

function ToggleBoom({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error("kaboom");
  return <p>Recovered</p>;
}

describe("ErrorBoundary", () => {
  beforeEach(() => {
    vi.mocked(captureUnexpectedError).mockClear();
    // React re-throws boundary errors into the console; keep the test output clean.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders children while nothing throws", () => {
    render(
      <ErrorBoundary>
        <p>All good</p>
      </ErrorBoundary>,
    );

    expect(screen.getByText("All good")).toBeInTheDocument();
    expect(captureUnexpectedError).not.toHaveBeenCalled();
  });

  it("shows a recoverable fallback when a child throws", () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(captureUnexpectedError).toHaveBeenCalledExactlyOnceWith(expect.any(Error));
    expect(screen.getByText("kaboom")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("recovers once the failing child stops throwing", async () => {
    const user = userEvent.setup();

    const { rerender } = render(
      <ErrorBoundary>
        <ToggleBoom shouldThrow />
      </ErrorBoundary>,
    );

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();

    rerender(
      <ErrorBoundary>
        <ToggleBoom shouldThrow={false} />
      </ErrorBoundary>,
    );

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(screen.getByText("Recovered")).toBeInTheDocument();
  });
});
