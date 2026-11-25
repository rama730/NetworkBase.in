import assert from "node:assert/strict";
import { test } from "node:test";

import { localTime, orgChart, wouldLoop } from "../../src/lib/organizations/directory";

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
