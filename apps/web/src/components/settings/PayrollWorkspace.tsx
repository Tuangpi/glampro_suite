import { useAuth } from "@/contexts/AuthContext";
import PayrollClose from "./PayrollClose";
import { useState } from "react";
import { useSearchParams } from "react-router";
import Tabs from "@/components/ui/Tabs";
import PayrollProgress from "@/components/payroll/PayrollProgress";

/**
 * The outlet-picker prompt that used to live here is gone with the picker
 * (`OUTLETS_UI_ENABLED`): staff could not follow its advice once the control was
 * hidden, and the session clears any stored branch selection on load, so this
 * panel is always salon-wide. The API still refuses outlet-scoped payroll close
 * (`payroll-close-loader.ts`), which is the actual boundary.
 */
export default function PayrollWorkspace({ period }: { period?: string }) {
  const { user, isReadOnly } = useAuth();
  const [params, setParams] = useSearchParams();
  // Keep existing Payroll close bookmarks opening the close workflow.
  const activeTab = params.get("payroll") === "progress" ? "progress" : "close";
  const [visited, setVisited] = useState<string[]>([activeTab]);
  if (!user || !["SUPER_ADMIN", "MANAGER"].includes(user.globalRole))
    return <p>Only the owner or a manager can access monthly payroll close.</p>;
  const initialPeriod = period && /^\d{4}-(0[1-9]|1[0-2])$/.test(period) ? period : "";
  return (
    <Tabs
      label="Payroll sections"
      activeId={activeTab}
      keepMounted
      onChange={(tab) => {
        setVisited((current) => [...new Set([...current, activeTab, tab])]);
        setParams(
          (current) => {
            const next = new URLSearchParams(current);
            next.set("section", "payroll");
            next.set("payroll", tab);
            next.delete("team");
            return next;
          },
          { replace: true },
        );
      }}
      items={[
        {
          id: "progress",
          label: "Commission progress",
          content:
            activeTab === "progress" || visited.includes("progress") ? (
              <PayrollProgress period={initialPeriod || undefined} />
            ) : null,
        },
        {
          id: "close",
          label: "Monthly close",
          content:
            activeTab === "close" || visited.includes("close") ? (
              <PayrollClose
                key={initialPeriod}
                initialPeriod={initialPeriod}
                canWrite={!isReadOnly}
                isOwner={user.globalRole === "SUPER_ADMIN"}
              />
            ) : null,
        },
      ]}
    />
  );
}
