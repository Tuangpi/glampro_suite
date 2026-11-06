import { useState } from "react";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import Skeleton from "@/components/ui/Skeleton";
import { useModules } from "@/hooks/useSettings";
import { useHoldingHistory } from "@/hooks/useCustomers";
import { getErrorMessage } from "@/lib/api";
import {
  FamilySharingCard,
  HoldingBalanceAudit,
  PrepaidMembershipHistory,
} from "./CustomerFamilyCreditPanel";
import { HoldingDetail, HoldingTotals } from "./CustomerHoldingHistoryPanel";
import { PrepaidHoldings, PrepaidTransfers } from "./CustomerPrepaidPanel";
import { SessionPackageHoldings, SessionPackageTransfers } from "./CustomerSessionPackagesPanel";

const INTRO =
  "Who owns each balance and what can be done with it. History and the audit trail are one click away.";

/**
 * The customer's packages and credit, as three cards instead of four stacked panels.
 *
 * The split is by question, not by endpoint: **Balances and actions** answers "what does
 * this customer hold, and what can I do with it", **Family sharing** answers "who else may
 * spend it", and **History and audit** holds the evidence. A holding is listed once, in the
 * first card, and the panel that used to repeat it now points back to that row.
 *
 * Only the three reads the first card needs run on open. The evidence reads are unmounted
 * until their disclosure is opened, so the audit trail costs nothing to a receptionist
 * reading a balance — and nothing was deleted: every list that was on this tab is still on
 * this tab, one click deeper.
 */
export default function CustomerPackagesTab({ customerId }: { customerId: string }) {
  const modules = useModules();
  if (modules.isPending) return <p role="status">Loading package access…</p>;
  if (modules.isError)
    return (
      <div role="alert" className="flex flex-wrap items-center gap-2 text-sm">
        Package access could not be loaded.
        <Button size="sm" variant="secondary" onClick={() => void modules.refetch()}>
          Retry package access
        </Button>
      </div>
    );
  if (!modules.data?.some((module) => module.code === "packages" && module.entitled))
    return (
      <Card title="Packages & credit" label="Packages & credit" description={INTRO}>
        <EmptyState
          title="The packages add-on is not enabled"
          description="An owner can turn it on in Settings. Ownership, transfers and history appear here once it is on."
          className="px-2 py-8"
        />
      </Card>
    );
  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-ink-muted">{INTRO}</p>
      <Card
        title="Balances and actions"
        label="Balances and actions"
        description="What this customer holds, and what you can do with each holding."
      >
        <HoldingsOverview customerId={customerId} />
      </Card>
      <FamilySharingCard customerId={customerId} />
      <Card
        title="History and audit"
        label="History and audit"
        description="Evidence behind each balance. Each list loads when you open it."
      >
        <div className="flex flex-col gap-2 py-1">
          <Disclosure title="Transfers between customers" summary="credit and session packages">
            <h5 className="text-2xs font-heavy tracking-wide text-ink-muted uppercase">
              Prepaid credit
            </h5>
            <PrepaidTransfers customerId={customerId} />
            <h5 className="mt-4 text-2xs font-heavy tracking-wide text-ink-muted uppercase">
              Session packages
            </h5>
            <SessionPackageTransfers customerId={customerId} />
          </Disclosure>
          <Disclosure title="Credit balance audit" summary="append-only ledger">
            <HoldingBalanceAudit customerId={customerId} />
          </Disclosure>
          <Disclosure title="Family membership history" summary="moves in and out">
            <PrepaidMembershipHistory customerId={customerId} />
          </Disclosure>
          <Disclosure title="Every holding, bought and used" summary="purchases, payments, usage">
            <HoldingReport customerId={customerId} />
          </Disclosure>
        </div>
      </Card>
    </div>
  );
}

/**
 * The figures above the rows they describe. A row's *Purchase & payments* opens the same
 * evidence for one holding, so the two can never disagree.
 */
function HoldingsOverview({ customerId }: { customerId: string }) {
  const history = useHoldingHistory(customerId);
  return (
    <div className="flex flex-col gap-1 py-1">
      {history.isPending ? (
        <div aria-busy="true" aria-label="Loading holding totals" className="px-2">
          <Skeleton className="h-20" />
        </div>
      ) : history.isError ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 px-2 text-sm">
          {getErrorMessage(history.error)}{" "}
          <Button size="sm" variant="secondary" onClick={() => void history.refetch()}>
            Retry holding totals
          </Button>
        </div>
      ) : (
        <HoldingTotals report={history.data} />
      )}
      <SessionPackageHoldings customerId={customerId} />
      <PrepaidHoldings customerId={customerId} />
    </div>
  );
}

/** The per-holding evidence, read through the report key the figures already loaded. */
function HoldingReport({ customerId }: { customerId: string }) {
  const history = useHoldingHistory(customerId);
  if (history.isPending) return <p role="status">Loading holding history…</p>;
  if (history.isError)
    return (
      <div role="alert">
        {getErrorMessage(history.error)}{" "}
        <Button onClick={() => void history.refetch()}>Retry holding history</Button>
      </div>
    );
  return <HoldingDetail report={history.data} />;
}

/**
 * A closed `<details>` that mounts its contents only once opened, so nothing behind it is
 * read before somebody asks for it — the pattern `MessagingCard` uses for its history.
 */
function Disclosure({
  title,
  summary,
  children,
}: {
  title: string;
  summary: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="rounded-lg border border-line p-3"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="cursor-pointer text-sm font-bold text-ink">
        {title} <span className="font-normal text-ink-muted">· {summary}</span>
      </summary>
      <div className="pt-2">{open ? children : null}</div>
    </details>
  );
}
