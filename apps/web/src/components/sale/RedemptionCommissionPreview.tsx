import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import type { CommissionShares } from "@glampro_suite/shared";
import { useAuth } from "@/contexts/AuthContext";
import { post } from "@/lib/api";
import type { StaffOption } from "./CartLine";

const responseSchema = z.object({
  baseAmount: z.string().nullable(),
  reason: z.string().nullable(),
  rows: z.array(z.object({ staffId: z.string(), amount: z.string().nullable() })),
});
export default function RedemptionCommissionPreview({
  holdingId,
  customerId,
  quantity,
  shares,
  staff,
}: {
  holdingId: string | undefined;
  customerId: string | null;
  quantity: number;
  shares: CommissionShares | undefined;
  staff: StaffOption[];
}) {
  const { user } = useAuth();
  const enabled =
    !!holdingId &&
    !!customerId &&
    quantity > 0 &&
    !!shares?.length &&
    ["SUPER_ADMIN", "MANAGER", "STAFF"].includes(user?.globalRole ?? "");
  const input = { holdingId, customerId, quantity, shares };
  const query = useQuery({
    queryKey: ["redemption-commission-preview", user?.id, user?.globalRole, input],
    queryFn: async () =>
      responseSchema.parse(await post("/payroll-close/redemption-preview", input)),
    enabled,
    retry: false,
  });
  return (
    <section aria-label="Estimated session commission" className="mt-2 text-xs text-ink-muted">
      <p className="font-bold">Estimated session commission</p>
      {!enabled ? (
        <p>
          Select a funded package and explicit performers to preview the original session value.
        </p>
      ) : query.isPending ? (
        <p role="status">Loading session estimate…</p>
      ) : query.isError ? (
        <p>Session estimate unavailable. Attribution is still saved.</p>
      ) : (
        <>
          <p>
            Original session base ({quantity} sessions): {query.data.baseAmount ?? "Unavailable"}
          </p>
          {query.data.reason && <p>{query.data.reason}</p>}
          <ul>
            {query.data.rows.map((row) => (
              <li key={row.staffId}>
                {staff.find((person) => person.id === row.staffId)?.name ?? "Unavailable staff"}:{" "}
                {row.amount === null ? "Unavailable — no supported snapshot" : `SGD ${row.amount}`}
              </li>
            ))}
          </ul>
          <p>
            Conditional next-session estimate; not reserved. Checkout revalidates funding, coverage
            and attribution. Excludes incentives and other cart lines; nothing is posted.
          </p>
        </>
      )}
    </section>
  );
}
