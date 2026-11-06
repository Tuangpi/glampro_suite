/**
 * The salon's logo — the image on the printed receipt, the emailed receipt and
 * the public receipt link.
 *
 * Its own card and its own form because the upload is multipart: the profile form
 * is JSON and carries required fields, and a rebrand must not depend on them. The
 * image replaces whatever was there (`tenantId` is the row's key), so this card
 * never accumulates a gallery — "the logo" is one picture.
 *
 * The preview is the real thing, drawn by the same `SalonMark` the receipt uses,
 * so the initials monogram is visible before a manager has uploaded anything and
 * after they remove one.
 */
import { useState } from "react";

import type { SalonProfile } from "@glampro_suite/shared";

import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Field from "@/components/ui/Field";
import SalonMark from "@/components/ui/SalonMark";
import { showToast } from "@/components/ui/toast-store";
import { useAuth } from "@/contexts/AuthContext";
import { useDeleteSalonLogo, useSalonProfile, useUploadSalonLogo } from "@/hooks/useSettings";
import { getErrorMessage } from "@/lib/api";

/** Mirrors `MAX_LOGO_BYTES` in `apps/api/src/services/settings.service.ts`. */
const MAX_LOGO_BYTES = 512 * 1024;
const ACCEPTED_TYPES = ["image/png", "image/jpeg"];

export default function SalonLogoCard({ canEdit }: { canEdit: boolean }) {
  const { tenant } = useAuth();
  const profile = useSalonProfile(tenant?.id);
  const upload = useUploadSalonLogo();
  const remove = useDeleteSalonLogo();

  const [file, setFile] = useState<File | null>(null);
  // Cleared by remounting the input: a file input keeps its own value, and a
  // failed or finished upload that left the filename on screen would claim the
  // chosen image is still pending.
  const [inputKey, setInputKey] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const busy = upload.isPending || remove.isPending;
  const data: SalonProfile | undefined = profile.data;
  const logoUrl = data?.logoUrl ?? null;

  /**
   * The server sniffs the bytes and enforces the same limit; this check is here so
   * the answer arrives without a request, not to be the authority.
   */
  function checkFile(candidate: File): string | null {
    if (!ACCEPTED_TYPES.includes(candidate.type)) return "Choose a PNG or JPEG image.";
    if (candidate.size > MAX_LOGO_BYTES) return "Choose an image up to 512 KB.";
    return null;
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || busy || !canEdit) return;
    const problem = checkFile(file);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    try {
      await upload.mutateAsync(file);
      setFile(null);
      setInputKey((key) => key + 1);
      showToast("success", "Salon logo saved.");
    } catch (cause) {
      setError(getErrorMessage(cause));
    }
  }

  async function clear() {
    if (busy || !canEdit) return;
    if (!window.confirm("Remove the salon logo and go back to the initials?")) return;
    setError(null);
    try {
      await remove.mutateAsync();
      showToast("success", "Salon logo removed.");
    } catch (cause) {
      setError(getErrorMessage(cause));
    }
  }

  return (
    <Card
      title="Salon logo"
      description="Shown on printed receipts, emailed receipts and the receipt link customers open."
    >
      {profile.isError ? (
        <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
          The salon profile could not be loaded, so the logo cannot be changed here.
        </p>
      ) : (
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          {error ? (
            <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-4">
            <SalonMark name={data?.name ?? ""} logoUrl={logoUrl} size="md" />
            <div className="flex min-w-0 flex-col gap-1 text-sm">
              <p className="font-bold text-ink">{data?.name ?? "This salon"}</p>
              <p className="text-ink-muted">
                {logoUrl
                  ? "A custom logo is in use."
                  : "No logo yet, so receipts print the salon's initials."}
              </p>
            </div>
          </div>

          <Field
            label="Logo image"
            hint="PNG or JPEG, up to 512 KB. A square image prints best; fine detail will not read on a thermal slip."
          >
            {({ controlId, describedBy }) => (
              <input
                key={inputKey}
                id={controlId}
                type="file"
                accept="image/png,image/jpeg"
                aria-describedby={describedBy}
                disabled={!canEdit || busy}
                className="rounded-md border border-line bg-surface p-2 text-sm text-ink file:mr-3 file:rounded-md file:border-0 file:bg-surface-muted file:px-3 file:py-2 file:text-sm file:font-medium file:text-ink disabled:cursor-not-allowed"
                onChange={(event) => {
                  const chosen = event.target.files?.[0] ?? null;
                  setFile(chosen);
                  setError(chosen ? checkFile(chosen) : null);
                }}
              />
            )}
          </Field>

          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={!canEdit || busy || file === null}>
              {upload.isPending ? "Uploading…" : logoUrl ? "Replace logo" : "Upload logo"}
            </Button>
            {logoUrl ? (
              <Button type="button" variant="secondary" disabled={!canEdit || busy} onClick={clear}>
                {remove.isPending ? "Removing…" : "Remove logo"}
              </Button>
            ) : null}
          </div>
        </form>
      )}
    </Card>
  );
}
