import { useState, type ReactNode } from "react";
import {
  payrollProfileSchema,
  payrollSettingsSchema,
  payrollStaffSettingsSchema,
  payrollPlanMetadataSchema,
  type PayrollPlanMetadata,
  type PayrollProfileWrite,
  type PayrollSettingsWrite,
} from "@glampro_suite/shared";
import Button from "@/components/ui/Button";
import Checkbox from "@/components/ui/Checkbox";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";

type RevisionValue<T> = T & { revision: number };
type Profile = Omit<PayrollProfileWrite, "reason" | "expectedRevision">;
type Settings = Omit<PayrollSettingsWrite, "reason" | "expectedRevision">;
type StaffSettings = { joinDate: string | null; stageEndOverride: number | null };
type FormProps<T> = {
  value: RevisionValue<T>;
  canEdit: boolean;
  save: (body: object) => Promise<void>;
};

/** Capture fields and revision together; refetches must never silently rebase local edits. */
function useRevisionFields<T>(value: RevisionValue<T>) {
  const [snapshot, setSnapshot] = useState(value);
  const [fields, setFields] = useState(value);
  return {
    fields,
    setFields,
    revision: snapshot.revision,
    snapshot,
    stale:
      snapshot.revision !== value.revision || JSON.stringify(snapshot) !== JSON.stringify(value),
    reload: () => {
      setSnapshot(value);
      setFields(value);
    },
  };
}

function FormFrame({
  label,
  canEdit,
  stale,
  errors,
  reload,
  save,
  children,
}: {
  label: string;
  canEdit: boolean;
  stale: boolean;
  errors: string[];
  reload: () => void;
  save: () => void;
  children: ReactNode;
}) {
  return (
    <section aria-label={label} className="space-y-2">
      <h4>{label}</h4>
      {stale && (
        <p role="alert">
          {label} changed. Reload saved values before saving; local edits will be discarded.
        </p>
      )}
      <Button variant="secondary" disabled={!canEdit} onClick={reload}>
        Reload {label.toLowerCase()}
      </Button>
      <fieldset disabled={!canEdit || stale} className="space-y-3">
        {children}
        {errors.length > 0 && <p role="alert">{errors.join(" ")}</p>}
        <Button disabled={errors.length > 0} onClick={save}>
          Save {label.toLowerCase()}
        </Button>
      </fieldset>
    </section>
  );
}

export function PayrollProfileForm({ value, canEdit, save }: FormProps<Profile>) {
  const form = useRevisionFields(value);
  const { revision: _revision, ...fields } = form.fields;
  const parsed = payrollProfileSchema.safeParse(fields);
  return (
    <FormFrame
      label="Salary profile"
      canEdit={canEdit}
      stale={form.stale}
      reload={form.reload}
      errors={
        parsed.success
          ? []
          : parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      }
      save={() => {
        if (parsed.success) void save({ ...parsed.data, expectedRevision: form.revision });
      }}
    >
      {(
        [
          ["basicSalary", "Basic monthly salary"],
          ["fixedOvertime", "Fixed monthly overtime"],
          ["levy", "Monthly levy"],
          ["salesAlertPct", "Sales alert percentage"],
        ] as const
      ).map(([key, label]) => (
        <Input
          key={key}
          label={label}
          inputMode="decimal"
          value={fields[key]}
          onChange={(e) => form.setFields({ ...form.fields, [key]: e.target.value })}
        />
      ))}
      <p className="text-sm text-ink-muted">
        Configuration only. These values do not change legacy earnings or approved payroll.
      </p>
    </FormFrame>
  );
}

export function PayrollPlanMetadataForm({ value, canEdit, save }: FormProps<PayrollPlanMetadata>) {
  const form = useRevisionFields(value);
  const [positions, setPositions] = useState(value.positions.join(", "));
  const list = (text: string) => [
    ...new Set(
      text
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean),
    ),
  ];
  const parsed = payrollPlanMetadataSchema.safeParse({
    name: form.fields.name,
    description: form.fields.description,
    positions: list(positions),
    outletIds: form.fields.outletIds,
  });
  return (
    <FormFrame
      label="Plan metadata"
      canEdit={canEdit}
      stale={form.stale}
      reload={() => {
        form.reload();
        setPositions(value.positions.join(", "));
      }}
      errors={
        parsed.success
          ? []
          : parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      }
      save={() => {
        if (parsed.success) void save({ ...parsed.data, expectedRevision: form.revision });
      }}
    >
      <Input
        label="Plan name"
        value={form.fields.name}
        onChange={(e) => form.setFields({ ...form.fields, name: e.target.value })}
      />
      <Input
        label="Plan description"
        value={form.fields.description}
        onChange={(e) => form.setFields({ ...form.fields, description: e.target.value })}
      />
      <Input
        label="Plan positions (comma-separated, blank = all)"
        value={positions}
        onChange={(e) => setPositions(e.target.value)}
      />
      <Input
        label="Plan outlet IDs (comma-separated, blank = company-wide)"
        value={form.fields.outletIds.join(", ")}
        readOnly
        hint="Outlet scope is immutable. Duplicate the plan to change scope. Outlet-scoped plans cannot yet be assigned to staff."
      />
      <p className="text-sm text-ink-muted">
        Metadata changes do not modify published rule definitions. Save or discard rule edits before
        changing metadata.
      </p>
    </FormFrame>
  );
}

export function PayrollStaffSettingsForm({ value, canEdit, save }: FormProps<StaffSettings>) {
  const form = useRevisionFields(value);
  const parsed = payrollStaffSettingsSchema.omit({ reason: true }).safeParse({
    joinDate: form.fields.joinDate ?? "",
    stageEndOverride: form.fields.stageEndOverride,
    expectedRevision: form.revision,
    expectedJoinDate: form.snapshot.joinDate,
  });
  return (
    <FormFrame
      label="Staff payroll settings"
      canEdit={canEdit}
      stale={form.stale}
      reload={form.reload}
      errors={
        parsed.success
          ? []
          : parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      }
      save={() => {
        if (parsed.success)
          void save({
            joinDate: parsed.data.joinDate,
            stageEndOverride: parsed.data.stageEndOverride,
            expectedRevision: form.revision,
            expectedJoinDate: form.snapshot.joinDate,
          });
      }}
    >
      <Input
        label="Staff join date"
        type="date"
        value={form.fields.joinDate ?? ""}
        onChange={(e) => form.setFields({ ...form.fields, joinDate: e.target.value || null })}
      />
      <Input
        label="Stage end override (tenure month, blank = automatic)"
        type="number"
        min={0}
        max={1200}
        step={1}
        value={
          form.fields.stageEndOverride === null || !Number.isFinite(form.fields.stageEndOverride)
            ? ""
            : form.fields.stageEndOverride
        }
        onChange={(e) =>
          form.setFields({
            ...form.fields,
            stageEndOverride: e.target.value === "" ? null : Number(e.target.value),
          })
        }
      />
      <p className="text-sm text-ink-muted">
        The join date updates the staff employment record. For two-stage plans only, the override
        controls the first tenure-stage end; 0 skips that stage.
      </p>
    </FormFrame>
  );
}

export function PayrollSalonSettingsForm({ value, canEdit, save }: FormProps<Settings>) {
  const form = useRevisionFields(value);
  const { revision: _revision, ...fields } = form.fields;
  const parsed = payrollSettingsSchema.safeParse(fields);
  return (
    <FormFrame
      label="Salon commission settings"
      canEdit={canEdit}
      stale={form.stale}
      reload={form.reload}
      errors={
        parsed.success
          ? []
          : parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      }
      save={() => {
        if (parsed.success) void save({ ...parsed.data, expectedRevision: form.revision });
      }}
    >
      <Input
        label="Join-after cutoff day (blank = no cutoff)"
        type="number"
        min={1}
        max={31}
        step={1}
        value={
          fields.joinAfterDay === null || !Number.isFinite(fields.joinAfterDay)
            ? ""
            : fields.joinAfterDay
        }
        onChange={(e) =>
          form.setFields({
            ...form.fields,
            joinAfterDay: e.target.value === "" ? null : Number(e.target.value),
          })
        }
      />
      <Select
        label="Negative commission base policy"
        value={fields.negativeBase}
        options={[
          { value: "CARRY_FORWARD", label: "Carry forward" },
          { value: "WRITE_OFF", label: "Write off" },
        ]}
        onChange={(e) =>
          form.setFields({
            ...form.fields,
            negativeBase: e.target.value as Settings["negativeBase"],
          })
        }
      />
      <Input
        label="Minimum package deposit percentage"
        inputMode="decimal"
        value={fields.minimumDepositPct}
        onChange={(e) => form.setFields({ ...form.fields, minimumDepositPct: e.target.value })}
      />
      <Input
        label="Refund administration fee"
        inputMode="decimal"
        value={fields.refundAdminFee}
        onChange={(e) => form.setFields({ ...form.fields, refundAdminFee: e.target.value })}
      />
      <Checkbox
        label="Require staff attribution"
        checked={fields.requireAttribution}
        onChange={(e) => form.setFields({ ...form.fields, requireAttribution: e.target.checked })}
      />
      <p className="text-sm text-ink-muted">
        Configuration only. Checkout and earnings behavior remains unchanged until controlled
        cutover.
      </p>
    </FormFrame>
  );
}
