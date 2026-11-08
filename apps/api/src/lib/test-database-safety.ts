/** No connections or environment loading: validate before constructing a client. */
export function requireTestDatabaseUrl(
  testUrl: string | undefined,
  applicationUrl?: string,
): string {
  const help =
    "Set TEST_DATABASE_URL to a separate disposable local PostgreSQL database (name must contain a test or acceptance segment).";
  if (!testUrl?.trim()) throw new Error(`Database tests require TEST_DATABASE_URL. ${help}`);

  let target: URL;
  try {
    target = new URL(testUrl);
  } catch {
    throw new Error(`Invalid TEST_DATABASE_URL. ${help}`);
  }
  const name = decodeURIComponent(target.pathname.slice(1));
  if (
    !["postgres:", "postgresql:"].includes(target.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) ||
    !/(^|[_-])(test|acceptance)([_-]|$)/i.test(name) ||
    target.search !== "" ||
    target.hash !== ""
  ) {
    throw new Error(`Unsafe TEST_DATABASE_URL. ${help} Query parameters are not allowed.`);
  }

  if (applicationUrl) {
    let application: URL;
    try {
      application = new URL(applicationUrl);
    } catch {
      throw new Error("Cannot verify database isolation: the application DATABASE_URL is invalid.");
    }
    // Reject even different host aliases/ports when the database name is the same.
    if (decodeURIComponent(application.pathname.slice(1)) === name) {
      throw new Error("TEST_DATABASE_URL must not use the application database name.");
    }
  }
  return testUrl;
}
