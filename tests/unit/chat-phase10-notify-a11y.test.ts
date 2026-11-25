import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { formatChatTime, formatFileSize, needsAttention, notifyChoice, notifyChoices, notifyLabel, rowCount } from "@/lib/messaging/channel-view";
import type { ChatChannelSummary } from "@/lib/messaging/types";

const read = (path: string) => fs.readFileSync(path, "utf8");

function channel(patch: Partial<ChatChannelSummary> = {}): ChatChannelSummary {
  return {
    id: "c", kind: "public", name: "design", topic: null, project_id: "p1", application_id: null, is_default: false,
    last_seq: 0, last_top_seq: 0, last_read_seq: 0, mention_count: 0, notify: "all", starred: false,
    archived_at: null, channel_archived_at: null, last_message_at: null, last_preview: null, last_author_id: null,
    member_count: 2, role: "member", dm_user: null, members_preview: null, ...patch,
  };
}

test("#152 project channels offer Mentions and threads or Mute; DMs and groups keep All", () => {
  const projectChannel = channel();
  assert.deepEqual(notifyChoices(projectChannel).map((c) => c.value), ["mentions", "mute"]);
  assert.equal(notifyChoice(projectChannel, "all"), "mentions", "all behaves as mentions in channels");
  assert.equal(notifyLabel(projectChannel, "all"), "Mentions and threads");
  const dm = channel({ kind: "dm", name: null, project_id: null });
  const group = channel({ kind: "private", name: null, project_id: null });
  // Round 2 #194: a 1:1 DM has no @mentions to wait for, so it's All or Mute.
  assert.deepEqual(notifyChoices(dm).map((c) => c.value), ["all", "mute"]);
  assert.deepEqual(notifyChoices(group).map((c) => c.value), ["all", "mentions", "mute"]);
  assert.equal(notifyChoice(dm, "all"), "all");
  assert.match(read("src/components/messages/ConversationView.tsx"), /notifyChoices\(channel\)\.map/);
});

test("#157 muted conversations still show their mentions", () => {
  const muted = channel({ notify: "mute", mention_count: 2, last_top_seq: 5 });
  assert.equal(rowCount(muted), 2);
  assert.equal(needsAttention(muted), true);
  assert.equal(needsAttention(channel({ notify: "mute", last_top_seq: 5 })), false, "muted unread without mentions stays quiet");
});

test("#153 #158-161 badge, tab title, push title, nav labels", () => {
  assert.match(read("src/components/messages/ChatShellProvider.tsx"), /useDocumentTitlePrefix\(badge \?/);
  const hook = read("src/hooks/useDocumentTitlePrefix.ts");
  assert.match(hook, /MutationObserver/);
  assert.match(hook, /includes\(mark\)/, "stacked prefixes don't fight");
  assert.match(read("src/lib/messaging/send.ts"), /coalesce\(title, 'a group chat'\)/);
  assert.match(read("src/lib/messaging/publish.ts"), /`\$\{authorName\} in \$\{input\.channelLabel\}`/);
  assert.match(read("src/components/layout/header/TopNav.tsx"), /mobile-menu-chat-dot/);
  const nav = read("src/components/layout/AppSidebar.tsx");
  assert.match(nav, /aria-label=\{`\$\{label\}\$\{countLabel\}`\}/);
  assert.doesNotMatch(nav, /unread items/);
});

test("#154 service worker: no push for the open conversation; clicks route in-app", () => {
  const sw = read("public/sw.js");
  assert.match(sw, /client\.focused && client\.visibilityState === "visible"/);
  assert.match(sw, /askToNavigate\(client/);
  assert.match(read("src/components/messages/ChatShellProvider.tsx"), /"nb:navigate"[\s\S]*?router\.push\(path\)[\s\S]*?ports\[0\]\?\.postMessage/);
});

test("#155 #156 settings say what quiet hours and desktop notifications really do", () => {
  const settings = read("src/components/settings/NotificationsSettings.tsx");
  assert.doesNotMatch(settings, /Delivery is delayed/);
  assert.match(settings, /messages don’t send push alerts/);
  assert.match(settings, /While NetworkBase is open in this browser/);
});

test("#162 #164 #165 errors with Retry, one list skeleton, a Messages error boundary", () => {
  const views = read("src/components/messages/MessagesViews.tsx");
  for (const what of ["Inbox", "Threads", "Saved messages", "Scheduled messages", "Search results"]) {
    assert.match(views, new RegExp(`<ListError what="${what}"`), what);
  }
  assert.doesNotMatch(views, /return result\.success \? result\.(items|threads) : \[\]/);
  // One error look and phrase everywhere (round 3 #160): the shared ErrorNotice.
  assert.match(read("src/components/messages/HomePane.tsx"), /<ErrorNotice what="Your conversations"/);
  assert.match(read("src/components/ui/ErrorNotice.tsx"), /couldn’t load/);
  for (const page of ["inbox", "saved", "drafts", "search"]) {
    assert.match(read(`src/app/(site)/(main)/messages/(lists)/${page}/page.tsx`), /<Suspense fallback=\{<ListSkeleton/);
  }
  assert.match(read("src/app/(site)/(main)/messages/(lists)/loading.tsx"), /<ListSkeleton/);
  assert.match(read("src/app/(site)/(main)/messages/error.tsx"), /reset/);
});

test("#163 ⌘/ opens the shortcuts dialog", () => {
  assert.match(read("src/components/messages/MessagesChrome.tsx"), /e\.key === "\/"[\s\S]*?setShortcutsOpen\(true\)/);
  assert.match(read("src/components/messages/ShortcutsDialog.tsx"), /Keyboard shortcuts/);
});

test("#166 #167 #170 #171 timeline: older-page Retry, connection banner, quiet log, keyboard date picker", () => {
  const timeline = read("src/components/messages/Timeline.tsx");
  assert.match(timeline, /Earlier messages couldn’t load/);
  assert.match(timeline, /role="log"\s+aria-live="off"/);
  assert.match(timeline, /<p className="sr-only" aria-live="polite">\{announcement\}<\/p>/);
  assert.match(timeline, /typeof field\.showPicker === "function"/);
  assert.doesNotMatch(timeline, /toISOString\(\)\.slice\(0, 10\)/, "today is local, not UTC");
  assert.match(read("src/components/messages/ConversationView.tsx"), /<ConnectionBanner status=\{conversation\.status\} \/>/);
});

test("#168 #169 rows read their own content; ARIA for switcher, mentions, tabs, section headings", () => {
  const sections = read("src/components/messages/ChatSections.tsx");
  assert.doesNotMatch(sections, /"aria-label": label/);
  // Messages mix: the heading no longer stretches; the mono row count and the rule fill the line.
  assert.match(sections, /<h2 className="flex min-w-0 shrink">/);
  // Unread is said in words inside the row (", unread"), the dot is decoration (round 3 #86, #124).
  assert.match(read("src/components/messages/MessagesViews.tsx"), /<span className="sr-only">, unread<\/span>/);
  const switcher = read("src/components/messages/QuickSwitcher.tsx");
  assert.match(switcher, /aria-expanded=\{results\.length > 0\}/);
  assert.match(switcher, /role="group" aria-labelledby/);
  const mention = read("src/components/messages/parts/MentionDropdown.tsx");
  assert.match(mention, /role="listbox"/);
  assert.match(mention, /aria-activedescendant/);
  const tabs = read("src/components/messages/ChannelTabBar.tsx");
  // The shared tablist keys (keys.ts rovingTabKey), not a copy (round 3 #70).
  assert.match(tabs, /rovingTabKey\(e, /);
  assert.match(read("src/components/messages/keys.ts"), /e(vent)?\.key === "Home" \? 0 : e(vent)?\.key === "End"/);
  assert.match(tabs, /aria-controls="conversation-tabpanel"/);
});

test("#171 theme token and report dialog", () => {
  // Round 3 #118-#119: no chat-only orange. Counts are the app nav's neutral badge.
  const css = read("src/app/globals.css");
  assert.doesNotMatch(css, /--chat-accent/);
  assert.match(css, /\.nb-nav-count, \.nb-chat-count \{/);
  // Messages use the app-wide report dialog (docs/trust-and-safety-concept.md).
  const report = read("src/components/reports/ReportDialog.tsx");
  assert.match(report, /<DialogContent/);
  assert.doesNotMatch(report, /text-red-500|bg-red-500/);
});

test("#172 one time format for reminders and sends, one file size format", () => {
  const today = new Date();
  today.setHours(9, 5, 0, 0);
  assert.match(formatChatTime(today, "at"), /^Today /);
  const tomorrow = new Date(today.getTime() + 86_400_000);
  assert.match(formatChatTime(tomorrow, "at"), /^Tomorrow /);
  assert.equal(formatFileSize(820), "820 B");
  assert.equal(formatFileSize(14_540), "14.2 KB");
  assert.equal(formatFileSize(3_250_586), "3.1 MB");
  assert.doesNotMatch(read("src/components/messages/parts/FilesView.tsx"), /function size\(/);
  assert.doesNotMatch(read("src/components/messages/MessagesViews.tsx"), /toLocaleString\(undefined/);
});
