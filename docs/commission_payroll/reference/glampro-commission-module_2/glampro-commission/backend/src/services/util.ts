/** Small helpers shared by services. */
export class AppError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}
export const notFound = (what: string) => new AppError(404, 'NOT_FOUND', `${what} not found`);
export const badRequest = (msg: string, details?: unknown) => new AppError(400, 'BAD_REQUEST', msg, details);
export const conflict = (msg: string, details?: unknown) => new AppError(409, 'CONFLICT', msg, details);
export const forbidden = (msg = 'Not allowed for your role') => new AppError(403, 'FORBIDDEN', msg);

/** Uses Web Crypto (available in Node 19+ and browsers) so services also run in the frontend mock mode. */
export const newId = (prefix: string) => `${prefix}_${globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
export const nowIso = () => new Date().toISOString();

/** Today's date (YYYY-MM-DD) in the salon time zone (NFR-02). */
const envTz = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.SALON_TZ;
export function todayInTz(tz = envTz || 'Asia/Singapore', d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

export const periodKeyOf = (date: string) => date.slice(0, 7); // "2026-09-15" -> "2026-09"

export function periodRange(periodKey: string): { from: string; to: string } {
  const [y, m] = periodKey.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${periodKey}-01`, to: `${periodKey}-${String(last).padStart(2, '0')}` };
}

export function nextPeriodKey(periodKey: string): string {
  const [y, m] = periodKey.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}
export function prevPeriodKey(periodKey: string): string {
  const [y, m] = periodKey.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

export interface Actor {
  userId: string;
  salonId: string;
  role: 'SUPER_ADMIN' | 'MANAGER' | 'STAFF' | 'CASHIER';
}
