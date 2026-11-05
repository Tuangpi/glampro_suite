/**
 * The loading shape of a list table.
 *
 * A list that is still loading used to draw a stack of loose grey bars in a padded
 * box, which is a different shape from the table that replaces it: the real rows are
 * taller, have a column of their own each, and arrive under a header that was not
 * there a moment ago. Every list therefore jumped twice — once when the header
 * appeared and once when the rows grew.
 *
 * This draws the **real table**: the same `px-4 py-3` cells, the same dividers, and
 * the caller's own column headers, so the header never changes between the two
 * states and the body reserves the height the rows will take. `columns` is the same
 * array the loaded table renders — `TableColumn` is structurally assignable to
 * `TableSkeletonColumn` — because a skeleton that names its columns differently from
 * the table would be a second, drifting copy of the contract.
 *
 * Accessibility matches `Skeleton`'s own rule: the bars are decorative and the
 * loading state lives on the container (`aria-busy` here, plus the caller's "Loading
 * …" sentence in the panel head). The caption is visually hidden for the same
 * reason `Table`'s is: it names the grid for a screen reader.
 */
import Skeleton from "@/components/ui/Skeleton";
import { cn } from "@/lib/utils";

export interface TableSkeletonColumn {
  /** The real column's `key`, so `widths` can address it. */
  key: string;
  header: React.ReactNode;
  align?: "left" | "right";
}

export interface TableSkeletonProps {
  /** The words `Table` would use — it names the table for a screen reader. */
  caption: string;
  /**
   * The loaded table's `columns`. Only `key`, `header` and `align` are read, so the
   * page passes its own array rather than a hand-written copy of the header words.
   */
  columns: ReadonlyArray<TableSkeletonColumn>;
  /**
   * A width utility per column `key` — `w-40`, `w-24`. Anything unlisted is `w-24`.
   * Varying widths are what stop the placeholder reading as a solid grey slab.
   */
  widths?: Record<string, string>;
  /** Placeholder rows. Five is what the lists drew before; a longer page wants more. */
  rows?: number;
  /**
   * Height of one bar. A row of single-line text is `h-4`; a person cell carrying an
   * avatar reads as `h-8`, which with the cell padding lands on the real row height.
   */
  rowHeight?: string;
  /** The wrapper's own classes — the lists pass `rounded-none border-0`. */
  className?: string;
}

const ALIGN = { left: "text-left", right: "text-right" } as const;

export default function TableSkeleton({
  caption,
  columns,
  widths = {},
  rows = 5,
  rowHeight = "h-4",
  className,
}: TableSkeletonProps) {
  return (
    <div
      aria-busy="true"
      className={cn("overflow-x-auto rounded-card border border-line bg-surface", className)}
    >
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>

        <thead>
          <tr className="border-b border-line">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cn(
                  "px-4 py-3 text-xs font-medium tracking-wide text-ink-muted uppercase",
                  ALIGN[column.align ?? "left"],
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {Array.from({ length: rows }, (_, rowIndex) => (
            <tr key={rowIndex} className="border-b border-line-soft last:border-0">
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={cn("px-4 py-3 text-ink-body", ALIGN[column.align ?? "left"])}
                >
                  {/* The bar is sized on a wrapper, not on `Skeleton` itself: `Skeleton`
                      ships `h-4 w-full`, and `cn` only joins strings, so a `w-24` on it
                      would be resolved by stylesheet order rather than by the caller. */}
                  <div
                    className={cn(
                      rowHeight,
                      widths[column.key] ?? "w-24",
                      column.align === "right" && "ml-auto",
                    )}
                  >
                    <Skeleton className="h-full w-full" />
                  </div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
