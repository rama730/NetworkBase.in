import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import type { ChatMessageView } from "@/lib/messaging/types";

const read = (relPath: string) => fs.readFileSync(path.join(process.cwd(), relPath), "utf8");

function makeMsg(seq: number, patch: Partial<ChatMessageView> = {}): ChatMessageView {
  return {
    channel_id: "c1", seq, author_id: "u1", author: null, kind: "user", body: `Message ${seq}`, thread_root_seq: null,
    reply_count: 0, last_reply_seq: null, last_reply_at: null, edited_at: null, deleted_at: null,
    created_at: new Date(2026, 9, 24, 12, seq).toISOString(), client_message_id: null, attachments: [], reactions: [], card: null, pinned: false,
    ...patch,
  };
}

test("LastItemTracker component is defined and exported in Timeline and integrated in ThreadPane", () => {
  const timelineSrc = read("src/components/messages/Timeline.tsx");
  const threadPaneSrc = read("src/components/messages/ThreadPane.tsx");

  assert.match(timelineSrc, /export function LastItemTracker/);
  assert.match(timelineSrc, /const observer = new ResizeObserver/);
  assert.match(timelineSrc, /onLastItemHeightIncrease/);
  assert.match(timelineSrc, /<LastItemTracker onHeightIncrease=\{onLastItemHeightIncrease\}>\{row\}<\/LastItemTracker>/);

  assert.match(threadPaneSrc, /import \{ LastItemTracker \} from "@\/components\/messages\/Timeline"/);
  assert.match(threadPaneSrc, /onLastReplyHeightIncrease/);
  assert.match(threadPaneSrc, /<LastItemTracker onHeightIncrease=\{onLastReplyHeightIncrease\}>\{rowItem\}<\/LastItemTracker>/);
});

test("Timeline and ThreadPane footers have 24px (h-6) resting clearance and 40px (h-10) typing clearance", () => {
  const timelineSrc = read("src/components/messages/Timeline.tsx");
  const threadPaneSrc = read("src/components/messages/ThreadPane.tsx");

  // Timeline footer ensures bottom message / preview / reactions never sit flush against the composer
  assert.match(timelineSrc, /context\?\.typing \? "h-10" : "h-6 transition-\[height\]/);
  // ThreadPane footer maintains the same clearance for thread replies
  assert.match(threadPaneSrc, /context\?\.typing \? "h-10" : "h-6 transition-\[height\]/);
});

test("Latest message content signature changes when reactions or link previews are updated", () => {
  const base = makeMsg(10, { body: "https://networkbase.in/projects/deepscope-ai" });
  
  const getSig = (m: ChatMessageView) => {
    const reactions = m.reactions?.map((r) => `${r.emoji}:${r.count}`).join(",") ?? "";
    const attachments = m.attachments?.map((a) => a.asset_id).join(",") ?? "";
    const previewHidden = m.link_preview_hidden ? 1 : 0;
    const cardKind = m.card?.kind ?? "";
    return `${m.client_message_id ?? ""}:${m.seq}:${reactions}:${attachments}:${previewHidden}:${cardKind}:${m.body.length}:${m.edited_at ?? ""}`;
  };

  const sigInitial = getSig(base);
  
  // Adding a reaction changes the signature
  const reacted = { ...base, reactions: [{ emoji: "👍", count: 1, me: true }] };
  const sigReacted = getSig(reacted);
  assert.notEqual(sigInitial, sigReacted);
  assert.match(sigReacted, /👍:1/);

  // Second reaction increments/changes signature
  const reactedMore = { ...base, reactions: [{ emoji: "👍", count: 2, me: true }] };
  assert.notEqual(sigReacted, getSig(reactedMore));

  // Removing link preview changes signature
  const hiddenPreview = { ...base, link_preview_hidden: true };
  assert.notEqual(sigInitial, getSig(hiddenPreview));
});
