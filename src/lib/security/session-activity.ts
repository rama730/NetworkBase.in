import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { resolveCurrentSessionRowId } from "@/lib/security/session-current";
import { cleanIpAddress } from "@/lib/utils/device";
import { createAdminClient } from "@/lib/supabase/server";
import { isLooseUuid } from "@/lib/validations/uuid";

export type SecuritySessionActivity = {
    id: string;
    device_info: { userAgent: string };
    ip_address: string;
    last_active: string;
    created_at: string;
    is_current?: boolean;
    aal?: "aal1" | "aal2" | null;
};

export type SecurityLoginHistoryEntry = {
    id: string;
    ip_address: string;
    user_agent: string;
    created_at: string;
    location?: string;
    aal?: "aal1" | "aal2" | null;
};

function toIsoString(value: Date | string | null | undefined): string {
    if (!value) return new Date(0).toISOString();
    return typeof value === "string" ? value : value.toISOString();
}

export type ListActiveSessionsPage = {
    sessions: SecuritySessionActivity[];
    hasMore: boolean;
    nextOffset: number | null;
};

export async function listActiveSessionsPage(
    userId: string,
    currentSessionId?: string | null,
    options?: {
        limit?: number;
        offset?: number;
    },
): Promise<ListActiveSessionsPage> {
    const limit = Number.isFinite(options?.limit) ? Math.max(1, Math.min(Number(options?.limit), 50)) : 10;
    const offset = Number.isFinite(options?.offset) ? Math.max(0, Number(options?.offset)) : 0;

    const rows = await db.execute<{
        id: string;
        ip: string | null;
        user_agent: string | null;
        created_at: Date | string;
        updated_at: Date | string | null;
        refreshed_at: Date | string | null;
        aal: "aal1" | "aal2" | null;
    }>(sql`
      SELECT
        id::text AS id,
        host(ip)::text AS ip,
        user_agent,
        created_at,
        updated_at,
        refreshed_at,
        aal::text AS aal
      FROM auth.sessions
      WHERE user_id = ${userId}::uuid
        AND (not_after IS NULL OR not_after > now())
      ORDER BY COALESCE(updated_at, created_at) DESC
      LIMIT ${limit + 1}
      OFFSET ${offset}
    `);

    const hasMore = rows.length > limit;
    const visibleRows = hasMore ? rows.slice(0, limit) : rows;

    const resolvedCurrentSessionId = resolveCurrentSessionRowId(
        visibleRows.map((row) => row.id),
        currentSessionId,
    );

    const sessions = visibleRows.map((row) => ({
        id: row.id,
        device_info: { userAgent: row.user_agent?.trim() || "Unknown device" },
        ip_address: cleanIpAddress(row.ip),
        created_at: toIsoString(row.created_at),
        last_active: toIsoString(row.updated_at || row.refreshed_at || row.created_at),
        is_current: resolvedCurrentSessionId ? row.id === resolvedCurrentSessionId : false,
        aal: row.aal,
    }));

    return {
        sessions,
        hasMore,
        nextOffset: hasMore ? offset + sessions.length : null,
    };
}

export async function listActiveSessions(
    userId: string,
    currentSessionId?: string | null,
    limit: number = 10,
): Promise<SecuritySessionActivity[]> {
    const page = await listActiveSessionsPage(userId, currentSessionId, { limit });
    return page.sessions;
}

export async function countOtherActiveSessions(
    userId: string,
    currentSessionId?: string | null,
): Promise<number> {
    const rows = currentSessionId
        ? await db.execute<{ count: number | string }>(sql`
          SELECT COUNT(*)::int AS count
          FROM auth.sessions
          WHERE user_id = ${userId}::uuid
            AND (not_after IS NULL OR not_after > now())
            AND id <> ${currentSessionId}::uuid
        `)
        : await db.execute<{ count: number | string }>(sql`
          SELECT COUNT(*)::int AS count
          FROM auth.sessions
          WHERE user_id = ${userId}::uuid
            AND (not_after IS NULL OR not_after > now())
        `);

    const value = Array.from(rows)[0]?.count;
    return Number.isFinite(Number(value)) ? Number(value) : 0;
}

export async function enrichSessionDeviceInfo(
    sessionId: string,
    userAgent?: string | null,
    ip?: string | null,
): Promise<void> {
    if (!sessionId || !isLooseUuid(sessionId)) return;
    try {
        const cleanUa = userAgent?.trim();
        const cleanIp = cleanIpAddress(ip);
        if (cleanUa && cleanIp && cleanIp !== "IP unavailable") {
            await db.execute(sql`
                UPDATE auth.sessions
                SET user_agent = CASE
                      WHEN user_agent IS NULL OR user_agent = '' OR user_agent = 'Unknown device' THEN ${cleanUa}
                      ELSE user_agent
                    END,
                    ip = COALESCE(ip, ${cleanIp}::inet)
                WHERE id = ${sessionId}::uuid
            `);
        } else if (cleanUa) {
            await db.execute(sql`
                UPDATE auth.sessions
                SET user_agent = CASE
                      WHEN user_agent IS NULL OR user_agent = '' OR user_agent = 'Unknown device' THEN ${cleanUa}
                      ELSE user_agent
                    END
                WHERE id = ${sessionId}::uuid
            `);
        }
    } catch {
        // Best-effort enrichment; never fail auth execution
    }
}

export async function revokeActiveSession(
    userId: string,
    sessionId: string,
): Promise<boolean> {
    if (!sessionId || !isLooseUuid(sessionId)) return false;
    // Ownership first: the admin call below deletes by id alone, so a session that is not this person's must not reach it.
    const owned = await db.execute<{ id: string }>(sql`
        SELECT id FROM auth.sessions WHERE id = ${sessionId}::uuid AND user_id = ${userId}::uuid LIMIT 1
    `);
    if (owned.length === 0) return false;
    try {
        const admin = await createAdminClient();
        if (typeof (admin.auth.admin as any)?.deleteUserSession === "function") {
            await (admin.auth.admin as any).deleteUserSession(sessionId).catch(() => null);
        }
    } catch {
        // Fall back to direct SQL deletion
    }

    await db.execute(sql`
        DELETE FROM auth.sessions
        WHERE id = ${sessionId}::uuid AND user_id = ${userId}::uuid
    `);
    return true;
}

export async function listLoginHistory(
    userId: string,
    limit: number = 20,
): Promise<SecurityLoginHistoryEntry[]> {
    // Check if user previously cleared history
    const clearedRows = await db.execute<{ created_at: Date | string }>(sql`
        SELECT created_at
        FROM profile_audit_events
        WHERE user_id = ${userId}::uuid
          AND event_type = 'login_history_cleared'
        ORDER BY created_at DESC
        LIMIT 1
    `);
    const clearedAt = clearedRows[0]?.created_at ? toIsoString(clearedRows[0].created_at) : null;

    // Check for individually dismissed session ids
    const dismissedRows = await db.execute<{ session_id: string }>(sql`
        SELECT (metadata->>'sessionId')::text AS session_id
        FROM profile_audit_events
        WHERE user_id = ${userId}::uuid
          AND event_type = 'login_history_dismissed'
          AND metadata->>'sessionId' IS NOT NULL
        ORDER BY created_at DESC
        LIMIT 500
    `);
    const dismissedIds = new Set(dismissedRows.map((r) => r.session_id).filter(Boolean));

    const rows = clearedAt
        ? await db.execute<{
            id: string;
            ip: string | null;
            user_agent: string | null;
            created_at: Date | string;
            aal: "aal1" | "aal2" | null;
          }>(sql`
            SELECT
              id::text AS id,
              host(ip)::text AS ip,
              user_agent,
              created_at,
              aal::text AS aal
            FROM auth.sessions
            WHERE user_id = ${userId}::uuid
              AND created_at > ${clearedAt}::timestamptz
            ORDER BY created_at DESC
            LIMIT ${limit + dismissedIds.size}
          `)
        : await db.execute<{
            id: string;
            ip: string | null;
            user_agent: string | null;
            created_at: Date | string;
            aal: "aal1" | "aal2" | null;
          }>(sql`
            SELECT
              id::text AS id,
              host(ip)::text AS ip,
              user_agent,
              created_at,
              aal::text AS aal
            FROM auth.sessions
            WHERE user_id = ${userId}::uuid
            ORDER BY created_at DESC
            LIMIT ${limit + dismissedIds.size}
          `);

    return rows
        .filter((row) => !dismissedIds.has(row.id))
        .slice(0, limit)
        .map((row) => ({
            id: row.id,
            ip_address: cleanIpAddress(row.ip),
            user_agent: row.user_agent?.trim() || "Unknown device",
            created_at: toIsoString(row.created_at),
            aal: row.aal,
        }));
}

export async function dismissLoginHistoryEntry(
    userId: string,
    sessionId: string,
): Promise<void> {
    if (!sessionId || !isLooseUuid(sessionId)) return;
    await db.execute(sql`
        INSERT INTO profile_audit_events (id, user_id, event_type, metadata, created_at)
        VALUES (
            gen_random_uuid(),
            ${userId}::uuid,
            'login_history_dismissed',
            jsonb_build_object('sessionId', ${sessionId}::text),
            now()
        )
    `);
}

export async function clearAllLoginHistory(
    userId: string,
): Promise<void> {
    await db.execute(sql`
        INSERT INTO profile_audit_events (id, user_id, event_type, metadata, created_at)
        VALUES (
            gen_random_uuid(),
            ${userId}::uuid,
            'login_history_cleared',
            jsonb_build_object('clearedAt', now()),
            now()
        )
    `);
}
