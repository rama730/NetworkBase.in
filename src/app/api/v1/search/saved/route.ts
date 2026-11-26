import { z } from "zod";

import { enforceRouteLimit, jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { validateCsrf } from "@/lib/security/csrf";
import { trendingNear } from "@/lib/search/global/extras";
import { deleteSavedSearch, listSavedSearches, markSavedSeen, saveSearch, setSavedNotify } from "@/lib/search/global/saved";

const NOTIFY = z.enum(["weekly", "daily", "off"]);
const SAVE = z.object({
  query: z.string().trim().min(1).max(100),
  tab: z.enum(["discover", "people", "msgs", "goto"]).default("discover"),
  filters: z.record(z.string(), z.union([z.string(), z.boolean(), z.number(), z.array(z.string())])).default({}),
  notify: NOTIFY.default("weekly"),
});
const PATCH_BODY = z.object({ id: z.string().uuid(), notify: NOTIFY.optional(), seen: z.literal(true).optional() });

async function signedIn(request: Request, key: string) {
  const auth = await requireAuthenticatedUser();
  if (auth.response || !auth.user) return { error: auth.response ?? jsonError("Sign in to continue", 401, "UNAUTHORIZED") };
  const limited = await enforceRouteLimit(request, key, 60, 60, "signedInRead", auth.user.id);
  return limited ? { error: limited } : { userId: auth.user.id };
}

/** The empty box: your saved searches with what's new, and what people near you search this week. */
export async function GET(request: Request) {
  const who = await signedIn(request, "api:v1:search:saved:get");
  if ("error" in who) return who.error;
  const [saved, trending] = await Promise.all([listSavedSearches(who.userId), trendingNear(who.userId).catch(() => [])]);
  return jsonSuccess({ saved, trending }, undefined, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  const csrf = validateCsrf(request);
  if (csrf) return csrf;
  const who = await signedIn(request, "api:v1:search:saved:write");
  if ("error" in who) return who.error;
  const body = SAVE.safeParse(await request.json().catch(() => null));
  if (!body.success) return jsonError("Couldn’t save that search", 400, "BAD_REQUEST");
  const result = await saveSearch(who.userId, body.data);
  return result.ok ? jsonSuccess({ id: result.id }) : jsonError(result.error, 409, "CONFLICT");
}

export async function PATCH(request: Request) {
  const csrf = validateCsrf(request);
  if (csrf) return csrf;
  const who = await signedIn(request, "api:v1:search:saved:write");
  if ("error" in who) return who.error;
  const body = PATCH_BODY.safeParse(await request.json().catch(() => null));
  if (!body.success || (!body.data.notify && !body.data.seen)) return jsonError("Nothing to change", 400, "BAD_REQUEST");
  const done = body.data.notify ? await setSavedNotify(who.userId, body.data.id, body.data.notify) : await markSavedSeen(who.userId, body.data.id);
  return done ? jsonSuccess({ id: body.data.id }) : jsonError("That saved search isn’t yours or is gone", 404, "NOT_FOUND");
}

export async function DELETE(request: Request) {
  const csrf = validateCsrf(request);
  if (csrf) return csrf;
  const who = await signedIn(request, "api:v1:search:saved:write");
  if ("error" in who) return who.error;
  const id = new URL(request.url).searchParams.get("id") ?? "";
  return (await deleteSavedSearch(who.userId, id)) ? jsonSuccess({ id }) : jsonError("That saved search isn’t yours or is gone", 404, "NOT_FOUND");
}
