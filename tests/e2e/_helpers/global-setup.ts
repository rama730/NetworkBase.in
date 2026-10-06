import { assertE2EEnvironmentIsolated } from "../../../scripts/lib/disposable-db";
import { ensureE2EFixtures } from "./fixtures";

async function globalSetup() {
  const strictGate = process.env.E2E_SCOPE === "critical";
  if (strictGate) {
    const required = [
      "E2E_USER_EMAIL",
      "E2E_USER_PASSWORD",
      "E2E_DATABASE_URL",
      "NEXT_PUBLIC_SUPABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
    ];
    const missing = required.filter((name) => !process.env[name]?.trim());
    if (missing.length > 0) {
      throw new Error(
        `[e2e] Critical gate requires deterministic fixtures. Missing: ${missing.join(", ")}`,
      );
    }
    // Compares database identities captured before rebinding (OPS-003).
    assertE2EEnvironmentIsolated();
  }
  ensureE2EFixtures();
}

export default globalSetup;
