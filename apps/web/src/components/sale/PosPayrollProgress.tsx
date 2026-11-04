import PayrollProgress from "@/components/payroll/PayrollProgress";
import { useAuth } from "@/contexts/AuthContext";

/**
 * CP-006 POS progress display (FR-POS-09).
 *
 * The till shows the signed-in operator their own month-to-date base, current band rate
 * and the distance to the next band, so a seller can answer "how far am I from the next
 * tier?" without leaving the sale. It is the same read model as the settings table,
 * narrowed by the API to one line: the POS never shows another staff member's figures,
 * and it is hidden for a cashier, who holds no commission statement.
 */
export default function PosPayrollProgress() {
  const { user } = useAuth();
  if (!user || !["SUPER_ADMIN", "MANAGER", "STAFF"].includes(user.globalRole)) return null;
  return <PayrollProgress selfOnly compact title="Your commission progress" />;
}
