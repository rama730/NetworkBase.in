import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { chatDraftToHtmlish } from "@/components/messages/ChatEditor";
import { applyMentionCount } from "@/lib/messaging/shell-state";
import { pollBody, pollOptions } from "@/lib/messaging/poll";
import { buildTimeline, keepLocalPreviews } from "@/lib/messaging/timeline";
import { encodeMentions, previewText, tokensToPlainText } from "@/lib/messaging/tokens";
import type { ChatBootstrap, ChatMessageView } from "@/lib/messaging/types";
import { DEFAULT_NOTIFICATION_PREFERENCES, getQuietHoursResumeAt, isQuietHoursActive } from "@/lib/notifications/preferences";

const ANN = "11111111-1111-1111-1111-111111111111";
const CHAN = "22222222-2222-2222-2222-222222222222";
const ann = [{ id: ANN, name: "Ann Lee" }];

test("#180 #181 mentions: never inside code, broadcasts only where allowed", () => {
  assert.equal(encodeMentions("hi @Ann Lee", ann), `hi <@${ANN}>`);
  assert.equal(encodeMentions("log: `@channel` and @Ann Lee", ann), `log: \`@channel\` and <@${ANN}>`);
  assert.equal(encodeMentions("```\n@channel @Ann Lee\n```", ann), "```\n@channel @Ann Lee\n```");
  assert.equal(encodeMentions("@here look", ann), "<!here> look");
  assert.equal(encodeMentions("@here look", ann, { broadcast: false }), "@here look");
});

test("#23 #227 plain text and previews: real channel names, no markdown marks", () => {
  assert.equal(tokensToPlainText(`in <#${CHAN}>`, () => undefined, () => "design"), "in #design");
  assert.equal(previewText("**Hi** <https://x.co> [docs](https://d.co) `code`"), "Hi https://x.co docs code");
  assert.equal(previewText("# Title\n> quoted"), "Title\nquoted");
});

test("#178 drafts keep their autolinks as links (no literal angle brackets)", () => {
  const html = chatDraftToHtmlish("see <https://x.co> and a<b", () => "");
  assert.match(html, /<https:\/\/x\.co>/);
  assert.match(html, /a&lt;b/);
});

test("#16 #204 poll chips come from the body: every option, nothing seeded", () => {
  const body = pollBody("/poll Lunch? | Pizza | Tacos")!;
  assert.deepEqual(pollOptions(body), ["1️⃣", "2️⃣"]);
  assert.deepEqual(pollOptions(pollBody("/poll Ship it?")!), ["👍", "👎", "🤷"]);
  assert.equal(pollBody("/poll"), null);
  assert.deepEqual(pollOptions("1️⃣ not a poll"), []);
});

test("#71 quiet hours run on the user's clock, and resume at its end", () => {
  const prefs = { ...DEFAULT_NOTIFICATION_PREFERENCES, quietHours: { enabled: true, startMinute: 22 * 60, endMinute: 7 * 60, timeZone: "America/Los_Angeles" } };
  // 06:00 UTC is 23:00 (PDT) or 22:00 (PST) the evening before in Los Angeles: quiet.
  const night = new Date("2026-10-06T06:00:00Z");
  assert.equal(isQuietHoursActive(prefs, night), true);
  // 20:00 UTC is lunchtime there: not quiet, whatever the server's own zone.
  assert.equal(isQuietHoursActive(prefs, new Date("2026-10-06T20:00:00Z")), false);
  // 07:00 PDT is 14:00 UTC.
  assert.equal(getQuietHoursResumeAt(prefs, night)?.toISOString(), "2026-10-06T14:00:00.000Z");
  // A saved zone wins over the browser's last-known one.
  assert.equal(isQuietHoursActive(prefs, night, "Asia/Kolkata"), true);
});

function message(seq: number, patch: Partial<ChatMessageView> = {}): ChatMessageView {
  return {
    channel_id: CHAN, seq, author_id: ANN, author: null, kind: "user", body: `m${seq}`, thread_root_seq: null, reply_count: 0,
    last_reply_seq: null, last_reply_at: null, edited_at: null, deleted_at: null, created_at: "2026-10-06T10:00:00Z",
    client_message_id: null, attachments: [], reactions: [], card: null, pinned: false, ...patch,
  };
}

test("#254 a deleted message with no replies leaves the timeline; one with replies keeps its line", () => {
  const items = buildTimeline([message(1), message(2, { deleted_at: "x" }), message(3, { deleted_at: "x", reply_count: 2 })], { lastReadSeq: 9, meId: ANN });
  const seqs = items.flatMap((item) => (item.type === "message" ? [item.message.seq] : []));
  assert.deepEqual(seqs, [1, 3]);
});

test("#110 the server copy of a sent photo keeps the on-device preview (no flash)", () => {
  const file = { idx: 0, asset_id: "a1", name: "p.jpg", mime: "image/jpeg", size: 1, width: null, height: null };
  const optimistic = message(-1, { attachments: [{ ...file, local_url: "blob:x", width: 40, height: 30 }] });
  const kept = keepLocalPreviews(message(5, { attachments: [file] }), optimistic);
  assert.equal(kept.attachments[0]!.local_url, "blob:x");
  assert.equal(kept.attachments[0]!.width, 40);
});

test("#7 a thread read's recounted @ count reaches the sidebar row", () => {
  const data = { server_time: "", activity_latest_at: null, channels: [{ id: CHAN, mention_count: 2 }], projects: [] } as unknown as ChatBootstrap;
  assert.equal(applyMentionCount(data, CHAN, 0).channels[0]!.mention_count, 0);
  assert.equal(applyMentionCount(data, CHAN, 2), data);
});

test("#259 emoji: :shortcode: and search by name", async () => {
  const { emojiForShortcode, searchEmoji } = await import("@/lib/messaging/emoji");
  assert.equal(emojiForShortcode("tada"), "🎉");
  assert.equal(emojiForShortcode("+1"), "👍");
  assert.equal(emojiForShortcode("nope_not_one"), null);
  assert.equal(searchEmoji("thu")[0]?.emoji, "👍");
  assert.deepEqual(searchEmoji(""), []);
});

test("#262 chat push choices default on and survive older saved preferences", async () => {
  const { normalizeNotificationPreferences } = await import("@/lib/notifications/preferences");
  assert.deepEqual(normalizeNotificationPreferences({}).chat, { threadReplies: true, showPreview: true });
  assert.deepEqual(normalizeNotificationPreferences({ chat: { threadReplies: false } }).chat, { threadReplies: false, showPreview: true });
});

const src = (path: string) => fs.readFileSync(path, "utf8");

test("round 4: Latest sits between list and composer, statuses beside names, spec person card", () => {
  // The jump-to-latest control is a bar in the layout, never floating over messages.
  for (const file of ["src/components/messages/Timeline.tsx", "src/components/messages/ThreadPane.tsx"]) {
    assert.match(src(file), /<LatestBar /, file);
    assert.doesNotMatch(src(file), /absolute bottom-3 right-4/, file);
  }
  const row = src("src/components/messages/MessageRow.tsx");
  assert.match(row, /usePersonPresence\(grouped \? null : message\.author\?\.id\)/);
  assert.match(row, /authorPresence\.status\?\.emoji \|\| "💬"/);
  const card = src("src/components/presence/PersonHoverCard.tsx");
  // Controls round 2: the card is a small profile band (56 px picture, serif name, stat cells for what you share).
  assert.match(card, /size=\{56\}/);
  assert.match(card, /nb-hcard-name/);
  assert.doesNotMatch(card, /rounded-md bg-muted/);
  // Headline and location only for public profiles, yourself, or a shared project.
  assert.match(src("src/app/actions/chat/members.ts"), /profile\?\.visibility === "public" \|\| input\.userId === user\.id \|\| sharedProjects\.length > 0/);
});
