/**
 * The salon's own mark: the uploaded logo when it has one, and its initials when
 * it does not.
 *
 * Two places draw it — the Settings card that manages it and the receipt that
 * carries it — and both have to behave the same way when the image is missing
 * (a deleted file, a proxy that is down, a print preview in a tab that never
 * fetched it), which is why the fallback lives here rather than in either caller.
 *
 * `alt` is deliberately empty: everywhere this is used the salon's name is set in
 * text next to it, so an image description would read the name twice.
 *
 * The monogram reuses the app's `getInitials`, which is what every avatar in the
 * portal draws, so a salon's mark matches its owner's.
 */
import { useState } from "react";

import { cn, getInitials } from "@/lib/utils";

export default function SalonMark({
  name,
  logoUrl,
  size = "sm",
  className,
}: {
  /** The salon's name, for the initials fallback. */
  name: string;
  /** The uploaded logo's path; `null`/absent draws the monogram. */
  logoUrl?: string | null;
  /**
   * `sm` is the receipt's 32px mark, `md` the Settings card's preview. Sizes are
   * spelled out here rather than composed from `className` because `cn` only
   * joins strings — two `size-*` classes would leave the winner to stylesheet
   * order.
   */
  size?: "sm" | "md";
  className?: string;
}) {
  // Tracked by URL rather than a boolean, so replacing the logo clears the
  // failure instead of leaving the monogram in place of a working image.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = Boolean(logoUrl) && failedUrl !== logoUrl;
  const sizeClass = size === "md" ? "size-16 text-lg" : "size-8 text-xs";
  const shared = cn("flex shrink-0 items-center justify-center rounded-md", sizeClass);

  if (showImage && logoUrl) {
    return (
      <img
        src={logoUrl}
        alt=""
        width={size === "md" ? 64 : 32}
        height={size === "md" ? 64 : 32}
        className={cn(shared, "bg-white object-contain", className)}
        onError={() => setFailedUrl(logoUrl)}
      />
    );
  }

  return (
    <span aria-hidden className={cn(shared, "bg-purple/10 font-heavy text-purple", className)}>
      {getInitials(name) || "?"}
    </span>
  );
}
