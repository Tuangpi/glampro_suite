import { useState } from "react";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Modal from "@/components/ui/Modal";
import { useStaffList } from "@/hooks/useStaff";
import { getErrorMessage, post } from "@/lib/api";
import { getPosIdentity, setPosIdentity } from "@/lib/pos-identity";

export default function PosStaffSwitch({ disabled }: { disabled: boolean }) {
  const [page, setPage] = useState(1);
  const staff = useStaffList({ page, pageSize: 200, status: "active" });
  const [staffId, setStaffId] = useState("");
  const [pin, setPin] = useState("");
  const [identity, setIdentity] = useState(getPosIdentity);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  async function verify() {
    setBusy(true);
    setError(null);
    try {
      const value = await post<NonNullable<ReturnType<typeof getPosIdentity>>>(
        "/staff/pos-pin/verify",
        { staffId, pin },
      );
      setPosIdentity(value);
      setIdentity(value);
      setPin("");
      setOpen(false);
    } catch (failure) {
      setError(getErrorMessage(failure));
      setPin("");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-ink-muted">
        Staff: {identity?.name ?? "Authenticated operator"}
      </span>
      <Button variant="ghost" disabled={disabled} onClick={() => setOpen(true)}>
        Switch staff
      </Button>
      <Modal
        open={open}
        onClose={() => {
          if (busy) return;
          setOpen(false);
          setPin("");
          setError(null);
        }}
        title="Switch POS staff"
      >
        <section aria-label="POS staff identity" className="flex flex-col gap-3">
          <p className="text-sm">
            POS staff: {identity?.name ?? "Authenticated operator"}. PIN switching does not change
            permissions or line commission attribution.
          </p>
          <Select
            label="POS staff"
            value={staffId}
            onChange={(event) => setStaffId(event.target.value)}
            options={[
              { value: "", label: "Choose staff" },
              ...[...new Map((staff.data?.data ?? []).map((row) => [row.id, row])).values()].map(
                (row) => ({ value: row.id, label: `${row.name} (${row.email ?? row.id})` }),
              ),
            ]}
          />
          {staff.isError && <p role="alert">{getErrorMessage(staff.error)}</p>}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={busy || page === 1}
              onClick={() => setPage(page - 1)}
            >
              Previous staff
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={busy || page >= (staff.data?.pageCount ?? 1)}
              onClick={() => setPage(page + 1)}
            >
              More staff
            </Button>
          </div>
          <Input
            label="Staff PIN"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            disabled={busy || disabled}
            value={pin}
            onChange={(event) => setPin(event.target.value)}
          />
          {error && <p role="alert">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={disabled || busy || !staffId || !/^\d{6}$/.test(pin)}
              onClick={() => void verify()}
            >
              Verify staff PIN
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setPosIdentity(null);
                setIdentity(null);
                setPin("");
                setOpen(false);
              }}
            >
              Use authenticated operator
            </Button>
          </div>
          <p className="text-xs text-ink-muted">
            Verification expires after 15 minutes or session renewal. Reverify if a sale asks for
            it.
          </p>
        </section>
      </Modal>
    </div>
  );
}
