import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { useAuth } from "@/contexts/AuthContext";
import { post } from "@/lib/api";
import type { CartLine } from "@/hooks/useSale";
import type { StaffOption } from "./CartLine";
const previewSchema = z.object({
  calculatedAt: z.string().nullable(),
  rows: z.array(z.object({ staffId: z.string(), amount: z.string().nullable() })),
});

/** A marginal plan estimate, never a promise of source-time or month-end earnings. */
export default function CartCommissionPreview({
  line,
  customerId,
  staff,
}: {
  line: CartLine;
  unitPrice?: string;
  customerId?: string;
  staff: StaffOption[];
}) {
  const { user } = useAuth();
  const shares =
    line.itemType === "SERVICE" ? line.attribution?.performers : line.attribution?.sellers;
  const supported =
    ["SERVICE", "PRODUCT", "PACKAGE", "VALUE_PACKAGE"].includes(line.itemType) &&
    (!["PACKAGE", "VALUE_PACKAGE"].includes(line.itemType) || !!customerId) &&
    !!shares?.length &&
    ["SUPER_ADMIN", "MANAGER", "STAFF"].includes(user?.globalRole ?? "");
  const input = {
    itemType: line.itemType,
    itemId: line.itemId,
    ...(customerId ? { customerId } : {}),
    ...(line.discountPercent !== undefined ? { discountPercent: line.discountPercent } : {}),
    quantity: line.quantity,
    shares,
  };
  const query = useQuery({
    queryKey: ["cart-commission-preview", user?.id, user?.globalRole, input],
    queryFn: async () => previewSchema.parse(await post("/payroll-close/cart-preview", input)),
    enabled: supported,
    retry: false,
  });
  if (!line.attribution) return null;
  return (
    <section aria-label="Estimated line commission" className="text-xs text-ink-muted">
      <p className="font-bold">Estimated commission</p>
      {!supported ? (
        <p>
          Unavailable for this line. Package/session, tax and tender evidence are resolved at
          checkout and month end.
        </p>
      ) : query.isPending ? (
        <p role="status">Loading estimate…</p>
      ) : query.isError ? (
        <p>Estimate unavailable. Attribution is still saved.</p>
      ) : (
        <>
          <ul>
            {query.data.rows.map((row) => (
              <li key={row.staffId}>
                {staff.find((person) => person.id === row.staffId)?.name ?? "Unavailable staff"}:{" "}
                {row.amount === null
                  ? "Unavailable — no supported plan snapshot"
                  : `SGD ${row.amount}`}
              </li>
            ))}
          </ul>
          <p>
            Hypothetical fully money-paid line, using server catalogue prices, GST and the last
            calculated plan and month-to-date pool ({query.data.calculatedAt ?? "not calculated"}).
            Excludes incentives and other cart lines; package/credit funding can change the result.
            Nothing is posted.
          </p>
        </>
      )}
    </section>
  );
}
