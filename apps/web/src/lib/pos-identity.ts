/** Memory-only POS identity. Never substitutes for the authenticated operator. */
let identity: { token: string; staffId: string; name: string; expiresAt: number } | null = null;
export function setPosIdentity(value: typeof identity) {
  identity = value;
}
export function getPosIdentity() {
  return identity;
}
export function clearPosIdentity() {
  identity = null;
}
