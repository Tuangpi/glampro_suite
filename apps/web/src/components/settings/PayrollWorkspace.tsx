import { useAuth } from "@/contexts/AuthContext";
import PayrollClose from "./PayrollClose";

/**
 * The outlet-picker prompt that used to live here is gone with the picker
 * (`OUTLETS_UI_ENABLED`): staff could not follow its advice once the control was
 * hidden, and the session clears any stored branch selection on load, so this
 * panel is always salon-wide. The API still refuses outlet-scoped payroll close
 * (`payroll-close-loader.ts`), which is the actual boundary.
 */
export default function PayrollWorkspace() {
  const { user, isReadOnly } = useAuth();
  if (!user || !["SUPER_ADMIN", "MANAGER"].includes(user.globalRole))
    return <p>Only the owner or a manager can access monthly payroll close.</p>;
  return <PayrollClose canWrite={!isReadOnly} isOwner={user.globalRole === "SUPER_ADMIN"} />;
}
