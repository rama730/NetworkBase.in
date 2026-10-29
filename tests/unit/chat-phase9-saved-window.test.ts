import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { localInput } from "@/components/messages/parts/TimePickerDialog";

const read = (path: string) => fs.readFileSync(path, "utf8");

test("one time picker: local datetime value for Schedule, Reschedule and reminders", () => {
  assert.equal(localInput(new Date(2026, 9, 4, 9, 5)), "2026-10-04T09:05");
  const composer = read("src/components/messages/Composer.tsx");
  const views = read("src/components/messages/MessagesViews.tsx");
  assert.match(composer, /<TimePickerDialog[\s\S]*?title="Schedule message"/);
  assert.doesNotMatch(composer, /type="datetime-local"/);
  assert.match(views, /title="Remind me"/);
  assert.match(views, /title="Reschedule message"/);
});

test("Saved: custom time, Clear reminder, due badge, one wording (#137-139)", () => {
  const views = read("src/components/messages/MessagesViews.tsx");
  assert.match(views, /Custom time…/);
  assert.match(views, /Clear reminder/);
  assert.match(read("src/app/actions/chat/later.ts"), /clearReminder/);
  assert.match(read("src/app/actions/chat/read.ts"), /saved_due/);
  assert.match(read("src/components/messages/ChatSections.tsx"), /<Count value=\{savedDue\} noun=/);
  const row = read("src/components/messages/MessageRow.tsx");
  assert.match(row, /saved \? "Remove from Saved" : "Save"/);
  for (const file of ["src/components/messages/MessageRow.tsx", "src/components/messages/MessagesViews.tsx", "src/components/messages/useConversation.ts"]) {
    assert.doesNotMatch(read(file), /Save for later|Saved for later|Marked done|Remove from saved/, `${file} uses the one wording`);
  }
});

test("Scheduled: Send now / Retry, Reschedule, loading, refresh after scheduling (#140-141)", () => {
  const views = read("src/components/messages/MessagesViews.tsx");
  assert.match(views, /item\.failed_reason \? "Retry" : "Send now"/);
  assert.match(views, /Reschedule…/);
  // Shown from loaded data only, so it never flashes a skeleton and vanishes (round 3 #48).
  assert.match(views, /const showScheduled = scheduled\.isError \|\| Boolean\(scheduled\.data/);
  const later = read("src/app/actions/chat/later.ts");
  assert.match(later, /export async function sendScheduledNow/);
  assert.match(later, /export async function rescheduleScheduled/);
  assert.match(later, /clientId: `scheduled:\$\{input\.id\}`/);
  assert.match(read("src/components/messages/Composer.tsx"), /invalidateQueries\(\{ queryKey: queryKeys\.chat\.scheduled\(\) \}\)/);
});

test("toast links navigate in-app; left drafts; search project label (#142-144)", () => {
  for (const file of ["src/components/messages/Composer.tsx", "src/components/messages/useConversation.ts"]) {
    assert.doesNotMatch(read(file), /window\.location\.assign/, `${file} navigates in-app`);
  }
  const views = read("src/components/messages/MessagesViews.tsx");
  assert.match(views, /left\(draft\.channelId\) \?[\s\S]*?Left conversation/);
  // The workspace travels with the place on every screen size (round 2 #78, #87).
  assert.match(views, /item\.project_title \? <span className="text-muted-foreground"> · \{item\.project_title\}/);
  assert.match(read("src/app/actions/chat/later.ts"), /p\.title AS project_title/);
  assert.match(read("src/app/actions/chat/search.ts"), /p\.title AS project_title/);
});

test("New message: listbox keys, Backspace removes a chip, cap explained (#145)", () => {
  const source = read("src/components/messages/NewMessage.tsx");
  assert.match(source, /role="combobox"/);
  assert.match(source, /aria-activedescendant=/);
  assert.match(source, /event\.key === "Backspace" && !query && to\.length/);
  assert.match(source, /A group chat holds up to/);
});

test("window: one header, Inbox inside, focus in and back, ⋯ menu, ⌘K (#147-151)", () => {
  const win = read("src/components/messages/ChatWindow.tsx");
  assert.match(win, /screen\.type === "list" \|\| screen\.type === "inbox" \|\| screen\.type === "channel" \? null/);
  assert.match(win, /<ListScreen[\s\S]*?actions=\{actions\} \/>/);
  assert.match(win, /<WindowNavContext\.Provider[\s\S]*?<InboxView \/>/);
  assert.match(win, /node\.focus\(\{ preventScroll: true \}\)/);
  assert.match(read("src/components/messages/ChatLauncher.tsx"), /onClose=\{\(\) => \{ close\(\); button\.current\?\.focus\(\); \}\}/);
  assert.match(read("src/components/messages/ChatSections.tsx"), /onInbox \? \(\s*<button type="button" onClick=\{onInbox\}/);
  assert.match(read("src/components/messages/ConversationView.tsx"), /surface === "window" \? \([\s\S]*?Open in Messages/);
  assert.match(read("src/components/layout/header/TopNav.tsx"), /document\.getElementById\("chat-window"\)/);
});
