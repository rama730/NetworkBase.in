import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

// Notifications mix (2026-11-27): the tray follows design spec §31 and the locked decisions — My reviews folds into
// Unread as Needs you, the bell's number is the Needs you count, Done replaces Dismiss, rows answer in place.
const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf-8");

test("tray geometry follows spec §31: 400px popover, 12px radius, lg shadow, 17px header, 34px squares, 13px text, 12px mono", () => {
    const css = read("src/components/notifications/notifications.css");
    const tray = read("src/components/layout/header/NotificationPreview.tsx");
    assert.match(css, /\.nb-nt-panel \{ width: min\(400px, calc\(100vw - 24px\)\); border-radius: 12px; box-shadow: 0 18px 44px -16px rgba\(13, 17, 20, \.26\); \}/);
    assert.match(css, /\.nb-nt-tile \{ display: grid; place-items: center; width: 34px; height: 34px; border-radius: 5px;/);
    assert.match(css, /\.nb-nt-tile svg \{ width: 14px; height: 14px; \}/);
    assert.match(tray, /<h2 className="nb-card-title">/);
    assert.match(read("src/components/notifications/NotificationRow.tsx"), /className="nb-nt-t1 nb-compact"/);
    assert.match(read("src/components/notifications/NotificationList.tsx"), /<span className="nb-micro"><b>\{text\}<\/b><\/span>/);
});

test("two underlined tabs, Unread and All; My reviews is gone and its reviews live in Needs you", () => {
    const tray = read("src/components/layout/header/NotificationPreview.tsx");
    assert.match(tray, /\(\["unread", "all"\] as const\)/);
    assert.match(tray, /<TabMarker overlap \/>/);
    assert.doesNotMatch(tray, /My reviews|MyReviewsList|nb-seg/);
    assert.equal(existsSync("src/components/notifications/MyReviewsList.tsx"), false);
    assert.match(read("src/lib/notifications/needs-you.ts"), /FROM merge_request_reviews r/);
    assert.match(read("src/lib/notifications/types.ts"), /export type NotificationTrayFilter = "unread" \| "all";/);
});

test("the bell's number is the Needs you count; a dot means new with nothing waiting", () => {
    const tray = read("src/components/layout/header/NotificationPreview.tsx");
    assert.match(tray, /\{needsCount > 0 \? \(\s*<span key=\{needsCount\} data-settle=\{badgeChanged \|\| undefined\} className="nb-topbar-badge">/);
    assert.match(tray, /n\.unreadCount > 0 \? <span className="nb-topbar-badge nb-topbar-badge--dot" \/>/);
});

test("Done replaces Dismiss, with Undo; rows never show the old orange placeholder", () => {
    const row = read("src/components/notifications/NotificationRow.tsx");
    const hook = read("src/hooks/useNotifications.ts");
    assert.match(row, /aria-label="Done"/);
    assert.doesNotMatch(row, />Dismiss</);
    assert.match(hook, /toast\.success\("Marked done\.", \{\s*action: \{ label: "Undo"/);
    assert.match(read("src/components/notifications/NotificationGlyph.tsx"), /<span className="nb-nt-tile" data-tone=\{tone\}><GlyphIcon glyph=\{glyph\} \/><\/span>/);
});

test("answers in the row call one dispatcher; the push service worker uses the same route", () => {
    assert.match(read("src/components/notifications/NeedsYouRow.tsx"), /onAct\(item, \{ \.\.\.act, questionKey: item\.questionKey \}\)/);
    assert.match(read("src/hooks/useNotifications.ts"), /actOnNotificationAction\(\{ key: item\.key/);
    assert.match(read("public/sw.js"), /"\/api\/v1\/notifications\/" \+ encodeURIComponent\(id\) \+ "\/act"/);
});

test("the notifications page sits on Network's frame: page title, underlined tabs with mono counts, 256px search, Filters, rail", () => {
    const page = read("src/components/notifications/NotificationsPageClient.tsx");
    assert.match(read("src/app/(site)/(main)/notifications/page.tsx"), /redirect\(`\/login\?next=\$\{encodeURIComponent\("\/notifications"\)\}`\)/);
    assert.match(page, /<h1 className="nb-page-title">Notifications<\/h1>/);
    assert.match(page, /max-w-\[1240px\]/);
    assert.match(page, /className="nb-network-rail sticky self-start space-y-4"/);
    assert.match(page, /<SearchField value=\{value\} onChange=\{setValue\} label="Search notifications" className="w-64 max-w-full" \/>/);
    assert.match(page, /<TabMarker overlap \/>/);
    assert.match(page, /<RailSection title="Quiet right now">/);
    assert.match(read("src/components/layout/header/NotificationPreview.tsx"), /<Link href="\/notifications"/);
});

test("push: Needs you kinds carry their answer, and hidden message text hides the sentence", () => {
    const push = read("src/lib/notifications/web-push.ts");
    assert.match(push, /if \(item\.kind === "connection_request_received"\) return \[\{ action: "accept", title: "Accept" \}, \{ action: "open", title: "Open" \}\];/);
    assert.match(push, /if \(item\.kind === "agent_access_request"\) return \[\{ action: "allow", title: "Allow once" \}/);
    assert.match(push, /Object\.assign\(payload, \{ title: "Something needs you", body: "" \}\)/);
    assert.match(read("public/sw.js"), /if \(await answerFromPush\(data\.id, act\)\) return;\s*\/\/ It didn't go through/);
});
