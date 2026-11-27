import assert from "node:assert/strict";
import { test } from "node:test";

import { localTime, nextDays, orgChart, outSpan, seesTimeOffType, timeOffNames, wouldLoop } from "../../src/lib/organizations/directory";

test("33.3 call 4: Reports to refuses loops", () => {
  const r = { dev: "ana", ana: "sam" };
  assert.equal(wouldLoop(r, "sam", "dev"), true, "Sam can't report to someone who reports to Sam");
  assert.equal(wouldLoop(r, "dev", "dev"), true);
  assert.equal(wouldLoop(r, "kai", "dev"), false);
  assert.equal(wouldLoop(r, "dev", null), false);
});

test("33.3: the org chart is a tree from Reports to; outside managers and loops never hide anyone", () => {
  const chart = orgChart(["sam", "ana", "dev", "kai", "leo", "x", "y"], { ana: "sam", dev: "ana", kai: "ana", leo: "sam", x: "y", y: "x", gone: "sam" });
  assert.deepEqual(chart.map((n) => [n.id, n.count]), [["sam", 4], ["x", 1]]);
  assert.deepEqual(chart[0]!.reports.map((n) => n.id), ["ana", "leo"]);
  assert.deepEqual(chart[0]!.reports[0]!.reports.map((n) => n.id), ["dev", "kai"]);
  assert.equal(orgChart(["a"], { a: "former" })[0]!.id, "a", "a manager who left: at the top");
});

test("33.3: local time and Off hours from the person's own zone and hours", () => {
  const wed1540 = new Date("2026-11-25T15:40:00Z");
  assert.deepEqual(localTime(wed1540, "Europe/London", { from: "09:00", to: "17:30" }), { label: "3:40 pm", offHours: false });
  assert.deepEqual(localTime(wed1540, "Asia/Singapore", { from: "09:00", to: "17:30" }), { label: "11:40 pm", offHours: true });
  assert.equal(localTime(new Date("2026-11-28T12:00:00Z"), "Europe/London", { from: "09:00", to: "17:30" })?.offHours, true, "weekends are off hours");
  assert.equal(localTime(wed1540, null, null), null);
  assert.equal(localTime(wed1540, "Not/AZone", null), null);
});

test("33.3 call 1: in a company, Members is the Directory for everyone inside; other organizations keep it for admins", async () => {
  const { isWorkspaceTabVisibleToViewer, resolveAllowedWorkspaceTab } = await import("../../src/lib/workspaces/settings-policies");
  const member = { tabId: "members", isOwnerOrMember: true, canManageSettings: false, isOrganization: true };
  assert.equal(isWorkspaceTabVisibleToViewer({ ...member, orgType: "company" }), true);
  assert.equal(isWorkspaceTabVisibleToViewer({ ...member, orgType: "education" }), false);
  assert.equal(isWorkspaceTabVisibleToViewer({ ...member, isOwnerOrMember: false, orgType: "company" }), false, "visitors: nothing");
  assert.equal(resolveAllowedWorkspaceTab({ requestedTab: "members", isOwnerOrMember: true, isOrganization: true, orgType: "company" }), "members");
});

test("33.3 Import people: email, title, team per line, grouped into invites; bad emails are counted, not sent", async () => {
  const { importGroups } = await import("../../src/lib/organizations/directory");
  const r = importGroups("email,title,team\nPriya@acme.com, Head of People, People\nmei@acme.com,Account executive,Sales\nkai@acme.com,Account executive,Sales\nnot-an-email,x,y\n\n");
  assert.deepEqual(r.groups, [
    { title: "Head of People", team: "People", emails: ["priya@acme.com"] },
    { title: "Account executive", team: "Sales", emails: ["mei@acme.com", "kai@acme.com"] },
  ]);
  assert.equal(r.skipped, 1);
});

test("33.3 call 5 (B4.2c): time-off types are renameable; the type reaches the person, their line manager and admins", () => {
  assert.deepEqual(timeOffNames({ vacation: "  Holiday ", sick: "", bogus: "x" }), { vacation: "Holiday", sick: "Sick", ooo: "Out of office", other: "Other" });
  assert.deepEqual(timeOffNames(null).ooo, "Out of office");
  const r = { dev: "ana" };
  assert.equal(seesTimeOffType("dev", "dev", false, r), true, "the person");
  assert.equal(seesTimeOffType("ana", "dev", false, r), true, "their line manager");
  assert.equal(seesTimeOffType("boss", "dev", true, r), true, "admins");
  assert.equal(seesTimeOffType("kai", "dev", false, r), false, "everyone else sees Away");
});

test("B4.2c: Who's out spans the next 14 days in the organization's zone", () => {
  const now = new Date("2026-11-27T20:00:00Z"); // 28 Nov 01:30 in Kolkata
  const days = nextDays(now, "Asia/Kolkata");
  assert.equal(days.length, 14);
  assert.deepEqual([days[0], days[13]], ["2026-11-28", "2026-12-11"]);
  assert.deepEqual(outSpan("2026-11-29T18:30:00Z", "2026-12-02T18:29:00Z", days, "Asia/Kolkata"), { start: 2, end: 4 }, "30 Nov–2 Dec");
  assert.deepEqual(outSpan("2026-11-20T00:00:00Z", "2026-11-28T10:00:00Z", days, "Asia/Kolkata"), { start: 0, end: 0 }, "already under way: from today");
  assert.equal(outSpan("2026-12-20T00:00:00Z", "2026-12-22T00:00:00Z", days, "Asia/Kolkata"), null, "after the two weeks");
});

