import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

async function main() {
  const root = process.cwd();
  const routeSource = await readFile(path.join(root, "src/app/api/e2e/auth/route.ts"), "utf8");
  const handlers = [...routeSource.matchAll(/export async function (POST|DELETE)\(request: Request\) \{\n\s*if \(process\.env\.NODE_ENV === "production"\) return productionNotFound\(\);/g)];
  const builtRoute = path.join(root, process.env.NEXT_DIST_DIR || ".next", "server/app/api/e2e/auth/route.js");

  const checks: Array<[string, boolean]> = [
    ["POST and DELETE must return 404 in production before any other work", handlers.length === 2],
    ["production 404 must use status 404", routeSource.includes("status: 404")],
  ];
  if (existsSync(builtRoute)) {
    const built = await readFile(builtRoute, "utf8");
    checks.push(["the production bundle must not contain the password sign-in path", !built.includes("signInWithPassword")]);
  }

  const failures = checks.filter(([, ok]) => !ok).map(([label]) => label);
  if (failures.length > 0) {
    throw new Error(`E2E auth bundle contract failed: ${failures.join(", ")}`);
  }

  console.log("[e2e-auth-bundle-contract] ok");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
