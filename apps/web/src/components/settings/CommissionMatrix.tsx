import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  COMMISSION_KIND_LABELS,
  bulkPublishCommissionRulesSchema,
  type CommissionKind,
  type CommissionMatrix as MatrixView,
} from "@glampro_suite/shared";
import { get, post, getErrorMessage } from "@/lib/api";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";

type Edit = { staffId: string; itemKind: CommissionKind; value: string };
export default function CommissionMatrix({ canEdit }: { canEdit: boolean }) {
  const client = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<{
    revision: string | null;
    edits: Record<string, Edit>;
  } | null>(null);
  const [reason, setReason] = useState("");
  const [effectiveAt, setEffectiveAt] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const matrix = useQuery({
    queryKey: ["commissions", "matrix", page, search],
    queryFn: () => get<MatrixView>("/commissions/matrix", { page, search }),
    staleTime: 0,
  });
  const publish = useMutation({
    mutationFn: (input: unknown) => post("/commissions/bulk", input),
    retry: false,
  });
  const stale = !!draft && !!matrix.data && draft.revision !== matrix.data.revision;
  const busy = matrix.isFetching || publish.isPending;
  const edits = Object.values(draft?.edits ?? {});
  async function reload() {
    const result = await matrix.refetch();
    if (result.isError) {
      setError(getErrorMessage(result.error));
      return;
    }
    setDraft(null);
    setReason("");
    setEffectiveAt("");
    setError("");
    setNotice("");
  }
  async function save() {
    if (!canEdit || busy || stale || matrix.isError || !draft || !edits.length) return;
    setError("");
    setNotice("");
    try {
      const input = bulkPublishCommissionRulesSchema.parse({
        expectedRevision: draft.revision,
        reason,
        ...(effectiveAt ? { effectiveAt: new Date(effectiveAt).toISOString() } : {}),
        rules: edits.map((edit) => {
          if (edit.value.trim() === "")
            throw Error("Enter a percentage or inherit for each edited cell.");
          return {
            staffId: edit.staffId,
            itemKind: edit.itemKind,
            scope: "STAFF",
            targetId: null,
            rate: edit.value.trim().toLowerCase() === "inherit" ? null : Number(edit.value),
          };
        }),
      });
      await publish.mutateAsync(input);
      setDraft(null);
      setReason("");
      setEffectiveAt("");
      setNotice(
        "Commission defaults published atomically. Existing snapshots are unchanged; new earnings remain disabled.",
      );
      await client.invalidateQueries({ queryKey: ["commissions"] });
    } catch (cause) {
      setError(
        cause instanceof Error && cause.name === "ZodError"
          ? "Check rates (0–100, two decimals), change reason and effective time. Publish at most 100 edited cells."
          : getErrorMessage(cause),
      );
    }
  }
  return (
    <Card
      title="Staff commission matrix"
      description="The base rate each person earns per commission type."
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm text-ink-muted">
          Blank means unconfigured, not zero. Enter a percentage (0 earns nothing explicitly) or
          inherit. Item, package and department overrides from Company rules take precedence.
        </p>
        <Input
          label="Search commission staff"
          placeholder="Search by name…"
          value={search}
          disabled={busy || !!draft}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
        />
        {matrix.isPending && <p role="status">Loading commission matrix…</p>}
        {matrix.isError && (
          <p role="alert">Unable to load commission matrix. Reload before publishing.</p>
        )}
        {error && <p role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
        {stale && (
          <p role="alert">
            Commission settings changed. Reload and discard your draft before publishing.
          </p>
        )}
        {matrix.data && (
          <fieldset disabled={!canEdit || busy || matrix.isError || stale}>
            <legend className="sr-only">Staff commission defaults</legend>
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full border-collapse text-sm">
                <caption className="sr-only">Staff rates by commission type</caption>
                <thead>
                  <tr className="border-b border-line bg-surface-muted">
                    <th
                      scope="col"
                      className="px-3 py-2.5 text-left text-xs font-medium tracking-wide text-ink-muted uppercase"
                    >
                      Staff
                    </th>
                    {Object.entries(COMMISSION_KIND_LABELS).map(([kind, label]) => (
                      <th
                        scope="col"
                        key={kind}
                        className="min-w-44 border-l border-line-soft px-3 py-2.5 text-left text-xs font-medium tracking-wide text-ink-muted uppercase"
                      >
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matrix.data.rows.map((row) => (
                    <tr key={row.staffId} className="border-b border-line-soft last:border-0">
                      <th scope="row" className="px-3 py-2 text-left font-medium text-ink">
                        {row.name}
                      </th>
                      {row.cells.map((cell) => {
                        const key = JSON.stringify([row.staffId, cell.itemKind]);
                        return (
                          <td
                            key={cell.itemKind}
                            className="min-w-44 border-l border-line-soft px-3 py-2 align-top"
                          >
                            <Input
                              label={`${row.name}: ${COMMISSION_KIND_LABELS[cell.itemKind]}`}
                              value={
                                draft?.edits[key]?.value ??
                                (cell.configured ? (cell.configuredRate ?? "inherit") : "")
                              }
                              placeholder="Unconfigured"
                              onChange={(event) =>
                                setDraft((current) => ({
                                  revision: current ? current.revision : matrix.data!.revision,
                                  edits: {
                                    ...current?.edits,
                                    [key]: {
                                      staffId: row.staffId,
                                      itemKind: cell.itemKind,
                                      value: event.target.value,
                                    },
                                  },
                                }))
                              }
                            />
                            <p className="mt-1 text-xs text-ink-muted">
                              Default: {cell.rate}% · {cell.source}
                            </p>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!matrix.data.rows.length && <p>No active staff match this search.</p>}
            {canEdit && (
              <div className="mt-3 rounded-lg border border-line bg-surface-muted p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h4 className="text-sm font-bold text-ink">Publish changes</h4>
                  <span className="text-xs text-ink-muted">{edits.length} of 100 cells edited</span>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Input
                    label="Bulk commission change reason"
                    placeholder="e.g. Annual rate review"
                    value={reason}
                    maxLength={500}
                    onChange={(e) => setReason(e.target.value)}
                  />
                  <Input
                    label="Bulk effective from (browser time zone; blank means now)"
                    type="datetime-local"
                    value={effectiveAt}
                    onChange={(e) => setEffectiveAt(e.target.value)}
                  />
                </div>
                <Button
                  className="mt-3"
                  disabled={!edits.length || edits.length > 100 || reason.trim().length < 3}
                  loading={publish.isPending}
                  onClick={() => void save()}
                >
                  Publish staff commission defaults
                </Button>
              </div>
            )}
          </fieldset>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-soft pt-3">
          <span className="text-sm text-ink-muted">
            Page {page} · {matrix.data?.total ?? 0} active staff
          </span>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={busy || !!draft || page === 1}
              onClick={() => setPage(page - 1)}
            >
              Previous commission staff
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={busy || !!draft || !matrix.data || page * 20 >= matrix.data.total}
              onClick={() => setPage(page + 1)}
            >
              Next commission staff
            </Button>
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => void reload()}>
              {draft ? "Reload commission matrix and discard draft" : "Reload commission matrix"}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
