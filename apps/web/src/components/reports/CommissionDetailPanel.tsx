import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { payrollCommissionTypeSchema } from "@glampro_suite/shared";
import { get, downloadFile, getErrorMessage } from "@/lib/api";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import { useSalonFormatting } from "@/contexts/SalonFormattingContext";

interface DetailView {
  approved: boolean;
  unavailablePeriods?: string[];
  total: number;
  page: number;
  pages: number;
  rows: {
    period: string;
    staffId: string;
    staffName: string;
    saleId: string | null;
    customerId: string | null;
    packageId: string | null;
    line: {
      id: string;
      businessDate: string;
      commissionType: string;
      baseAmount: string;
      units: string;
      status: string;
    };
  }[];
}

export default function CommissionDetailPanel() {
  const { timeZone } = useSalonFormatting();
  const [period, setPeriod] = useState(() =>
    new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit" })
      .format(new Date())
      .slice(0, 7),
  );
  const [filters, setFilters] = useState({
    staffId: "",
    customerId: "",
    packageId: "",
    from: "",
    to: "",
    commissionType: "",
  });
  const [page, setPage] = useState(1);
  const [throughPeriod, setThroughPeriod] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const params = {
    period,
    ...(throughPeriod ? { throughPeriod } : {}),
    page,
    ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value)),
  };
  const query = useQuery({
    queryKey: ["commission-detail", params],
    queryFn: () => get<DetailView>("/payroll-close/commission-detail", params),
    enabled: /^\d{4}-(0[1-9]|1[0-2])$/.test(period),
    retry: false,
  });
  return (
    <Card
      title="Commission detail"
      description="Approved monthly base lines. Commission awards are pooled by plan component, not invented per source line."
    >
      <div className="flex flex-wrap gap-3">
        <Input
          label="Commission month"
          type="month"
          value={period}
          onChange={(event) => {
            setPeriod(event.target.value);
            setPage(1);
          }}
        />
        <Input
          label="Through payroll month (optional)"
          type="month"
          value={throughPeriod}
          onChange={(event) => {
            setThroughPeriod(event.target.value);
            setPage(1);
          }}
        />
        {(["staffId", "customerId", "packageId", "from", "to"] as const).map((key) => (
          <Input
            key={key}
            label={
              {
                staffId: "Staff ID",
                customerId: "Customer ID",
                packageId: "Package ID",
                from: "From date",
                to: "To date",
              }[key]
            }
            type={key === "from" || key === "to" ? "date" : "text"}
            value={filters[key]}
            onChange={(event) => {
              setFilters({ ...filters, [key]: event.target.value });
              setPage(1);
            }}
          />
        ))}
        <label>
          Commission type
          <select
            value={filters.commissionType}
            onChange={(event) => {
              setFilters({ ...filters, commissionType: event.target.value });
              setPage(1);
            }}
          >
            <option value="">All types</option>
            {payrollCommissionTypeSchema.options.map((type) => (
              <option key={type}>{type}</option>
            ))}
          </select>
        </label>
      </div>
      <Button
        disabled={downloading || !query.data?.approved}
        onClick={async () => {
          setDownloading(true);
          setError(null);
          try {
            await downloadFile("/payroll-close/commission-detail.xlsx", params);
          } catch (cause) {
            setError(getErrorMessage(cause));
          } finally {
            setDownloading(false);
          }
        }}
      >
        Export commission detail (Excel)
      </Button>
      {error && <p role="alert">{error}</p>}
      {query.isError ? (
        <p role="alert">{getErrorMessage(query.error)}</p>
      ) : query.isPending ? (
        <p role="status">Loading commission detail…</p>
      ) : (
        query.data && (
          <>
            {!query.data.approved ? (
              <p>
                No approved payroll snapshot for this month.
                {query.data.unavailablePeriods && query.data.unavailablePeriods.length > 0
                  ? ` Unavailable months: ${query.data.unavailablePeriods.join(", ")}. The range is not partially exported.`
                  : ""}
              </p>
            ) : (
              <>
                <p>
                  {query.data.total} matching base lines. Customer/package references are shown only
                  where source evidence identifies them.
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <caption>Approved commission bases</caption>
                    <thead>
                      <tr>
                        <th>Staff</th>
                        <th>Payroll month</th>
                        <th>Date</th>
                        <th>Type</th>
                        <th>Base</th>
                        <th>Units</th>
                        <th>Status</th>
                        <th>Sale</th>
                        <th>Customer</th>
                        <th>Package</th>
                      </tr>
                    </thead>
                    <tbody>
                      {query.data.rows.map((row) => (
                        <tr key={`${row.period}:${row.staffId}:${row.line.id}`}>
                          <td>{row.staffName}</td>
                          <td>{row.period}</td>
                          <td>{row.line.businessDate}</td>
                          <td>{row.line.commissionType}</td>
                          <td>{row.line.baseAmount}</td>
                          <td>{row.line.units}</td>
                          <td>{row.line.status}</td>
                          <td>{row.saleId ?? "Unavailable"}</td>
                          <td>{row.customerId ?? "Unavailable"}</td>
                          <td>{row.packageId ?? "Unavailable"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Button disabled={page <= 1 || query.isFetching} onClick={() => setPage(page - 1)}>
                  Previous detail page
                </Button>
                <Button
                  disabled={page >= query.data.pages || query.isFetching}
                  onClick={() => setPage(page + 1)}
                >
                  Next detail page
                </Button>
              </>
            )}
          </>
        )
      )}
    </Card>
  );
}
