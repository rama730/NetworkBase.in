import { enforceRouteLimit, jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { parseSearchInput } from "@/lib/search/global/parse";
import { searchPeopleCards } from "@/lib/search/global/people-cards";

/** The results page's People tab: Network's person cards for the words, with the global search's privacy rule. */
export async function GET(request: Request) {
  const auth = await requireAuthenticatedUser();
  if (auth.response || !auth.user) return auth.response ?? jsonError("Sign in to continue", 401, "UNAUTHORIZED");
  const limited = await enforceRouteLimit(request, "api:v1:search:people", 120, 60, "signedInRead", auth.user.id);
  if (limited) return limited;
  const raw = new URL(request.url).searchParams.get("q") ?? "";
  if (raw.length > 100) return jsonError("Search words are at most 100 characters", 400, "BAD_REQUEST");
  const { text } = parseSearchInput(raw);
  const people = text.length >= 2 ? await searchPeopleCards(auth.user.id, text) : [];
  return jsonSuccess({ people }, undefined, { headers: { "Cache-Control": "private, no-store" } });
}
