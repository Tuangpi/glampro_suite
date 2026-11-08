import { readFileSync } from "node:fs";
import { parse } from "dotenv";
import "dotenv/config";

import { requireTestDatabaseUrl } from "../lib/test-database-safety.js";

// Read the application setting independently: workers inherit the selected test
// DATABASE_URL, so comparing only process.env would mistake it for the app URL.
let applicationUrl: string | undefined;
try {
  applicationUrl = parse(readFileSync(new URL("../../.env", import.meta.url))).DATABASE_URL;
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

const testUrl = requireTestDatabaseUrl(process.env.TEST_DATABASE_URL, applicationUrl);
if (process.env.DATABASE_URL && process.env.DATABASE_URL !== testUrl) {
  requireTestDatabaseUrl(testUrl, process.env.DATABASE_URL);
}
process.env.DATABASE_URL = testUrl;
process.env.NODE_ENV = "test";
