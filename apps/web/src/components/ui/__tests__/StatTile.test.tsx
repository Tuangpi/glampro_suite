/**
 * `StatTile` — a count the server made, in a box with an icon.
 *
 * The interesting case is the one the tile could not say before: a number that has not
 * arrived is not the same fact as a number that is zero, and the tile renders "—" for
 * the second. `loading` is how the screen says which of the two it is looking at.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import StatTile from "../StatTile";

describe("StatTile", () => {
  it("shows the count and the label that names it", () => {
    render(<StatTile icon={<span />} value={12} label="Team members" />);

    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("Team members")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows a pre-formatted display string in place of the number", () => {
    // Money crosses the wire as a decimal string so no cent is lost to a float.
    render(<StatTile icon={<span />} value={undefined} display="1234.50" label="Income" />);

    expect(screen.getByText("1234.50")).toBeInTheDocument();
  });

  it("renders an em dash when there is no number, which is not zero", () => {
    render(<StatTile icon={<span />} value={undefined} label="Disabled" />);

    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("reserves the number's place while it loads, and says it is busy", () => {
    const { container } = render(
      <StatTile icon={<span />} value={undefined} label="Team members" loading />,
    );

    // The label stays readable — the reader still knows what is being counted — and the
    // em dash is absent, so "not yet" cannot be read as "none".
    expect(screen.getByText("Team members")).toBeInTheDocument();
    expect(screen.queryByText("—")).not.toBeInTheDocument();
    expect(container.firstElementChild).toHaveAttribute("aria-busy", "true");
    // The icon chip and the placeholder bar: two decorative boxes instead of one.
    expect(container.querySelectorAll("[aria-hidden='true']")).toHaveLength(2);
  });
});
