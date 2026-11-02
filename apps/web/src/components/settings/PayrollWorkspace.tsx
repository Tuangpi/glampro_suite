import { useAuth } from "@/contexts/AuthContext";
import { getOutletId } from "@/lib/outlet-storage";
import PayrollClose from "./PayrollClose";

/** Outlet switching hard-reloads the app, removing all cached payroll state. */
export default function PayrollWorkspace() {
  const { user, isReadOnly } = useAuth();
  if (!user || !["SUPER_ADMIN", "MANAGER"].includes(user.globalRole))
    return <p>Only the owner or a manager can access monthly payroll close.</p>;
  if (getOutletId())
    return (
      <p>Select “All outlets / tenant-wide” in the outlet picker to review salon-wide payroll.</p>
    );
  return <PayrollClose canWrite={!isReadOnly} isOwner={user.globalRole === "SUPER_ADMIN"} />;
}
