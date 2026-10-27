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
    <Card title="Staff commission matrix">
      <div className="flex flex-col gap-3">
        <p>
          Staff defaults only; item, package and department overrides can take precedence. Enter a
          percentage (0 is explicit zero) or inherit. Blank means unconfigured, not zero. New
          commission kinds are configuration only until collection and reporting cutover.
        </p>
        <Input
          label="Search commission staff"
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
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Staff rates by commission type</caption>
                <thead>
                  <tr>
                    <th scope="col">Staff</th>
                    {Object.entries(COMMISSION_KIND_LABELS).map(([kind, label]) => (
                      <th scope="col" key={kind}>
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matrix.data.rows.map((row) => (
                    <tr key={row.staffId}>
                      <th scope="row">{row.name}</th>
                      {row.cells.map((cell) => {
                        const key = JSON.stringify([row.staffId, cell.itemKind]);
                        return (
                          <td key={cell.itemKind} className="p-2 min-w-40">
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
                            <p>
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
              <div className="flex flex-col gap-3 mt-3">
                <Input
                  label="Bulk commission change reason"
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
                <Button
                  disabled={!edits.length || edits.length > 100 || reason.trim().length < 3}
                  loading={publish.isPending}
                  onClick={() => void save()}
                >
                  Publish staff commission defaults
                </Button>
                <p>{edits.length} edited cells · maximum 100 per publication</p>
              </div>
            )}
          </fieldset>
        )}
        <div className="flex gap-3">
          <Button variant="secondary" disabled={busy} onClick={() => void reload()}>
            {draft ? "Reload commission matrix and discard draft" : "Reload commission matrix"}
          </Button>
          <Button
            variant="secondary"
            disabled={busy || !!draft || page === 1}
            onClick={() => setPage(page - 1)}
          >
            Previous commission staff
          </Button>
          <span>
            Page {page} · {matrix.data?.total ?? 0} active staff
          </span>
          <Button
            variant="secondary"
            disabled={busy || !!draft || !matrix.data || page * 20 >= matrix.data.total}
            onClick={() => setPage(page + 1)}
          >
            Next commission staff
          </Button>
        </div>
      </div>
    </Card>
  );
}
