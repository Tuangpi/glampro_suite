/**
 * A surface panel: the handoff's `--sp-radius-xl` card that screens use for
 * sections, the cart panel and receipt boxes.
 *
 * Every slot is optional, so a card can be a bare container or a titled
 * section with actions and a footer. The title renders as an `h3` because
 * cards sit below the page heading in the handoff frames; a card nested inside
 * another card should pass its own title markup through `title`.
 *
 * Geometry follows the handoff's `.card` / `.card-head` / `.card-body` and is
 * reconciled against the token scale by [ADR 0006]: the head is `16px 20px`
 * over a `--sp-border-soft` divider, the title is the handoff's 800 weight,
 * and the body is `6px 12px 12px`. The handoff's `.card-link` (12px/700 purple,
 * the "View all" in a head) has no prop of its own — render it into `actions`
 * as `text-sm font-bold text-purple`, all three of which are existing tokens.
 */
import { cn } from "@/lib/utils";

export interface CardProps {
  title?: React.ReactNode;
  description?: React.ReactNode;
  /** Buttons or a link — keep to one primary action. */
  actions?: React.ReactNode;
  /** Divider-separated footer, for totals or a row of links. */
  footer?: React.ReactNode;
  children?: React.ReactNode;
  /**
   * Accessible name for the section, so the card becomes a landmark a screen
   * reader can jump to. Pass the same words as `title` — a `section` is only
   * exposed as a `region` once it has a name, and an unnamed one is just a
   * container. Pages that group several cards use this the way `Settings` and
   * `StaffProfile` use their own `aria-labelledby` section wrappers.
   */
  label?: string;
  /** Drop the body padding for edge-to-edge content such as a table. */
  flush?: boolean;
  className?: string;
}

export default function Card({
  title,
  description,
  actions,
  footer,
  children,
  label,
  flush = false,
  className,
}: CardProps) {
  const hasHeader = Boolean(title || description || actions);

  return (
    <section
      aria-label={label}
      className={cn(
        "flex flex-col overflow-hidden rounded-card border border-line bg-surface",
        className,
      )}
    >
      {hasHeader ? (
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-line-soft px-5 py-4">
          <div className="min-w-0">
            {title ? <h3 className="truncate text-base font-heavy text-ink">{title}</h3> : null}
            {description ? <p className="mt-0.5 text-sm text-ink-muted">{description}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}

      {children ? <div className={cn(flush ? "" : "px-3 pt-1.5 pb-3")}>{children}</div> : null}

      {footer ? (
        <footer className="border-t border-line-soft bg-surface-muted px-3 py-3 text-sm text-ink-body">
          {footer}
        </footer>
      ) : null}
    </section>
  );
}
