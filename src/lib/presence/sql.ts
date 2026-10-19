import { sql } from "drizzle-orm";

import { profiles } from "@/lib/db/schema";

/**
 * A person's last-active time as `viewerId` may see it (AUTH-011): null when either side hides their
 * activity or the pair is blocked. List reads select this instead of the raw column, so the rule is
 * the one SQL function that Realtime and the presence projection use too.
 */
export function visibleLastActiveAt(viewerId: string) {
  return sql<Date | null>`CASE WHEN app_private.nb_presence_activity_visible(${viewerId}::uuid, ${profiles.id}) THEN ${profiles.lastActiveAt} END`.mapWith(profiles.lastActiveAt);
}
