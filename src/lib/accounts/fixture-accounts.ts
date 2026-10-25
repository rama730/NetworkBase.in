import { sql, type SQL } from "drizzle-orm";
import type { AnyColumn } from "drizzle-orm";

/**
 * Accounts made by the e2e suite use `@example.com` addresses (a domain reserved for examples: nobody can
 * sign up with one for real). Public lists of people leave them out, so a re-run of the suite can never put
 * "Onboarding Happy User" in front of real members.
 */
export const FIXTURE_EMAIL_PATTERN = "%@example.com";

export const notFixtureAccountSql = (email: AnyColumn): SQL => sql`${email} NOT ILIKE ${FIXTURE_EMAIL_PATTERN}`;
