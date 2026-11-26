import { and, count, desc, eq, lt, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { profiles, userBlocks } from "@/lib/db/schema";
import { recordPrivacyEvent } from "@/lib/privacy/audit";
import type {
  ConnectionPrivacySetting,
  MessagePrivacySetting,
  ProfileVisibilitySetting,
} from "@/lib/privacy/relationship-state";

import type { PrivacyBlockedAccount, PrivacySettingsState } from "@/types/settingsTypes";

type PrivacySettingsTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export const PROFILE_NOT_FOUND_ERROR_MESSAGE = "Profile not found";

function createProfileNotFoundError() {
  return new Error(PROFILE_NOT_FOUND_ERROR_MESSAGE);
}

export function isProfileNotFoundError(error: unknown) {
  return error instanceof Error && error.message === PROFILE_NOT_FOUND_ERROR_MESSAGE;
}

async function requireProfilePrivacySettingsRow(
  tx: PrivacySettingsTransaction,
  userId: string,
) {
  const [profile] = await tx
    .select({
      visibility: profiles.visibility,
      messagePrivacy: profiles.messagePrivacy,
      connectionPrivacy: profiles.connectionPrivacy,
      searchVisibility: profiles.searchVisibility,
      findableByEmail: profiles.findableByEmail,
    })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1)
    .for("update");

  if (!profile) {
    throw createProfileNotFoundError();
  }

  return {
    visibility: (profile.visibility ?? "public") as ProfileVisibilitySetting,
    messagePrivacy: (profile.messagePrivacy ?? "connections") as MessagePrivacySetting,
    connectionPrivacy: (profile.connectionPrivacy ?? "everyone") as ConnectionPrivacySetting,
    searchVisibility: profile.searchVisibility,
    findableByEmail: profile.findableByEmail,
  };
}

type PrivacyUpdateInput =
  | { kind: "profileVisibility"; nextValue: ProfileVisibilitySetting }
  | { kind: "messagePrivacy"; nextValue: MessagePrivacySetting }
  | { kind: "connectionPrivacy"; nextValue: ConnectionPrivacySetting }
  /** Who can find me in search (0165). */
  | { kind: "searchVisibility"; nextValue: "everyone" | "my_places" | "connections" }
  | { kind: "findableByEmail"; nextValue: "on" | "off" };

export async function updatePrivacySetting(input: PrivacyUpdateInput & {
  userId: string;
  request: Request;
}) {
  await db.transaction(async (tx) => {
    const current = await requireProfilePrivacySettingsRow(tx, input.userId);
    const update = input.kind === "profileVisibility"
      ? { visibility: input.nextValue }
      : input.kind === "messagePrivacy"
        ? { messagePrivacy: input.nextValue }
        : input.kind === "searchVisibility"
          ? { searchVisibility: input.nextValue }
          : input.kind === "findableByEmail"
            ? { findableByEmail: input.nextValue === "on" }
            : { connectionPrivacy: input.nextValue };
    const rows = await tx
      .update(profiles)
      .set({ ...update, updatedAt: new Date() })
      .where(eq(profiles.id, input.userId))
      .returning({ id: profiles.id });
    if (rows.length !== 1) throw createProfileNotFoundError();

    const event = input.kind === "profileVisibility"
      ? { eventType: "profile_visibility_changed" as const, previousValue: { visibility: current.visibility }, nextValue: { visibility: input.nextValue } }
      : input.kind === "searchVisibility"
        ? { eventType: "search_visibility_changed" as const, previousValue: { searchVisibility: current.searchVisibility }, nextValue: { searchVisibility: input.nextValue } }
      : input.kind === "findableByEmail"
        ? { eventType: "find_by_email_changed" as const, previousValue: { findableByEmail: current.findableByEmail }, nextValue: { findableByEmail: input.nextValue === "on" } }
      : input.kind === "messagePrivacy"
        ? { eventType: "message_privacy_changed" as const, previousValue: { messagePrivacy: current.messagePrivacy }, nextValue: { messagePrivacy: input.nextValue } }
        : { eventType: "connection_privacy_changed" as const, previousValue: { connectionPrivacy: current.connectionPrivacy }, nextValue: { connectionPrivacy: input.nextValue } };

    await recordPrivacyEvent({
      executor: tx,
      userId: input.userId,
      request: input.request,
      ...event,
    });
  });
}

export async function getPrivacySettingsPayload(userId: string): Promise<PrivacySettingsState> {
  const [profile] = await db
    .select({
      visibility: profiles.visibility,
      messagePrivacy: profiles.messagePrivacy,
      connectionPrivacy: profiles.connectionPrivacy,
      searchVisibility: profiles.searchVisibility,
      findableByEmail: profiles.findableByEmail,
    })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);

  const [blockedAggregate] = await db
    .select({ count: count() })
    .from(userBlocks)
    .where(eq(userBlocks.blockerId, userId));

  return {
    profileVisibility: (profile?.visibility ?? "public") as ProfileVisibilitySetting,
    messagePrivacy: (profile?.messagePrivacy ?? "connections") as MessagePrivacySetting,
    connectionPrivacy: (profile?.connectionPrivacy ?? "everyone") as ConnectionPrivacySetting,
    searchVisibility: profile?.searchVisibility ?? "everyone",
    findableByEmail: profile?.findableByEmail ?? false,
    blockedCount: Number(blockedAggregate?.count ?? 0),
  };
}

export const BLOCKED_ACCOUNTS_PAGE_SIZE = 50;

type BlockedAccountsPage = { accounts: PrivacyBlockedAccount[]; nextCursor: string | null };

function encodeBlockedCursor(sortAt: Date, edgeId: string) {
  return Buffer.from(JSON.stringify([sortAt.toISOString(), edgeId])).toString("base64url");
}

function decodeBlockedCursor(cursor: string | null | undefined): { sortAt: Date; edgeId: string } | null {
  if (!cursor) return null;
  try {
    const [iso, edgeId] = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as [string, string];
    const sortAt = new Date(iso);
    return Number.isNaN(sortAt.getTime()) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(edgeId)) ? null : { sortAt, edgeId };
  } catch {
    return null;
  }
}

/** One keyset page, newest block first, ordered by (created_at, blocked id). Only blocks you made (B1). */
export async function listBlockedAccounts(
  userId: string,
  options: { limit?: number; cursor?: string | null } = {},
): Promise<BlockedAccountsPage> {
  const limit = Math.min(Math.max(options.limit ?? BLOCKED_ACCOUNTS_PAGE_SIZE, 1), 100);
  const cursor = decodeBlockedCursor(options.cursor);
  const sortAt = userBlocks.createdAt;
  const rows = await db
    .select({
      edgeId: userBlocks.blockedId,
      sortAt: userBlocks.createdAt,
      id: profiles.id,
      username: profiles.username,
      fullName: profiles.fullName,
      avatarUrl: profiles.avatarUrl,
      headline: profiles.headline,
      blockedAt: userBlocks.createdAt,
      source: userBlocks.source,
      note: userBlocks.note,
    })
    .from(userBlocks)
    .innerJoin(profiles, eq(profiles.id, userBlocks.blockedId))
    .where(
      and(
        eq(userBlocks.blockerId, userId),
        cursor
          ? or(lt(sortAt, cursor.sortAt), and(eq(sortAt, cursor.sortAt), lt(userBlocks.blockedId, cursor.edgeId)))
          : undefined,
      ),
    )
    .orderBy(desc(sortAt), desc(userBlocks.blockedId))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    accounts: page.map((row) => ({
      id: row.id,
      username: row.username,
      fullName: row.fullName,
      avatarUrl: row.avatarUrl,
      headline: row.headline,
      blockedAt: row.blockedAt ? row.blockedAt.toISOString() : null,
      source: row.source,
      note: row.note,
    })),
    nextCursor: rows.length > limit && last?.sortAt ? encodeBlockedCursor(last.sortAt, last.edgeId) : null,
  };
}
