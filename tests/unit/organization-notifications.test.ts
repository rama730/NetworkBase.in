import assert from "node:assert/strict";
import { test } from "node:test";

import type { OrgEmailKind } from "@/lib/email/contracts";
import { ALWAYS_SENT_EMAILS, buildOrgEmail, formatEmailWhen, orgMuteToken, readOrgMuteToken, type OrgEmailData } from "@/lib/email/org-templates";
import { getVisibleProjectNotificationEntries, groupProjectNotificationEntries } from "@/lib/notifications/project-policy";
import { DEFAULT_NOTIFICATION_PREFERENCES, normalizeNotificationPreferences, orgChoiceBlocks } from "@/lib/notifications/preferences";
import { notificationMatchesMuteScope } from "@/lib/notifications/presentation";
import { digestIsEmpty, localClock, nextDate } from "@/lib/organizations/notify-rules";

process.env.APP_URL = "https://networkbase.in";
const ORG = "11111111-1111-4111-8111-111111111111";
const base: OrgEmailData = {
  org: { id: ORG, title: "CSE-3A 2026", slug: "cse3a", type: "education", logoUrl: null, tagline: "Compilers, fall term" },
  actor: { id: "a", name: "Ms. Rao", username: "mrao", headline: "Teacher" },
  timeZone: "Asia/Kolkata", orgTimeZone: "Asia/Kolkata",
};
const due = "2026-10-31T18:29:00.000Z"; // Sat 31 Oct, 11:59 PM in Kolkata

const cases: Record<OrgEmailKind, { data: Partial<OrgEmailData>; subject: string | RegExp }> = {
  org_ready: { data: { joinCode: "K7M2QX" }, subject: "CSE-3A 2026 is ready: invite your members" },
  org_invite: { data: { role: "Member", memberTitle: "TA" }, subject: "Ms. Rao invited you to CSE-3A 2026" },
  org_invite_signup: { data: { role: "Member" }, subject: "Ms. Rao invited you to CSE-3A 2026 on NetworkBase" },
  org_welcome: { data: { note: "Welcome, everyone!" }, subject: "You're in CSE-3A 2026" },
  org_assignment: { data: { assignment: { title: "Lab 2", dueAt: due, steps: ["Read notes"], materials: [{ name: "notes.pdf", size: 1_200_000 }], team: ["Ravi", "Asha"], teamName: "Team A", reviewRequired: true, submission: "file" } }, subject: "New assignment: Lab 2 · due Sat 31 Oct, 11:59 PM" },
  org_due_soon: { data: { items: [{ title: "Lab 2", dueAt: due, status: "Not started" }, { title: "Quiz 1", dueAt: due, status: "In progress" }] }, subject: "2 assignments due tomorrow in CSE-3A 2026" },
  org_overdue: { data: { assignment: { title: "Lab 2", dueAt: due, lateUntil: "2026-11-03T18:29:00.000Z" } }, subject: /^Lab 2 is overdue: late work accepted until / },
  org_returned: { data: { reason: "add the test cases", assignment: { title: "Lab 2", version: 2 } }, subject: "Lab 2 was returned: add the test cases" },
  org_announcement: { data: { post: { id: "p1", content: "Midterm moved to Nov 10" } }, subject: "CSE-3A 2026: Midterm moved to Nov 10" },
  org_ended: { data: {}, subject: "CSE-3A 2026 has ended" },
  org_digest: { data: { digest: { toReview: [{ title: "Lab 1", count: 18 }], joinRequests: 2, needsYou: [], behind: 3 } }, subject: "CSE-3A 2026 today: 18 submissions, 2 join requests" },
  org_removed: { data: { reason: "Left the course" }, subject: "You were removed from CSE-3A 2026" },
  org_ownership: { data: {}, subject: "You're now the owner of CSE-3A 2026" },
  org_deleted: { data: { personalProjects: ["Compiler Lab"] }, subject: "CSE-3A 2026 was deleted" },
};

test("every org email (E1–E14) has its subject, a preview, plain text and the notifications@ sender", () => {
  for (const [kind, c] of Object.entries(cases) as Array<[OrgEmailKind, (typeof cases)[OrgEmailKind]]>) {
    const email = buildOrgEmail(kind, { ...base, ...c.data }, { email: "ada@example.com", muteUrl: "https://networkbase.in/api/v1/email/org-mute?token=t" });
    if (typeof c.subject === "string") assert.equal(email.subject, c.subject, kind);
    else assert.match(email.subject, c.subject, kind);
    assert.equal(email.from, "NetworkBase <notifications@networkbase.in>", kind);
    assert.match(email.html, /aria-hidden="true">\s+\S/, `${kind} has a hidden preview`);
    assert.ok(email.text.includes(email.subject.split(":")[0]!.slice(0, 10)) || email.text.length > 50, kind);
    assert.ok(email.html.includes("Manage notification preferences"), kind);
  }
});

test("always-sent emails carry no mute link; the others carry the signed one", () => {
  for (const kind of Object.keys(cases) as OrgEmailKind[]) {
    const email = buildOrgEmail(kind, { ...base, ...cases[kind].data }, { email: "ada@example.com", muteUrl: "https://networkbase.in/m?token=t" });
    assert.equal(email.html.includes("Mute emails from CSE-3A 2026"), !ALWAYS_SENT_EMAILS.has(kind), kind);
    assert.equal(email.headers!["List-Unsubscribe"]!.includes("/m?token=t"), !ALWAYS_SENT_EMAILS.has(kind), kind);
  }
  assert.deepEqual([...ALWAYS_SENT_EMAILS].sort(), ["org_deleted", "org_invite_signup", "org_ownership", "org_ready", "org_removed"]);
});

test("privacy: emails show only what the data carries, escaped; due times are the recipient's, org time in brackets", () => {
  const email = buildOrgEmail("org_assignment", { ...base, assignment: { title: "<b>Lab</b>", dueAt: due, team: ["Ravi"], materials: [{ name: "notes.pdf" }] } }, { email: "a@example.com" });
  assert.ok(!email.html.includes("<b>Lab</b>") && email.html.includes("&lt;b&gt;Lab&lt;/b&gt;"));
  assert.ok(email.text.includes("YOUR TEAM") && email.text.includes("Ravi") && !email.text.includes("Asha"));
  assert.equal(formatEmailWhen(due, "Asia/Kolkata", "Asia/Kolkata"), "Sat 31 Oct, 11:59 PM");
  assert.equal(formatEmailWhen(due, "Europe/London", "Asia/Kolkata"), "Sat 31 Oct, 6:29 PM (Sat 31 Oct, 11:59 PM org time)");
});

test("the mute token is signed: it round-trips, a tampered or unsigned one is refused", () => {
  process.env.EMAIL_LINK_SECRET = "test-secret-for-links";
  const token = orgMuteToken("user-1", ORG)!;
  assert.deepEqual(readOrgMuteToken(token), { userId: "user-1", orgId: ORG });
  const [body] = token.split(".");
  assert.equal(readOrgMuteToken(`${Buffer.from(`user-2.${ORG}`).toString("base64url")}.${token.split(".")[1]}`), null);
  assert.equal(readOrgMuteToken(`${body}.x`), null);
  delete process.env.EMAIL_LINK_SECRET;
  assert.equal(orgMuteToken("user-1", ORG), null);
});

test("local clock, next date and the empty digest", () => {
  const now = new Date("2026-10-30T03:30:00Z");
  assert.deepEqual(localClock(now, "Asia/Kolkata"), { date: "2026-10-30", hour: 9 });
  assert.deepEqual(localClock(now, "Not/AZone"), { date: "2026-10-30", hour: 3 });
  assert.equal(nextDate("2026-12-31"), "2027-01-01");
  assert.equal(digestIsEmpty({ toReview: [], joinRequests: 0, behind: 0, needsYou: [] }), true);
  assert.equal(digestIsEmpty({ toReview: [{ count: 1 }], joinRequests: 0, behind: 0, needsYou: [] }), false);
});

test("Settings › Organizations: Important only and Off filter the tray; child projects follow when included", () => {
  const prefs = (choice: object) => normalizeNotificationPreferences({ ...DEFAULT_NOTIFICATION_PREFERENCES, organizations: { [ORG]: choice } });
  const check = (choice: object, importance: "important" | "more", projectId = ORG) => !orgChoiceBlocks(prefs(choice), { orgId: ORG, projectId }, importance);
  assert.equal(check({ level: "important" }, "more"), false);
  assert.equal(check({ level: "important" }, "important"), true);
  assert.equal(check({ level: "off" }, "important"), false);
  assert.equal(check({ level: "off", includeChildren: false }, "important", "child"), true, "a child project keeps its own rules");
  assert.equal(check({ level: "off", includeChildren: true }, "important", "child"), false);
  assert.equal(notificationMatchesMuteScope({ kind: "task_assigned", entityRefs: { orgId: ORG, projectId: "child" } }, { kind: "organization", value: ORG }), true);
  assert.deepEqual(prefs({ level: "nonsense", email: "x" }).organizations[ORG], { level: "all", email: true, includeChildren: true });
});

test("org event groups show for organizations only", () => {
  const ids = (isOrg: boolean) => groupProjectNotificationEntries(getVisibleProjectNotificationEntries(isOrg)).map((g) => g.id);
  assert.ok(!ids(false).some((id) => id.startsWith("org_")));
  assert.deepEqual(ids(true).filter((id) => id.startsWith("org_")), ["org_membership", "org_assignments", "org_announcements", "org_credit", "org_sprints"]);
});
