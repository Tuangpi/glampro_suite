/**
 * Customer messages, in two jobs.
 *
 * The screen used to be one long card: two channel switches, five numbers, two
 * consent paragraphs and a history table, all at the same weight. It is now the
 * same data behind two tabs, because they answer different questions. "Channels
 * & timing" is what should happen; "Delivery history" is what did. Only the
 * second one is a read-only record, and only the first one has anything to save.
 *
 * Two mechanics worth naming. The tab lives in the URL (`?messages=history`,
 * since `?section=messages` already belongs to the Settings page), so a
 * refreshed page comes back to the tab the person was reading. And the history
 * panel is not mounted until first visited — `keepMounted` is here to preserve
 * the settings draft across a look at history, not to run a query nobody asked
 * for.
 */
import { useState } from "react";
import { useSearchParams } from "react-router";

import Tabs from "@/components/ui/Tabs";
import { useAuth } from "@/contexts/AuthContext";

import MessageHistoryPanel from "./MessageHistoryPanel";
import MessagingSettingsPanel from "./MessagingSettingsPanel";

const SETTINGS = "settings";
const HISTORY = "history";

export default function MessagingCard({ canEdit }: { canEdit: boolean }) {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  /**
   * `GET /messaging/history` is readable by owners and managers only — the same
   * two roles the API's `requireRole` names. `canEdit` is the wrong question
   * here: a suspended salon may read its history while it cannot change a
   * setting, so the two are derived separately.
   */
  const canViewHistory = user?.globalRole === "SUPER_ADMIN" || user?.globalRole === "MANAGER";
  const activeId = canViewHistory && searchParams.get("messages") === HISTORY ? HISTORY : SETTINGS;

  const [historyOpened, setHistoryOpened] = useState(activeId === HISTORY);

  const select = (id: string) => {
    if (id === HISTORY) setHistoryOpened(true);
    const next = new URLSearchParams(searchParams);
    if (id === HISTORY) next.set("messages", HISTORY);
    else next.delete("messages");
    setSearchParams(next, { replace: true });
  };

  return (
    <Tabs
      label="Customer messages"
      keepMounted
      activeId={activeId}
      onChange={select}
      items={[
        {
          id: SETTINGS,
          label: "Channels & timing",
          content: <MessagingSettingsPanel canEdit={canEdit} />,
        },
        ...(canViewHistory
          ? [
              {
                id: HISTORY,
                label: "Delivery history",
                content: historyOpened ? <MessageHistoryPanel canRetry={canEdit} /> : null,
              },
            ]
          : []),
      ]}
    />
  );
}
