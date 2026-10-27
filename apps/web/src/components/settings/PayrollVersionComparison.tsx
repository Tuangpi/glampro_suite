import { useState } from "react";
import type { PayrollPlanDefinition } from "@glampro_suite/shared";
import Select from "@/components/ui/Select";

type Version = {
  id: string;
  versionNo: number;
  status: string;
  effectiveFrom: string;
  definition: PayrollPlanDefinition;
};
import { payrollDefinitionChanges } from "./payroll-version-diff";

export default function PayrollVersionComparison({
  versions,
  draft,
}: {
  versions: Version[];
  draft?: PayrollPlanDefinition;
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
      <p>Rule comparison only. This is not a historical payroll impact calculation.</p>
    </section>
  );
}
