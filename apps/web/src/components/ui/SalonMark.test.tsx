import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import SalonMark from "./SalonMark";

describe("SalonMark", () => {
  it("draws the initials when the salon has no logo", () => {
    render(<SalonMark name="Glow Room" logoUrl={null} />);
    expect(screen.getByText("GR")).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("draws something even when the salon name is blank", () => {
    // A nameless session is a bug, but a receipt is a document: it still needs a
    // mark rather than an empty box.
    render(<SalonMark name="   " logoUrl={null} />);
    expect(screen.getByText("?")).toBeInTheDocument();
  });

  it("draws the uploaded logo when there is one", () => {
    const { container } = render(
      <SalonMark name="Glow Room" logoUrl="/messaging/public/salon/logo" />,
    );
    const image = container.querySelector("img");
    expect(image).toHaveAttribute("src", "/messaging/public/salon/logo");
    // `alt=""` makes it presentational: the name is set in text beside it, so a
    // description would read the salon twice.
    expect(image).toHaveAttribute("alt", "");
  });

  it("falls back to the initials when the image fails to load", () => {
    const { container } = render(<SalonMark name="Glow Room" logoUrl="/missing.png" />);
    fireEvent.error(container.querySelector("img") as HTMLImageElement);
    expect(screen.getByText("GR")).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });

  it("retries the image when the logo is replaced", () => {
    const { container, rerender } = render(<SalonMark name="Glow Room" logoUrl="/broken.png" />);
    fireEvent.error(container.querySelector("img") as HTMLImageElement);
    expect(screen.getByText("GR")).toBeInTheDocument();

    // The failure is remembered per URL, so a new upload is attempted rather
    // than hidden behind a monogram the manager did not ask for.
    rerender(<SalonMark name="Glow Room" logoUrl="/new.png" />);
    expect(container.querySelector("img")).toHaveAttribute("src", "/new.png");
  });
});
