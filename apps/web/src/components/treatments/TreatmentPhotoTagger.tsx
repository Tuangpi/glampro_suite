/**
 * Before/after photo tagging for a treatment record.
 *
 * TreatmentPhoto links to an existing CustomerPhoto — the bytes live on the
 * customer's photo row, and this row categorises it as BEFORE or AFTER for the
 * treatment. The customer's photos are listed, already-tagged photos are shown
 * as locked (they can be untagged), and untagged photos can be tagged here.
 *
 * Photos are fetched as blobs from `GET /api/customers/:id/photos/:photoId`,
 * the same private-photo route the customer profile uses.
 */
import { useEffect, useState } from "react";

import type { TreatmentPhoto } from "@glampro_suite/shared";

import Button from "@/components/ui/Button";
import {
  useAddTreatmentPhoto,
  useCustomerPhotos,
  useRemoveTreatmentPhoto,
} from "@/hooks/useTreatments";
import api from "@/lib/api";

interface TreatmentPhotoTaggerProps {
  customerId: string;
  treatmentRecordId: string;
  existingPhotos: TreatmentPhoto[];
  onChange: () => void;
}

export default function TreatmentPhotoTagger({
  customerId,
  treatmentRecordId,
  existingPhotos,
  onChange,
}: TreatmentPhotoTaggerProps) {
  const [page, setPage] = useState(1);
  const [tagging, setTagging] = useState<string | null>(null);
  const photos = useCustomerPhotos(customerId, page);
  const addPhoto = useAddTreatmentPhoto();
  const removePhoto = useRemoveTreatmentPhoto();

  const taggedIds = new Set(existingPhotos.map((photo) => photo.customerPhotoId));
  const rows = photos.data?.data ?? [];

  const alreadyTagged = existingPhotos.filter((photo) =>
    rows.some((row) => row.id === photo.customerPhotoId),
  );
  const untagged = rows.filter((photo) => !taggedIds.has(photo.id));

  function tagAs(photoId: string, photoType: "BEFORE" | "AFTER") {
    setTagging(photoId);
    void addPhoto
      .mutateAsync({
        treatmentRecordId,
        customerPhotoId: photoId,
        photoType,
      })
      .then(() => {
        onChange();
        setTagging(null);
      })
      .catch(() => {
        setTagging(null);
      });
  }

  async function untag(photoId: string) {
    setTagging(photoId);
    await removePhoto.mutateAsync({ recordId: treatmentRecordId, photoId });
    onChange();
    setTagging(null);
  }

  if (photos.isPending) {
    return <p role="status">Loading photos…</p>;
  }
  if (photos.isError) {
    return (
      <div role="alert">
        <p>Photos could not be loaded.</p>
        <Button type="button" onClick={() => void photos.refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <section
      className="flex flex-col gap-4 rounded-card border border-line p-4"
      aria-label="Before/after photos"
    >
      <h3 className="font-bold">Before & after photos</h3>
      <p className="text-sm text-ink-muted">
        Tag the customer's existing photos as before or after for this treatment. A photo can be
        tagged on one record at a time.
      </p>

      {alreadyTagged.length > 0 ? (
        <>
          <h4 className="font-semibold text-sm">Tagged photos</h4>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {alreadyTagged.map((tp) => {
              const photo = rows.find((p) => p.id === tp.customerPhotoId);
              if (!photo) return null;
              return (
                <figure
                  key={tp.id}
                  className="flex flex-col gap-2 rounded-md border border-line-soft p-3 relative"
                >
                  <PhotoThumbnail customerId={customerId} photo={photo} />
                  <figcaption className="text-sm font-medium">
                    {tp.photoType === "BEFORE" ? "Before" : "After"}
                  </figcaption>
                  <p className="text-xs text-ink-muted">{photo.caption || "Customer photo"}</p>
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={removePhoto.isPending}
                    onClick={() => void untag(tp.id)}
                  >
                    Untag
                  </Button>
                </figure>
              );
            })}
          </div>
        </>
      ) : null}

      {untagged.length > 0 ? (
        <>
          <h4 className="font-semibold text-sm">Untagged photos</h4>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {untagged.map((photo) => (
              <figure
                key={photo.id}
                className="flex flex-col gap-2 rounded-md border border-line-soft p-3"
              >
                <PhotoThumbnail customerId={customerId} photo={photo} />
                <p className="text-xs text-ink-muted">{photo.caption || "Customer photo"}</p>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={addPhoto.isPending || tagging === photo.id}
                    onClick={() => void tagAs(photo.id, "BEFORE")}
                  >
                    Tag before
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={addPhoto.isPending || tagging === photo.id}
                    onClick={() => void tagAs(photo.id, "AFTER")}
                  >
                    Tag after
                  </Button>
                </div>
              </figure>
            ))}
          </div>
        </>
      ) : null}

      {rows.length > 0 && !alreadyTagged.length && !untagged.length ? (
        <p className="text-sm text-ink-muted">No photos to tag.</p>
      ) : null}

      {(photos.data?.pageCount ?? 0) > 1 && (
        <div className="flex items-center justify-between gap-3 border-t border-line-soft pt-3">
          <p className="text-xs text-ink-muted">
            Page {page} of {photos.data?.pageCount}
          </p>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={page === 1 || photos.isFetching}
              onClick={() => setPage(page - 1)}
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={page >= (photos.data?.pageCount ?? 1) || photos.isFetching}
              onClick={() => setPage(page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
// Fetch the blob URL for a photo on demand, revoking when the component unmounts.
function PhotoThumbnail({
  customerId,
  photo,
}: {
  customerId: string;
  photo: { id: string; caption: string | null };
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let objectUrl: string | undefined;
    void api
      .get<Blob>(`/customers/${customerId}/photos/${photo.id}`, {
        responseType: "blob",
      })
      .then((res) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(res.data);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [customerId, photo.id]);

  if (failed) return <p role="alert">Photo could not be loaded.</p>;
  if (!url) return <p role="status">Loading photo…</p>;
  return (
    <img
      src={url}
      alt={photo.caption || "Customer photo"}
      className="h-40 w-full rounded-md object-cover border border-line"
    />
  );
}
