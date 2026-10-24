/** A hint only: the API validates ownership and active status on every request. */
export const OUTLET_STORAGE_KEY = "glampro.outlet.v1";
export function getOutletId(): string | null {
  return sessionStorage.getItem(OUTLET_STORAGE_KEY);
}
export function selectOutlet(id: string): void {
  if (id) sessionStorage.setItem(OUTLET_STORAGE_KEY, id);
  else sessionStorage.removeItem(OUTLET_STORAGE_KEY);
}
