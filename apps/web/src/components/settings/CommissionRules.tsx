import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CommissionConfiguration,
  CommissionKind,
  CommissionOptions,
  CommissionPreview,
  CommissionRuleView,
  CommissionScope,
} from "@glampro_suite/shared";
import { publishCommissionRuleSchema, COMMISSION_KIND_LABELS } from "@glampro_suite/shared";
import { get, post, getErrorMessage } from "@/lib/api";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import { useDepartments } from "@/hooks/useDepartments";
import { useSalonFormatting } from "@/contexts/SalonFormattingContext";

export default function CommissionRules({
  staffId,
  canEdit,
}: {
  staffId?: string;
  canEdit: boolean;
}) {
  const client = useQueryClient();
  const { formatDateTime, timeZone } = useSalonFormatting();
  const [page, setPage] = useState(1);
  const [kind, setKind] = useState<CommissionKind>("SERVICE");
  const [scope, setScope] = useState<CommissionScope>(staffId ? "STAFF" : "COMPANY");
  const [target, setTarget] = useState("");
  const [search, setSearch] = useState("");
  const [rate, setRate] = useState("0");
  const [inherit, setInherit] = useState(false);
  const [effectiveAt, setEffectiveAt] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [previewItem, setPreviewItem] = useState("");
  const [draftRevision, setDraftRevision] = useState<{ revision: string | null } | null>(null);
  const departments = useDepartments();
  const config = useQuery({
    queryKey: ["commissions", staffId ?? "company", page],
    queryFn: () => get<CommissionConfiguration>("/commissions", { staffId, page }),
    staleTime: 0,
  });
  const options = useQuery({
    queryKey: ["commission-options", kind, search],
    queryFn: () => get<CommissionOptions>("/commissions/options", { itemKind: kind, search }),
    enabled: !!staffId || scope === "PACKAGE",
    staleTime: 30_000,
  });
  const staleDraft =
    !!draftRevision && !!config.data && draftRevision.revision !== config.data.revision;
  const publish = useMutation({
    mutationFn: (input: unknown) => post("/commissions", input),
    onSuccess: () => client.invalidateQueries({ queryKey: ["commissions"] }),
  });
  const preview = useQuery({
    queryKey: ["commissions", "preview", staffId, kind, previewItem],
    queryFn: () =>
      post<CommissionPreview>("/commissions/preview", {
        staffId,
        itemKind: kind,
        itemId: previewItem,
      }),
    enabled: !!staffId && !!previewItem,
    staleTime: 0,
  });

  async function save() {
    if (
      !canEdit ||
      !config.data ||
      config.isFetching ||
      config.isError ||
      publish.isPending ||
      staleDraft
    )
      return;
    setError("");
    setNotice("");
    try {
      if (rate.trim() === "" && !inherit) throw new Error("Enter a commission percentage.");
      const input = publishCommissionRuleSchema.parse({
        staffId: staffId ?? null,
        itemKind: kind,
        scope,
        targetId: ["ITEM", "DEPARTMENT", "PACKAGE"].includes(scope) ? target : null,
        rate: inherit ? null : Number(rate),
        reason,
        expectedRevision: draftRevision ? draftRevision.revision : config.data.revision,
        ...(effectiveAt ? { effectiveAt: new Date(effectiveAt).toISOString() } : {}),
      });
      await publish.mutateAsync(input);
      setNotice("Commission rule published. Previously earned commissions are unchanged.");
      setReason("");
      setDraftRevision(null);
    } catch (cause) {
      setError(
        cause instanceof Error && cause.name === "ZodError"
          ? "Check the percentage, target and reason (at least 3 characters)."
          : getErrorMessage(cause),
      );
    }
  }
  function rows(values: CommissionRuleView[]) {
    return (
      <ul className="space-y-2">
        {values.map((row) => (
          <li key={row.id} className="text-sm">
            {row.itemKind} · {row.scope} {row.targetName ?? ""} ·{" "}
            {row.rate === null ? "Inherit" : `${row.rate}%`}
            {" · Effective "}
            {formatDateTime(row.effectiveAt)} ({timeZone})
            <div className="text-xs text-ink-muted">
              Published {formatDateTime(row.createdAt)} by {row.actorName}: {row.reason}
            </div>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <Card
      title={staffId ? "Advanced commissions" : "Company commission defaults"}
      description="Item → package → department → staff → company. Rates never stack. New kinds remain disabled for earnings pending collection and reporting cutover."
    >
      <div className="flex flex-col gap-3">
        {config.isPending && <p role="status">Loading commission rules…</p>}
        {config.isError && (
          <p role="alert">
            Unable to load commission rules.{" "}
            <button type="button" onClick={() => void config.refetch()}>
              Retry
            </button>
          </p>
        )}
        <Button
          type="button"
          variant="secondary"
          disabled={config.isFetching || publish.isPending}
          onClick={async () => {
            const result = await config.refetch();
            if (result.isError) {
              setError(getErrorMessage(result.error));
              return;
            }
            setDraftRevision(null);
            setReason("");
            setTarget("");
            setRate("0");
            setInherit(false);
            setEffectiveAt("");
            setError("");
            void client.invalidateQueries({ queryKey: ["commissions", "preview"] });
          }}
        >
          {draftRevision ? "Reload commission rules and discard draft" : "Refresh commission rules"}
        </Button>
        {error && <p role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
        {staleDraft && (
          <p role="alert">
            Commission settings changed. Reload and discard your draft before publishing.
          </p>
        )}
        {config.data && (
          <>
            {staffId && (
              <p className="text-sm">
                Legacy service fallback: {config.data.legacyServiceRate}%. Publish a staff default
                to replace it, or Inherit to use the company default. Products default to company
                rate, otherwise 0%.
              </p>
            )}
            {!staffId && (
              <p className="text-sm">
                Existing staff service rates remain unchanged until the staff member is explicitly
                set to inherit. Unconfigured kinds default to 0%, except explicitly complimentary
                services (FOC), which default to 5%. Publishing rates does not classify a service as
                FOC.
              </p>
            )}
            <h4>Current rules</h4>
            {config.data.current.length ? rows(config.data.current) : <p>No published rules.</p>}
            {!!config.data.scheduled.length && (
              <>
                <h4>Scheduled rules</h4>
                <p className="text-sm">
                  To supersede a scheduled rule, publish a replacement for the same scope and
                  effective time. A change effective now does not cancel future rules.
                </p>
                {rows(config.data.scheduled)}
              </>
            )}
            {canEdit && (
              <fieldset
                disabled={publish.isPending || config.isFetching || config.isError || staleDraft}
                onChangeCapture={() => {
                  if (!draftRevision && config.data)
                    setDraftRevision({ revision: config.data.revision });
                }}
                className="flex flex-col gap-3"
              >
                <legend>Publish a replacement rule</legend>
                <Select
                  label="Commission item type"
                  value={kind}
                  onChange={(event) => {
                    setKind(event.target.value as CommissionKind);
                    setScope(staffId ? "STAFF" : "COMPANY");
                    setInherit(false);
                    setTarget("");
                    setPreviewItem("");
                  }}
                  options={Object.entries(COMMISSION_KIND_LABELS).map(([value, label]) => ({
                    value,
                    label,
                  }))}
                />
                {staffId && (
                  <Select
                    label="Rule scope"
                    value={scope}
                    onChange={(event) => {
                      setScope(event.target.value as CommissionScope);
                      setTarget("");
                    }}
                    options={[
                      { value: "STAFF", label: "Staff default" },
                      ...(["SERVICE", "PRODUCT", "FOC"].includes(kind)
                        ? [{ value: "DEPARTMENT", label: "Department override" }]
                        : []),
                      { value: "ITEM", label: "Specific item override" },
                    ]}
                  />
                )}
                {!staffId &&
                  [
                    "PACKAGE_SALE",
                    "PACKAGE_REDEMPTION",
                    "STORED_CREDIT_SALE",
                    "STORED_CREDIT_SPEND",
                  ].includes(kind) && (
                    <Select
                      label="Rule scope"
                      value={scope}
                      onChange={(event) => {
                        setScope(event.target.value as CommissionScope);
                        setTarget("");
                        setInherit(false);
                      }}
                      options={[
                        { value: "COMPANY", label: "Company default" },
                        { value: "PACKAGE", label: "Package override" },
                      ]}
                    />
                  )}
                {(staffId || scope === "PACKAGE") && (
                  <Input
                    label="Search catalogue for rule or preview"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                )}
                {options.isError && <p role="alert">Unable to load catalogue items.</p>}
                {options.data && options.data.total > options.data.items.length && (
                  <p>
                    Showing first {options.data.items.length} of {options.data.total} items. Narrow
                    your search.
                  </p>
                )}
                {scope === "DEPARTMENT" && (
                  <Select
                    label="Commission department"
                    value={target}
                    onChange={(event) => setTarget(event.target.value)}
                    options={[
                      { value: "", label: "Select department" },
                      ...(departments.data ?? []).map((row) => ({
                        value: row.id,
                        label: row.name,
                      })),
                    ]}
                  />
                )}
                {(scope === "ITEM" || scope === "PACKAGE") && (
                  <Select
                    label="Commission item"
                    value={target}
                    onChange={(event) => setTarget(event.target.value)}
                    options={[
                      { value: "", label: "Select item" },
                      ...(options.data?.items ?? []).map((row) => ({
                        value: row.id,
                        label: row.name,
                      })),
                    ]}
                  />
                )}
                {(staffId || scope === "PACKAGE") && (
                  <Select
                    label="Rate behavior"
                    value={inherit ? "inherit" : "custom"}
                    onChange={(event) => setInherit(event.target.value === "inherit")}
                    options={[
                      { value: "custom", label: "Custom rate (0% explicitly earns nothing)" },
                      { value: "inherit", label: "Inherit next matching level" },
                    ]}
                  />
                )}
                {!inherit && (
                  <Input
                    label="Commission percentage"
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={rate}
                    onChange={(event) => setRate(event.target.value)}
                  />
                )}
                <Input
                  label="Effective from (your browser time zone; blank means now)"
                  type="datetime-local"
                  value={effectiveAt}
                  onChange={(event) => setEffectiveAt(event.target.value)}
                />
                <Input
                  label="Commission change reason"
                  value={reason}
                  maxLength={500}
                  onChange={(event) => setReason(event.target.value)}
                />
                <Button
                  type="button"
                  disabled={reason.trim().length < 3}
                  loading={publish.isPending}
                  onClick={() => void save()}
                >
                  Publish commission rule
                </Button>
              </fieldset>
            )}
            {staffId && (
              <>
                <Select
                  label="Preview commission for item"
                  value={previewItem}
                  onChange={(event) => setPreviewItem(event.target.value)}
                  options={[
                    { value: "", label: "Select item to preview current rate" },
                    ...(options.data?.items ?? []).map((row) => ({
                      value: row.id,
                      label: row.name,
                    })),
                  ]}
                />
                {preview.isFetching && previewItem && <p role="status">Calculating preview…</p>}
                {preview.isError && <p role="alert">Unable to preview commission.</p>}
                {preview.data && !preview.isFetching && (
                  <p role="status">
                    Current applied rate: {preview.data.rate}% · Source: {preview.data.source}.
                    Unsaved and future rules are not included.
                  </p>
                )}
              </>
            )}
            <h4>Publication history</h4>
            {rows(config.data.history)}
            <div className="flex gap-3">
              <Button
                type="button"
                variant="secondary"
                disabled={page === 1 || config.isFetching}
                onClick={() => setPage(page - 1)}
              >
                Previous commission history
              </Button>
              <span>Page {page}</span>
              <Button
                type="button"
                variant="secondary"
                disabled={page * 20 >= config.data.total || config.isFetching}
                onClick={() => setPage(page + 1)}
              >
                Next commission history
              </Button>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
