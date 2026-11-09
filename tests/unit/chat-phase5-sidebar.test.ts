import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { MARK_ALL_LABEL, needsMarkAllConfirm, sectionsFor, swipeButtons } from "@/lib/messaging/channel-view";
import type { ChatBootstrap, ChatChannelSummary } from "@/lib/messaging/types";
import { canGoBackInApp, noteTransition, resetInAppHistory, stampEntry, type WinLike } from "@/lib/navigation/in-app-history";

const read = (path: string) => fs.readFileSync(path, "utf8");

function channel(id: string, patch: Partial<ChatChannelSummary> = {}): ChatChannelSummary {
  return {
    id, kind: "public", name: id, topic: null, project_id: "p1", application_id: null, is_default: false,
    last_seq: 1, last_top_seq: 1, last_read_seq: 1, mention_count: 0, notify: "all", starred: false,
    archived_at: null, channel_archived_at: null, last_message_at: null, last_preview: null, last_author_id: null,
    member_count: 2, role: "member", dm_user: null, members_preview: null, ...patch,
  };
}
const data: ChatBootstrap = {
  server_time: "", activity_latest_at: null, inbox_unread: 0,
  projects: [{ id: "p1", title: "One", slug: null, cover_image: null, role: "member" }, { id: "p2", title: "Two", slug: null, cover_image: null, role: "member" }],
  channels: [
    channel("design", { starred: true }),
    channel("other", { project_id: "p2", starred: true }),
    channel("dm", { kind: "dm", name: null, project_id: null, starred: true }),
    channel("plain"),
  ],
};

test("Starred follows the open project (DMs always) and isn't repeated below", () => {
  const open = sectionsFor(data, "p1");
  assert.deepEqual(open.starred.map((c) => c.id).sort(), ["design", "dm"]);
  assert.deepEqual(open.channels.map((c) => c.id), ["plain"]);
  assert.deepEqual(open.dms, []);
  assert.deepEqual(sectionsFor(data, null).starred.map((c) => c.id).sort(), ["design", "dm", "other"]);
});

test("swipe: Read only when unread; DMs Close (not Archive), channels Star", () => {
  assert.deepEqual(swipeButtons({ unread: true, muted: false, direct: true, starred: false }), ["Read", "Mute", "Close"]);
  assert.deepEqual(swipeButtons({ unread: false, muted: true, direct: false, starred: true }), ["Unmute", "Unstar"]);
});

test("mark all as read: one label, asks first above 5", () => {
  assert.equal(MARK_ALL_LABEL, "Mark all as read");
  assert.equal(needsMarkAllConfirm(5), false);
  assert.equal(needsMarkAllConfirm(6), true);
  for (const file of ["src/components/messages/ChatSections.tsx", "src/components/messages/HomePane.tsx", "src/components/messages/MessagesViews.tsx", "src/components/messages/MessagesChrome.tsx"]) {
    assert.match(read(file), /useMarkAllRead\(\)/, `${file} uses the shared mark-all pattern`);
    assert.doesNotMatch(read(file), /Mark all read|Mark everything here as read/, `${file} uses the shared label`);
  }
});

test("in-app Back: a deep link has nothing behind it; browser back steps down", () => {
  resetInAppHistory();
  const entries: { url: string; state: any }[] = [{ url: "/messages/inbox", state: null }];
  let index = 0;
  const win = {
    get location() { const u = new URL(entries[index].url, "https://nb.test"); return { pathname: u.pathname, search: u.search, href: u.href }; },
    history: {
      get state() { return entries[index].state; },
      get length() { return entries.length; },
      replaceState(state: any) { entries[index] = { ...entries[index], state }; },
    },
  } as WinLike;
  stampEntry(win);
  stampEntry(win); // effect re-run
  assert.equal(canGoBackInApp(), false, "deep link");
  noteTransition("push");
  entries.push({ url: "/messages/saved", state: null });
  index = 1;
  stampEntry(win);
  assert.equal(canGoBackInApp(), true);
  noteTransition("traverse");
  index = 0;
  stampEntry(win);
  assert.equal(canGoBackInApp(), false, "back at the landing page");
  assert.match(read("src/hooks/useBack.ts"), /canGoBackInApp\(\) \? |if \(canGoBackInApp\(\)\)/);
  assert.doesNotMatch(read("src/hooks/useBack.ts"), /history\.length/);
});

test("sidebar: Search row, Unreads toggle, one-click +, focus-visible controls", () => {
  const sections = read("src/components/messages/ChatSections.tsx");
  // The floating window keeps "Jump to…"; the page drops it (the top bar's search is the same ⌘K finder),
  // and Keyboard shortcuts moves into the sidebar's ⋯.
  assert.equal(sections.match(/<span className="flex-1">Jump to…<\/span>/g)?.length, 1);
  assert.match(sections, /setShortcutsOpen\(true\)\}>\s*<Keyboard \/> Keyboard shortcuts/);
  assert.match(read("src/components/messages/QuickSwitcher.tsx"), /"Search messages…"/);
  assert.match(sections, /label="Create channel" onClick=\{\(\) => setCreateFor\(id\)\}/);
  assert.match(sections, /Browse channels/);
  assert.match(sections, /group-focus-within\/row:opacity-100/);
  assert.match(sections, /pointer-fine:group-focus-within\/section:opacity-100/);
  assert.match(sections, /title="Direct messages"\s*count=\{dmUnread\}\s*noun="unread conversations"/);
  assert.match(read("src/app/globals.css"), /\.nb-chat-hover:hover > \.nb-chat-row/);
  // The header shows a star only when starred (no empty hover slot); starring lives in ⋯.
  const view = read("src/components/messages/ConversationView.tsx");
  assert.match(view, /\{isMember && channel\.starred \? \(\s*<button type="button" onClick=\{\(\) => void setState\(\{ starred: false \}\)\}/);
  assert.match(view, /<DropdownMenuItem onSelect=\{\(\) => void setState\(\{ starred: !channel\.starred \}\)\}><Star \/> \{starLabel\}/);
});

test("lists: desktop close, Browse join state, switcher search and loading, DM link errors", () => {
  assert.match(read("src/components/messages/ViewScreen.tsx"), /closable \?/);
  const views = read("src/components/messages/MessagesViews.tsx");
  assert.match(views, /joining === channel\.id \? "Joining…" : "Join"/);
  assert.doesNotMatch(views, /hidden min-h-11 items-center rounded-\[5px\] px-3 text-\[13px\] text-muted-foreground hover:text-foreground sm:inline-flex/);
  const switcher = read("src/components/messages/QuickSwitcher.tsx");
  assert.match(switcher, /searchChannels\(\{ query: channelNeedle \}\)/);
  assert.doesNotMatch(switcher, /BROWSE_PROJECTS/);
  assert.match(switcher, /event\.metaKey \|\| event\.ctrlKey/);
  assert.match(switcher, /scrollIntoView\(\{ block: "nearest" \}\)/);
  assert.match(read("src/components/messages/CreateChannelDialog.tsx"), /<DialogTitle>Create channel<\/DialogTitle>/);
  assert.match(read("src/components/messages/MessagesIndex.tsx"), /toast\.error\(chatErrorMessage\(dmError\)\)/);
});
