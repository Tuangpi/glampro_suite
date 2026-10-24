import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Who the current unit of work is running as.
 *
 * The three cases are deliberately distinct. "No scope" is an error, not a
 * default: there is no implicit "no tenant means all tenants", because that is
 * exactly the shape of the cross-tenant read this whole design exists to prevent
 * (see `docs/saas/TENANCY.md` §1 and §4).
 */
export type Scope =
  /** A tenant's request. Every tenant-scoped query is filtered to this id. */
  | {
      readonly kind: "tenant";
      readonly tenantId: string;
      readonly actorId?: string;
      readonly outletId?: string;
    }
  /** An explicit opt-out: the platform console and background jobs only. */
  | { readonly kind: "platform" };

const storage = new AsyncLocalStorage<Scope>();

/**
 * Forces a returned promise to start executing while the scope is still active.
 *
 * Prisma does not dispatch a query when it is called — it defers until the
 * returned promise is subscribed to (`.then`). Without this, `runAsTenant(id,
 * () => prisma.customer.findMany())` builds the promise inside the scope, returns
 * it, and the scope is already gone by the time the caller awaits it: the
 * extension would then throw "no tenant scope" for a correctly scoped call.
 * Subscribing here starts the query while `AsyncLocalStorage` still carries the
 * scope, and the caller still gets a normal promise to await.
 */
function startInsideScope<T>(value: T): T {
  if (value === null || typeof value !== "object") {
    return value;
  }

  const maybePromise = value as unknown as PromiseLike<T>;

  if (typeof maybePromise.then !== "function") {
    return value;
  }

  return Promise.resolve(maybePromise.then((resolved) => resolved)) as T;
}

/** Runs `fn` with queries scoped to `tenantId`. Called by the auth middleware. */
export function runAsTenant<T>(tenantId: string, fn: () => T, actorId?: string): T {
  return storage.run({ kind: "tenant", tenantId, ...(actorId ? { actorId } : {}) }, () =>
    startInsideScope(fn()),
  );
}

/** A validated operational branch, not a second tenant or customer identity. */
export function runAtOutlet<T>(outletId: string, fn: () => T): T {
  const scope = requireScope("Outlet");
  if (scope.kind !== "tenant") throw new Error("Outlet context requires a tenant scope");
  return storage.run({ ...scope, outletId }, () => startInsideScope(fn()));
}

export function currentOutletId(): string | undefined {
  const scope = currentScope();
  return scope?.kind === "tenant" ? scope.outletId : undefined;
}

/**
 * Runs `fn` unscoped. This is the only way to read across tenants, it is not
 * reachable from a tenant session, and every use is a deliberate, reviewable
 * call — see `docs/saas/TENANCY.md` §7.
 */
export function runAsPlatform<T>(fn: () => T): T {
  return storage.run({ kind: "platform" }, () => startInsideScope(fn()));
}

/** The active scope, or `undefined` when there is none. */
export function currentScope(): Scope | undefined {
  return storage.getStore();
}

/**
 * The scope a tenant-scoped query must run under, or a thrown error when there
 * is none. Called by the Prisma extension on every tenant-scoped operation, so
 * the failure names the model that was left unscoped.
 */
export function requireScope(model: string): Scope {
  const scope = storage.getStore();

  if (!scope) {
    throw new Error(
      `No tenant scope: \`${model}\` is tenant-scoped but the query ran outside ` +
        `runAsTenant() or runAsPlatform(). Wrap the work in one of them rather ` +
        `than reading it unscoped.`,
    );
  }

  return scope;
}
