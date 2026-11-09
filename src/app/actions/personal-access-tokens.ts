"use server";

import { db } from "@/lib/db";
import { personalAccessTokens, workspaces } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import crypto from "crypto";
import { z } from "zod";

import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { TOKEN_SCOPES } from "@/lib/security/token-access";

// New tokens use the permission names CLI 2.0 checks (token-access.ts); the four old names still work (§42.3).
const createPatSchema = z.object({
  label: z.string().trim().min(1, "Token label is required").max(80),
  scopes: z
    .array(z.enum([...TOKEN_SCOPES, "repo:read", "repo:write", "sprint:manage"]))
    .min(1)
    .default(["repo:read", "repo:write", "task:write"]),
  expiresInDays: z.number().int().min(1).max(365).nullable().optional(),
  /** Only this workspace (report A3.6); the person must be able to open it. */
  workspaceId: z.string().uuid().nullable().optional(),
});

const patIdSchema = z.string().uuid();

export type PersonalAccessTokenSummary = {
  id: string;
  label: string;
  tokenPrefix: string;
  scopes: string[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  isExpiringSoon: boolean;
  workspaceTitle: string | null;
};

export async function listPersonalAccessTokens(): Promise<
  | { success: true; tokens: PersonalAccessTokenSummary[] }
  | { success: false; error: string }
> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: "Sign in to continue" };
    }

    const rows = await db
      .select()
      .from(personalAccessTokens)
      .where(
        and(
          eq(personalAccessTokens.userId, user.id),
          isNull(personalAccessTokens.revokedAt),
        ),
      )
      .orderBy(desc(personalAccessTokens.createdAt))
      .limit(50);

    const nowMs = Date.now();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const ids = [...new Set(rows.map((r) => r.workspaceId).filter((id): id is string => Boolean(id)))];
    const titles = ids.length ? new Map((await db.select({ id: workspaces.id, title: workspaces.title }).from(workspaces).where(inArray(workspaces.id, ids))).map((w) => [w.id, w.title])) : new Map<string, string>();

    return {
      success: true,
      tokens: rows.map((row) => {
        const expiresAtMs = row.expiresAt ? row.expiresAt.getTime() : null;
        const isExpiringSoon =
          expiresAtMs !== null &&
          expiresAtMs > nowMs &&
          expiresAtMs - nowMs <= sevenDaysMs;
        return {
          id: row.id,
          label: row.label,
          tokenPrefix: row.tokenPrefix,
          scopes: Array.isArray(row.scopes) ? row.scopes : ["repo:read", "repo:write"],
          expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
          lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
          createdAt: row.createdAt.toISOString(),
          isExpiringSoon,
          workspaceTitle: row.workspaceId ? titles.get(row.workspaceId) ?? null : null,
        };
      }),
    };
  } catch {
    // Gracefully return empty list if table migration hasn't run yet in local dev
    return { success: true, tokens: [] };
  }
}

export async function createPersonalAccessToken(input: {
  label: string;
  scopes?: string[];
  expiresInDays?: number | null;
  workspaceId?: string | null;
}): Promise<
  | {
      success: true;
      rawToken: string;
      token: PersonalAccessTokenSummary;
    }
  | { success: false; error: string }
> {
  try {
    const parsed = createPatSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message ?? "Invalid token configuration",
      };
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: "Sign in to continue" };
    }

    if (parsed.data.workspaceId) {
      const access = await getWorkspaceAccessById(parsed.data.workspaceId, user.id);
      if (!access?.canRead) return { success: false, error: "You can't open that workspace" };
    }

    const secretHex = crypto.randomBytes(24).toString("hex");
    const rawToken = `nb_pat_${secretHex}`;
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const tokenPrefix = `${rawToken.slice(0, 12)}…${rawToken.slice(-4)}`;

    const expiresAt =
      parsed.data.expiresInDays && parsed.data.expiresInDays > 0
        ? new Date(Date.now() + parsed.data.expiresInDays * 24 * 60 * 60 * 1000)
        : null;

    const [inserted] = await db
      .insert(personalAccessTokens)
      .values({
        userId: user.id,
        label: parsed.data.label,
        tokenHash,
        tokenPrefix,
        scopes: parsed.data.scopes,
        expiresAt,
        workspaceId: parsed.data.workspaceId ?? null,
      })
      .returning();

    if (!inserted) {
      return { success: false, error: "Failed to create Personal Access Token" };
    }

    const nowMs = Date.now();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const expiresAtMs = inserted.expiresAt ? inserted.expiresAt.getTime() : null;

    return {
      success: true,
      rawToken,
      token: {
        id: inserted.id,
        label: inserted.label,
        tokenPrefix: inserted.tokenPrefix,
        scopes: inserted.scopes,
        expiresAt: inserted.expiresAt ? inserted.expiresAt.toISOString() : null,
        lastUsedAt: null,
        createdAt: inserted.createdAt.toISOString(),
        isExpiringSoon:
          expiresAtMs !== null &&
          expiresAtMs > nowMs &&
          expiresAtMs - nowMs <= sevenDaysMs,
        workspaceTitle: null,
      },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to create Personal Access Token",
    };
  }
}

export async function revokePersonalAccessToken(
  tokenId: string,
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    if (!patIdSchema.safeParse(tokenId).success) {
      return { success: false, error: "Invalid token ID" };
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: "Sign in to continue" };
    }

    await db
      .update(personalAccessTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(personalAccessTokens.id, tokenId),
          eq(personalAccessTokens.userId, user.id),
          isNull(personalAccessTokens.revokedAt),
        ),
      );

    return { success: true };
  } catch {
    return { success: false, error: "Failed to revoke Personal Access Token" };
  }
}

/** Workspaces a token can be limited to: ones you own or edit (same list as the agent sign-in page). */
export async function listTokenWorkspaces(): Promise<Array<{ id: string; title: string; slug: string | null }>> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { listAgentWorkspaces } = await import("@/lib/extension/device-codes");
  return listAgentWorkspaces(user.id);
}
