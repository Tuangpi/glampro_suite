import { Settings } from "@/components/icons";

export interface PageLoadingProps {
  /**
   * What is being loaded, in the caller's words — "Loading salon preferences…".
   *
   * The default is the plain sentence the route chunks use. A caller that knows more
   * than "something" should say so: this is the only text a screen reader gets while
   * the page is blank, and "Loading…" is a poor answer for a boot that is waiting on a
   * tenant's settings rather than on a chunk of code.
   */
  label?: string;
}

/** Shown while a lazily-loaded route chunk is being fetched. */
export default function PageLoading({ label = "Loading…" }: PageLoadingProps) {
  return (
    <div className="flex h-full min-h-[var(--app-loading-min-h)] items-center justify-center">
      <div
        className="flex flex-col items-center gap-3 text-ink-muted"
        role="status"
        aria-live="polite"
      >
        <Settings className="animate-spin text-2xl text-purple" aria-hidden />
        <span className="text-sm">{label}</span>
      </div>
    </div>
  );
}
