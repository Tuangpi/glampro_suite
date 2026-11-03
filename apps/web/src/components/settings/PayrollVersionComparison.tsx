import { useState } from "react";
import type { PayrollPlanDefinition } from "@glampro_suite/shared";
import { formatPrice } from "@/lib/utils";
import Select from "@/components/ui/Select";
import PayrollImpactTable from "./PayrollImpactTable";
import { signedMoney, sourceLabels, type PayrollPostedMoney } from "./payroll-impact";
import { payrollDefinitionChanges } from "./payroll-version-diff";

type Version = {
  id: string;
  versionNo: number;
  status: string;
  effectiveFrom: string;
  definition: PayrollPlanDefinition;
};

/** Posted money exists for one rule version only, so it is never shown against a
 * different selection as if it were that selection's money. */
function PostedMoneyFor({
  postedMoney,
  version,
  unsaved,
}: {
  postedMoney: PayrollPostedMoney | null | undefined;
  version: Version | undefined;
  unsaved: boolean;
}) {
  if (postedMoney === undefined)
    return (
      <p>
        Posted money is not part of a rule diff. Check historical inputs reports the posted month
        valued under the latest saved rules.
      </p>
    );
  if (postedMoney === null)
    return (
      <p>The readiness check could not value the posted month, so no posted money is shown here.</p>
    );
  if (unsaved)
    return (
      <p>An unsaved draft has no posted-money estimate; save it and check historical inputs.</p>
    );
  const impact = postedMoney.impact;
  if (!version || version.id !== impact.afterVersion.id)
    return (
      <p>
        Posted money was calculated against version {impact.afterVersion.versionNo}. Select version{" "}
        {impact.afterVersion.versionNo} above to see it; it is not recalculated per rule version.
      </p>
    );
  return (
    <section aria-label="Posted money under the selected version" className="space-y-2">
      <p>
        Posted {postedMoney.periodKey} commission:{" "}
        {formatPrice(impact.totals.before, impact.currency)} · with version{" "}
        {impact.afterVersion.versionNo} ({impact.afterVersion.status}, effective{" "}
        {impact.afterVersion.effectiveFrom}): {formatPrice(impact.totals.after, impact.currency)} ·
        change {signedMoney(impact.totals.change, impact.currency)}.
      </p>
      <p>Money source: {sourceLabels[postedMoney.inputSource]}.</p>
      <p>
        These totals value the posted month under version {impact.afterVersion.versionNo}; they are
        not the difference between the two rule versions selected above.
      </p>
      <PayrollImpactTable periodKey={postedMoney.periodKey} impact={impact} />
    </section>
  );
}

export default function PayrollVersionComparison({
  versions,
  draft,
  postedMoney,
}: {
  versions: Version[];
  draft?: PayrollPlanDefinition;
  /** `undefined` until the readiness check runs, `null` when it could not value the month. */
  postedMoney?: PayrollPostedMoney | null;
}) {
  const [beforeId, setBeforeId] = useState(versions[1]?.id ?? versions[0]?.id ?? "");
  const [afterId, setAfterId] = useState(versions[0]?.id ?? "");
  const options = versions.map((version) => ({
    value: version.id,
    label: `Version ${version.versionNo} · ${version.status} · ${version.effectiveFrom}`,
  }));
  const before = versions.find((version) => version.id === beforeId);
  const after = versions.find((version) => version.id === afterId);
  const definition = afterId === "unsaved" ? draft : after?.definition;
  const changes =
    before && definition ? payrollDefinitionChanges(before.definition, definition) : [];
  return (
    <section aria-label="Rule version comparison" className="space-y-2">
      <Select
        label="Compare from version"
        value={beforeId}
        onChange={(event) => setBeforeId(event.target.value)}
        options={options}
      />
      <Select
        label="Compare to version"
        value={afterId}
        onChange={(event) => setAfterId(event.target.value)}
        options={[...options, ...(draft ? [{ value: "unsaved", label: "Unsaved draft" }] : [])]}
      />
      {before && after && before.effectiveFrom !== after.effectiveFrom && (
        <p>
          Effective date: {before.effectiveFrom} → {after.effectiveFrom}
        </p>
      )}
      <PostedMoneyFor postedMoney={postedMoney} version={after} unsaved={afterId === "unsaved"} />
      {!definition ? (
        <p>Select an available version.</p>
      ) : !changes.length ? (
        <p>No rule changes.</p>
      ) : (
        changes.map((change) => (
          <div key={change.path} className="border-b py-2">
            <p>{change.path}</p>
            <p>
              Before: <code>{JSON.stringify(change.before) ?? "Not present"}</code>
            </p>
            <p>
              After: <code>{JSON.stringify(change.after) ?? "Not present"}</code>
            </p>
          </div>
        ))
      )}
    </section>
  );
}
