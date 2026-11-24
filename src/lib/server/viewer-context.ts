import { cache } from "react";
import { headers } from "next/headers";
import type { User } from "@supabase/supabase-js";
import { and, eq, isNull } from "drizzle-orm";
import type { AuthSnapshot, AuthSnapshotResolution } from "@/lib/auth/snapshot";
import { resolveAuthSnapshot } from "@/lib/auth/snapshot";
import { db } from "@/lib/db";
import { profiles } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { getUserProfile } from "@/lib/data/profile";
import { logger } from "@/lib/logger";
import { actingAsUserId } from "@/lib/server/acting-as";

/**
 * SEC-M6: `ViewerAuthContext` is SERVER-ONLY. It holds the raw Supabase
 * client instance and the full `AuthSnapshot` (which contains `sessionId`,
 * `email`, `appMetadata`, `userMetadata`). Do NOT:
 *   - return this object from a Next.js server component (Next will attempt
 *     to serialize it to the client payload);
 *   - return it from a server action;
 *   - include it in a `jsonSuccess()` / `NextResponse.json()` body;
 *   - store it in a context provider that is passed to a `"use client"` tree.
 *
 * To hand a subset to the client, project into `toClientViewer()` which
 * enforces the whitelist: `{ userId, emailVerified, username, avatarUrl,
 * displayName, aal }`. New callers must extend the whitelist here, not in
 * ad-hoc places, so the redaction boundary stays in one file.
 */
export type ViewerAuthContext = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  snapshot: AuthSnapshot | null;
  user: User | null;
  userId: string | null;
  emailVerified: boolean;
};

export type ViewerProfileContext = ViewerAuthContext & {
  profile: Awaited<ReturnType<typeof getUserProfile>> | null;
};

/** The three profile fields that are safe and sufficient for a project shell. */
type ViewerIdentityProfile = {
  username: string | null;
  fullName: string | null;
  avatarUrl: string | null;
};

export type ViewerIdentityContext = ViewerAuthContext & {
  profile: ViewerIdentityProfile | null;
};

/**
 * The minimal, client-safe projection of the viewer. Explicitly excludes
 * `sessionId`, raw user object, `appMetadata`, `userMetadata`, `email`, and
 * the Supabase client. Use this shape whenever a client component needs to
 * know "who is logged in."
 */
export type ClientViewer = {
  userId: string | null;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  emailVerified: boolean;
  /** Authentication Assurance Level: 'aal1' | 'aal2' (MFA). Never raw session id. */
  aal: 'aal1' | 'aal2' | null;
};

const getSupabaseClient = cache(async () => createClient());
type AuthSnapshotAwareClient = Awaited<ReturnType<typeof createClient>> & {
  __resolveAuthSnapshot?: () => Promise<AuthSnapshotResolution>;
};

async function getAuthResolution(client: Awaited<ReturnType<typeof createClient>>) {
  const awareClient = client as AuthSnapshotAwareClient;
  if (awareClient.__resolveAuthSnapshot) {
    return awareClient.__resolveAuthSnapshot();
  }
  return resolveAuthSnapshot(client);
}

const cachedViewerAuthContext = cache(async (): Promise<ViewerAuthContext> => {
  const supabase = await getSupabaseClient();
  // A CLI or agent token (report A2.1: one implementation for app and API): the token's person, but only on the
  // API routes tokens may call (token-access.ts); anywhere else this reads as signed out.
  let authorization: string | null = null;
  try {
    authorization = (await headers()).get("authorization");
  } catch {
    authorization = null; // outside a request (jobs, scripts)
  }
  if (/^bearer\s/i.test(authorization ?? "")) {
    const { requireAuthenticatedUser } = await import("@/app/api/v1/_shared");
    const tokenUser = (await requireAuthenticatedUser()).user;
    return { supabase, snapshot: null, user: tokenUser, userId: tokenUser?.id ?? null, emailVerified: Boolean(tokenUser) };
  }
  const { snapshot, user } = await getAuthResolution(supabase);

  return {
    supabase,
    snapshot,
    user: user ?? null,
    userId: user?.id ?? null,
    emailVerified: snapshot?.emailVerified ?? false,
  };
});

/** The signed-in person, or (server jobs only) the person a job acts for (acting-as.ts). */
export const getViewerAuthContext = async (): Promise<ViewerAuthContext> => {
  const actingAs = actingAsUserId();
  if (!actingAs) return cachedViewerAuthContext();
  // No browser session here: anything that needs the Supabase client must not run inside a job.
  return { supabase: null as unknown as ViewerAuthContext["supabase"], snapshot: null, user: { id: actingAs } as User, userId: actingAs, emailVerified: true };
};

const cachedViewerProfileContext = cache(async (): Promise<ViewerProfileContext> => {
  const auth = await getViewerAuthContext();
  const profile = auth.userId ? await getUserProfile(auth.userId) : null;
  return {
    ...auth,
    profile,
  };
});

/**
 * Project pages only render the viewer's name and avatar. Avoid loading the
 * complete profile bootstrap record on their critical route path.
 */
export const getViewerProfileContext = async (): Promise<ViewerProfileContext> => {
  const actingAs = actingAsUserId();
  if (!actingAs) return cachedViewerProfileContext();
  return { ...(await getViewerAuthContext()), profile: await getUserProfile(actingAs) };
};

export const getViewerIdentityContext = cache(async (): Promise<ViewerIdentityContext> => {
  const auth = await getViewerAuthContext();
  if (!auth.userId) return { ...auth, profile: null };

  try {
    const [profile] = await db
      .select({
        username: profiles.username,
        fullName: profiles.fullName,
        avatarUrl: profiles.avatarUrl,
      })
      .from(profiles)
      .where(and(eq(profiles.id, auth.userId), isNull(profiles.deletedAt)))
      .limit(1);

    return { ...auth, profile: profile ?? null };
  } catch (error) {
    logger.error("[viewer.identity] failed to fetch project shell identity", {
      module: "viewer-context",
      userId: auth.userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ...auth, profile: null };
  }
});

/**
 * SEC-M6: project the server-only viewer context into the client-safe
 * `ClientViewer` shape. Callers that need to ship viewer data down to a
 * `"use client"` boundary MUST use this (or re-derive from its output)
 * instead of spreading the raw context — the raw context contains the
 * session id, raw app metadata, refresh artifacts, and a live Supabase
 * client that Next.js would happily attempt to serialize.
 *
 * The `aal` projection deliberately collapses unknown / null values to
 * `null` so a client check like `aal === 'aal2'` is never accidentally
 * satisfied by a malformed snapshot.
 */
export function toClientViewer(
  context: ViewerAuthContext | ViewerProfileContext | ViewerIdentityContext,
): ClientViewer {
  const profile = 'profile' in context ? context.profile : null;
  const rawAal = (context.snapshot as unknown as { aal?: unknown })?.aal;
  const aal = rawAal === 'aal2' ? 'aal2' : rawAal === 'aal1' ? 'aal1' : null;
  return {
    userId: context.userId,
    username: profile?.username ?? null,
    displayName: profile?.fullName ?? profile?.username ?? null,
    avatarUrl: profile?.avatarUrl ?? null,
    emailVerified: context.emailVerified,
    aal,
  };
}
