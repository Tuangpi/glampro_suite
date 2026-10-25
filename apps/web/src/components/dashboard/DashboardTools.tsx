import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import Tabs, { type TabItem } from "@/components/ui/Tabs";
import AssistantQuestions from "./AssistantQuestions";
import RebookingRecommendations from "./RebookingRecommendations";
import QuietDayOpportunities from "./QuietDayOpportunities";

/** Only the selected tool mounts: inactive tools do not fetch or retain answers. */
export default function DashboardTools() {
  const { user, tenant, entitlements } = useAuth();
  const [active, setActive] = useState("questions");
  const entitled = (code: string) => entitlements.some((entry) => entry.code === code);
  if (
    !user ||
    !tenant ||
    !["SUPER_ADMIN", "MANAGER"].includes(user.globalRole) ||
    !entitled("dashboard")
  )
    return null;

  const items: TabItem[] = [
    { id: "questions", label: "Business questions", content: <AssistantQuestions /> },
    ...(entitled("customers") && entitled("appointments")
      ? [{ id: "rebooking", label: "Rebooking", content: <RebookingRecommendations /> }]
      : []),
    ...(entitled("appointments") && entitled("catalogue")
      ? [{ id: "openings", label: "Quiet-day openings", content: <QuietDayOpportunities /> }]
      : []),
  ];

  return (
    <section aria-labelledby="dashboard-tools-title" className="min-w-0 border-t border-line pt-6">
      <div className="mb-3">
        <h2 id="dashboard-tools-title" className="text-lg">
          Explore your business
        </h2>
        <p className="mt-1 text-sm text-ink-body">
          Open a tool when you need it. Switching tools clears unsaved input; saved drafts remain
          available.
        </p>
      </div>
      <Tabs
        label="Business tools"
        items={items}
        activeId={items.some((item) => item.id === active) ? active : "questions"}
        onChange={setActive}
      />
    </section>
  );
}
