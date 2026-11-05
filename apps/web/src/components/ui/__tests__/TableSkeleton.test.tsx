/**
 * `TableSkeleton` — the list's loading state.
 *
 * What it has to get right is that it is not a *different* table: the columns the rows
 * will land under are already there, so the header does not appear a moment after the
 * body. It is also decorative — the loading state is announced by the panel's own
 * "Loading …" sentence and carried by `aria-busy`, never by reading out empty boxes.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import TableSkeleton from "../TableSkeleton";

const COLUMNS = [
  { key: "person", header: "Staff" },
  { key: "role", header: "Role" },
  { key: "stock", header: "Stock", align: "right" as const },
];

describe("TableSkeleton", () => {
  it("draws the real column headers rather than a generic shape", () => {
    render(<TableSkeleton caption="Staff in this salon" columns={COLUMNS} />);

    expect(screen.getByRole("table", { name: "Staff in this salon" })).toBeInTheDocument();
    const headers = screen.getAllByRole("columnheader").map((cell) => cell.textContent);
    expect(headers).toEqual(["Staff", "Role", "Stock"]);
  });

  it("reserves the height of the rows that are coming", () => {
    render(<TableSkeleton caption="Staff in this salon" columns={COLUMNS} rows={3} />);

    // Three body rows, plus the header row.
    expect(screen.getAllByRole("row")).toHaveLength(4);
  });

  it("is announced as busy, and its bars are not read out", () => {
    const { container } = render(<TableSkeleton caption="Staff in this salon" columns={COLUMNS} />);

    expect(container.firstElementChild).toHaveAttribute("aria-busy", "true");
    expect(container.querySelectorAll("[aria-hidden='true']").length).toBeGreaterThan(0);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("takes its placeholder widths from the caller, per column key", () => {
    const { container } = render(
      <TableSkeleton
        caption="Staff in this salon"
        columns={COLUMNS}
        rows={1}
        widths={{ person: "w-40" }}
        rowHeight="h-8"
      />,
    );

    const boxes = Array.from(container.querySelectorAll("tbody tr td > div"));
    // `w-40` for the one addressed column, `w-24` for the rest, and the caller's height
    // on all of them.
    expect(boxes.map((box) => box.className.trim().split(/\s+/)[0])).toEqual(["h-8", "h-8", "h-8"]);
    expect(boxes[0]).toHaveClass("w-40");
    expect(boxes[1]).toHaveClass("w-24");
  });

  it("right-aligns a numeric column's placeholder, as the real table does", () => {
    const { container } = render(
      <TableSkeleton caption="Staff in this salon" columns={COLUMNS} rows={1} />,
    );

    const stockCell = container.querySelectorAll("tbody tr td")[2];
    expect(stockCell?.querySelector("div")).toHaveClass("ml-auto");
  });
});
