import "server-only";
import type { User } from "@supabase/supabase-js";

type IdentityRow = {
  id: string;
  provider: string;
  provider_id: string;
  identity_data: Record<string, unknown> | null;
};

async function readIdentities(userId: string): Promise<IdentityRow[]> {
  const [{ db }, { sql }] = await Promise.all([
    import("@/lib/db"),
    import("drizzle-orm"),
  ]);
  return Array.from(await db.execute<IdentityRow>(sql`
    SELECT id, provider, provider_id, identity_data
    FROM auth.identities WHERE user_id = ${userId}::uuid
    ORDER BY created_at
  `));
}

/** The authenticated JWT snapshot deliberately omits linked identities. */
export async function loadGithubLinkedUser(
  user: User,
  read: (userId: string) => Promise<IdentityRow[]> = readIdentities,
): Promise<User> {
  // Always read the current list, including an authoritative empty result after
  // unlinking. A failed lookup must not become permission to link again.
  const rows = await read(user.id).catch(() => {
    throw new Error("Could not check your linked GitHub account. Retry.");
  });
  return {
    ...user,
    identities: rows.map((row) => ({
      id: row.provider_id,
      identity_id: row.id,
      user_id: user.id,
      provider: row.provider,
      identity_data: row.identity_data || {},
    })) as User["identities"],
  };
}
