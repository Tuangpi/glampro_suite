/**
 * The person cell on every staff row — handoff screen 09.
 *
 * Initials, the name, and the login the person signs in with. The email is the
 * second line rather than a column of its own because it is the one field on this
 * screen that is **not** edited from the staff form: `updateStaffSchema` has no
 * `email`, since a login email is an authentication fact rather than a profile one.
 * Showing it under the name keeps it visible while the form never offers a box for it.
 *
 * `href` makes the name a link to `/staff/:id`, the same shape the customers list uses
 * to reach a profile — a record's own page is worth a plain link, because it works with
 * the middle mouse button and with the back button in a way a row action does not.
 *
 * Decorative chip: the name is always rendered beside it, so a screen reader gains
 * nothing from hearing the initials.
 */
import { getInitials } from "@/lib/utils";

export interface StaffCardProps {
  name: string;
  email: string | null;
  /** Where the name links to — `/staff/:id` on the list. */
  href?: string;
}

export default function StaffCard({ name, email, href }: StaffCardProps) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        aria-hidden
        className="flex size-[34px] shrink-0 items-center justify-center rounded-full bg-purple-soft text-xs font-extrabold text-purple"
      >
        {getInitials(name)}
      </span>
      <div className="min-w-0">
        {href ? (
          <a href={href} className="truncate font-bold text-ink underline">
            {name}
          </a>
        ) : (
          <p className="truncate font-bold text-ink">{name}</p>
        )}
        <p className="truncate text-xs text-ink-muted">{email ?? "POS PIN only"}</p>
      </div>
    </div>
  );
}
