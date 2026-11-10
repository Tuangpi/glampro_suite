// Validate the locked CLI engine before publishing an immutable VPS release.
const { constants, accessSync } = require("node:fs");
const { execFileSync } = require("node:child_process");
const { resolve } = require("node:path");

function verifyPrismaEngine(modulesPath) {
  const modules = resolve(modulesPath);
  const engine = resolve(modules, "@prisma/engines/schema-engine-debian-openssl-3.0.x");
  const { enginesVersion } = require(resolve(modules, "@prisma/engines"));
  accessSync(engine, constants.R_OK | constants.X_OK);
  const version = execFileSync(engine, ["--version"], {
    encoding: "utf8",
    timeout: 15000,
  }).trim();
  if (!enginesVersion || !version.split(/\s+/).includes(enginesVersion)) {
    throw new Error(`Prisma engine version mismatch: expected ${enginesVersion}`);
  }
  return version;
}

module.exports = { verifyPrismaEngine };

if (require.main === module) {
  try {
    console.log(verifyPrismaEngine(process.argv[2] || "node_modules"));
  } catch (error) {
    console.error(`Required OpenSSL 3 Prisma schema engine is invalid: ${error.message}`);
    process.exitCode = 1;
  }
}
