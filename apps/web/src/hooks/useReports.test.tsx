import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { queryKeys } from "@/constants/queryKeys";
import {
  useActivatePackageValuation,
  usePackageValuationReport,
  useReportOverview,
  useZReport,
} from "./useReports";

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@/lib/api", () => ({ get, post }));
beforeEach(() => vi.resetAllMocks());

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}
const bucket = {
  holdings: 0,
  sessionsRemaining: 0,
  net: "0.00",
  originalTax: "0.00",
  gross: "0.00",
};
const report = {
  scope: "COMPANY",
  asOf: "2026-10-24T00:00:00.000Z",
  activation: null,
  active: bucket,
  expired: bucket,
  unvalued: {
    active: { holdings: 1, sessionsRemaining: 3 },
    expired: { holdings: 0, sessionsRemaining: 0 },
  },
  unpaidPurchases: { sales: 0, holdings: 0, sourceSaleOutstanding: "0.00" },
  reconciliation: { status: "RECONCILED", purchases: 0, movements: 0 },
};

it("does not request overview or daily close while their inputs are disabled", async () => {
  const { wrapper } = setup();
  const { result } = renderHook(
    () => ({
      overview: useReportOverview({ from: "", to: "", timeZone: "Asia/Singapore" }, false),
      close: useZReport({ date: "", timeZone: "Asia/Singapore" }, false),
    }),
    { wrapper },
  );
  expect(result.current.overview.fetchStatus).toBe("idle");
  expect(result.current.close.fetchStatus).toBe("idle");
  expect(get).not.toHaveBeenCalled();
});

it("fetches a validated current report without sales dates and uses report invalidation prefix", async () => {
  get.mockResolvedValue(report);
  const { client, wrapper } = setup();
  const { result } = renderHook(usePackageValuationReport, { wrapper });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(get).toHaveBeenCalledWith("/reports/package-valuation");
  expect(client.getQueryData(queryKeys.reports.packageValuation())).toEqual(report);
  await client.invalidateQueries({ queryKey: queryKeys.reports.all() });
  expect(get).toHaveBeenCalledTimes(2);
});

it.each(["failed", "invalid"])(
  "refuses %s valuation rather than exposing a zero report",
  async (kind) => {
    if (kind === "failed") get.mockRejectedValue(new Error("Reconciliation failed"));
    else get.mockResolvedValue({ ...report, scope: "OUTLET" });
    const { wrapper } = setup();
    const { result } = renderHook(usePackageValuationReport, { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  },
);

it("posts only a validated confirmation and invalidates reports after activation", async () => {
  const input = {
    policyVersion: 1 as const,
    currency: "SGD" as const,
    reason: "Confirmed",
    confirmed: true as const,
  };
  post.mockResolvedValue({
    id: "activation",
    ...input,
    actorId: "manager",
    activatedAt: report.asOf,
  });
  const { client, wrapper } = setup();
  client.setQueryData(queryKeys.reports.packageValuation(), report);
  const { result } = renderHook(useActivatePackageValuation, { wrapper });
  await act(async () => {
    await result.current.mutateAsync(input);
  });
  expect(post).toHaveBeenCalledWith("/reports/package-valuation/activation", input);
  expect(client.getQueryState(queryKeys.reports.packageValuation())?.isInvalidated).toBe(true);
});

it("does not retry uncertain activation and refreshes its evidence", async () => {
  post.mockRejectedValue(new Error("Connection lost"));
  const { client, wrapper } = setup();
  client.setQueryData(queryKeys.reports.packageValuation(), report);
  const { result } = renderHook(useActivatePackageValuation, { wrapper });
  await act(async () => {
    await expect(
      result.current.mutateAsync({
        policyVersion: 1,
        currency: "SGD",
        reason: "Confirmed",
        confirmed: true,
      }),
    ).rejects.toThrow("Connection lost");
  });
  expect(post).toHaveBeenCalledOnce();
  expect(client.getQueryState(queryKeys.reports.packageValuation())?.isInvalidated).toBe(true);
});
