import { sql, type SQL } from "drizzle-orm";

import { FIXTURE_EMAIL_PATTERN } from "@/lib/accounts/fixture-accounts";

/**
 * Who a viewer may find in global search (0165 `app_private.search_findable`): blocks, private profiles, "Who can
 * find me in search" and the minors rule live in the database; finished, live, real accounts are checked here.
 * `alias` is the profiles alias in the calling query.
 */
export function peopleFindableSql(viewerId: string, alias: "p" | "pr" | "profiles" = "p"): SQL {
    const p = sql.raw(alias);
    return sql`(${p}.deleted_at IS NULL AND ${p}.onboarding_status = 'completed' AND ${p}.email NOT ILIKE ${FIXTURE_EMAIL_PATTERN}
        AND app_private.search_findable(${viewerId}::uuid, ${p}.id))`;
}
