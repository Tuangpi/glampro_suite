/**
 * Outlets (branches) are parked for now.
 *
 * The feature is intact everywhere it matters: the schema, migrations, the
 * `x-outlet-id` guard (`apps/api/src/middleware/outlet.ts`), the branch hours
 * service and `docs/multi-outlet.md`. What this switch removes is the browser
 * surface — the Settings → Outlets category and the top-bar picker — because a
 * salon with no branches never used them: the picker already rendered nothing
 * when the outlet list was empty and every request fell back to tenant-wide
 * operation.
 *
 * Hiding is convenience only. The API validates the selection on every request
 * whether or not a screen offers it, which is why no endpoint was removed.
 *
 * To restore: set this to `true` and reverse the two wording clean-ups that came
 * with the hide — the appointment list's `outlet` column and the form drawer's
 * outlet sentence (both noted at their call sites). Everything else returns on
 * its own.
 */
export const OUTLETS_UI_ENABLED = false;
