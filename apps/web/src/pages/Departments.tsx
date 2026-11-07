import { useState } from "react";
import { saveDepartmentSchema, type DepartmentSummary } from "@glampro_suite/shared";

import Button from "@/components/ui/Button";
import Drawer from "@/components/ui/Drawer";
import Modal from "@/components/ui/Modal";
import Input from "@/components/ui/Input";
import Table from "@/components/ui/Table";
import { showToast } from "@/components/ui/toast-store";
import { useAuth } from "@/contexts/AuthContext";
import {
  useDepartments,
  useSaveDepartment,
  useDepartmentDeletionImpact,
  useDeleteDepartment,
} from "@/hooks/useDepartments";
import { getErrorMessage, getValidationDetails } from "@/lib/api";

export default function Departments() {
  const { user, isReadOnly } = useAuth();
  const canManage = user?.globalRole === "SUPER_ADMIN" || user?.globalRole === "MANAGER";
  const departments = useDepartments(canManage);
  const save = useSaveDepartment();
  const [editing, setEditing] = useState<DepartmentSummary | null | undefined>(undefined);
  const [name, setName] = useState("");
  const [error, setError] = useState<string>();
  const [deleting, setDeleting] = useState<DepartmentSummary | null>(null);
  const [deleteError, setDeleteError] = useState<string>();
  const impact = useDepartmentDeletionImpact(canManage ? (deleting?.id ?? null) : null);
  const remove = useDeleteDepartment();

  function openEditor(department: DepartmentSummary | null) {
    setEditing(department);
    setName(department?.name ?? "");
    setError(undefined);
  }

  if (!canManage) {
    return <p role="alert">Only salon admins and managers can manage departments.</p>;
  }

  const close = () => {
    if (!save.isPending) setEditing(undefined);
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-ink">Departments</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Organize your salon into sections such as Hair, Nails and Beauty. Physical locations are
            separate outlets.
          </p>
        </div>
        <Button disabled={isReadOnly} onClick={() => openEditor(null)}>
          Add department
        </Button>
      </header>
      {isReadOnly && <p role="status">Your salon is read-only. Department changes are disabled.</p>}
      {departments.isPending ? (
        <p role="status">Loading departments…</p>
      ) : departments.isError ? (
        <div role="alert">
          <p>{getErrorMessage(departments.error)}</p>
          <Button variant="secondary" onClick={() => void departments.refetch()}>
            Try again
          </Button>
        </div>
      ) : (
        <Table
          caption="Salon departments"
          rows={departments.data ?? []}
          rowKey={(row) => row.id}
          empty={
            <p className="rounded-card border border-line bg-surface p-6">
              No departments yet. Add your first department to use it in staff and catalogue forms.
            </p>
          }
          columns={[
            { key: "name", header: "Name", cell: (row) => row.name },
            {
              key: "actions",
              header: "Actions",
              align: "right",
              cell: (row) => (
                <div className="flex justify-end gap-2">
                  <Button
                    variant="secondary"
                    disabled={isReadOnly}
                    aria-label={`Rename ${row.name}`}
                    onClick={() => openEditor(row)}
                  >
                    Rename
                  </Button>
                  <Button
                    variant="danger"
                    disabled={isReadOnly}
                    aria-label={`Delete ${row.name}`}
                    onClick={() => {
                      setDeleteError(undefined);
                      setDeleting(row);
                    }}
                  >
                    Delete
                  </Button>
                </div>
              ),
            },
          ]}
        />
      )}
      <Drawer
        open={editing !== undefined}
        onClose={close}
        title={editing ? "Rename department" : "Add department"}
      >
        <form
          className="space-y-4"
          noValidate
          onSubmit={async (event) => {
            event.preventDefault();
            if (save.isPending || isReadOnly) return;
            const parsed = saveDepartmentSchema.safeParse({ name });
            if (!parsed.success) {
              setError(parsed.error.issues[0]?.message);
              return;
            }
            setError(undefined);
            try {
              await save.mutateAsync({ id: editing?.id, input: parsed.data });
              showToast("success", editing ? "Department renamed" : "Department created");
              setEditing(undefined);
            } catch (cause) {
              setError(getValidationDetails(cause)["body.name"] ?? getErrorMessage(cause));
            }
          }}
        >
          <Input
            label="Department name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={100}
            error={error}
            disabled={save.isPending || isReadOnly}
            hint="Use a section name, for example Hair or Nails."
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={save.isPending} onClick={close}>
              Cancel
            </Button>
            <Button type="submit" loading={save.isPending} disabled={isReadOnly}>
              Save department
            </Button>
          </div>
        </form>
      </Drawer>
      <Modal
        open={deleting !== null}
        title={`Delete ${deleting?.name ?? "department"}?`}
        onClose={() => {
          if (!remove.isPending) setDeleting(null);
        }}
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              disabled={remove.isPending}
              onClick={() => setDeleting(null)}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              disabled={
                isReadOnly ||
                !impact.data ||
                impact.isPending ||
                impact.isFetching ||
                impact.isError ||
                impact.data.commissionRules > 0
              }
              onClick={async () => {
                if (!deleting || isReadOnly || remove.isPending) return;
                setDeleteError(undefined);
                try {
                  await remove.mutateAsync(deleting.id);
                  showToast("success", "Department deleted. Related records have been unassigned.");
                  setDeleting(null);
                } catch (cause) {
                  setDeleteError(getErrorMessage(cause));
                  void impact.refetch();
                }
              }}
            >
              Delete and unassign
            </Button>
          </div>
        }
      >
        {impact.isPending ? (
          <p role="status">Checking related records…</p>
        ) : impact.isError ? (
          <div role="alert">
            <p>{getErrorMessage(impact.error)}</p>
            <Button variant="secondary" onClick={() => void impact.refetch()}>
              Retry impact check
            </Button>
          </div>
        ) : impact.data ? (
          <div className="space-y-3">
            <p>
              The following records will lose this department assignment, but will not be deleted:
            </p>
            <ul className="list-inside list-disc">
              <li>{impact.data.products} products</li>
              <li>{impact.data.services} services</li>
              <li>{impact.data.staff} staff members</li>
              <li>{impact.data.customers} customers</li>
            </ul>
            <p>
              Other department assignments remain unchanged. Services without a department can be
              performed by any otherwise eligible staff member. Commission selection may change.
              This cannot be undone.
            </p>
            <p className="text-sm text-ink-muted">
              Counts are a preview. Assignments are checked again when deletion runs.
            </p>
            {impact.data.commissionRules > 0 && (
              <p role="alert">
                Deletion blocked: {impact.data.commissionRules} department commission rules
                reference this department. Historical rules must be preserved.
              </p>
            )}
          </div>
        ) : null}
        {deleteError && (
          <p role="alert" className="mt-3 text-danger">
            {deleteError}
          </p>
        )}
      </Modal>
    </div>
  );
}
