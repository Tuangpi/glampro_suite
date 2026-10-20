/**
 * The person cell on every staff row — handoff screen 09.
 *
 * Initials, the name, and the login the person signs in with. The email is the
 * second line rather than a column of its own because it is the one field on this
 * screen that is **not** edited here: `updateStaffSchema` has no `email`, since a
 * login email is an authentication fact rather than a profile one. Showing it under
 * the name keeps it visible while the drawer never offers a box for it.
 *
 * Decorative chip: the name is always rendered beside it, so a screen reader gains
 * nothing from hearing the initials.
 */
import { getInitials } from "@/lib/utils";

export interface StaffCardProps {
  name: string;
  email: string | null;
}

export default function StaffCard({ name, email }: StaffCardProps) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        aria-hidden
        className="flex size-[34px] shrink-0 items-center justify-center rounded-full bg-purple-soft text-xs font-extrabold text-purple"
      >
        {getInitials(name)}
      </span>
      <div className="min-w-0">
        <p className="truncate font-bold text-ink">{name}</p>
        <p className="truncate text-xs text-ink-muted">{email ?? "POS PIN only"}</p>
      </div>
    </div>
  );
}
