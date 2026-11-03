import { readCalendarEntries, toIcs, userForCalendarToken } from "@/lib/calendar/feed";
import { shareOrigin } from "@/lib/sharing/presentation";

// Calendar (report §33.5): the private link Google or Apple Calendar subscribes to. The token is the only key, so a
// wrong or reset one gets 404 and the body never says why.
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const token = decodeURIComponent((await params).token).replace(/\.ics$/, "");
  const userId = await userForCalendarToken(token);
  if (!userId) return new Response("Not found", { status: 404, headers: { "Cache-Control": "private, no-store" } });
  const body = toIcs(await readCalendarEntries(userId), shareOrigin());
  return new Response(body, { status: 200, headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" } });
}
