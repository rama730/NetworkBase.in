import assert from "node:assert/strict";
import { test } from "node:test";

// Report 38.15 part 7 (plan A6.34): the Docs site.
test("docsSiteMenu: on-site documents by section in section order, by docsOrder then title; Other for no section; the rest apart", async () => {
  const { docsSiteMenu } = await import("../../src/lib/workspaces/doc-sections");
  const d = (slug: string, o: Record<string, unknown> = {}) => ({ id: slug, slug, filename: `${slug}.md`, linkedNodeId: null, ...o });
  const menu = docsSiteMenu([
    d("faq", { docsSite: true, docsOrder: 2 }), d("intro", { docsSite: true, docsOrder: 1 }), d("weekly", { section: "meetings", docsSite: true }),
    d("draft"), d("api", { docsSite: true, title: "API" }),
  ]);
  assert.deepEqual(menu.groups.map((g) => [g.label, g.docs.map((x) => x.slug)]), [["Pages", ["intro", "faq", "api"]], ["Meetings", ["weekly"]]]);
  assert.deepEqual(menu.off.map((x) => x.slug), ["draft"]);
  assert.deepEqual(menu.order.map((x) => x.slug), ["intro", "faq", "api", "weekly"], "Previous / Next follow the menu");
});

test("permission: with the Docs site on, an outsider reads only documents on it; members read all", async () => {
  const { resolveWorkspaceDocPermission } = await import("../../src/lib/workspaces/doc");
  const base = { projectVisibility: "public", projectStatus: "active", publicTabVisibility: { readme: true }, hasPublishedReadme: true };
  assert.equal(resolveWorkspaceDocPermission({ ...base, settings: {} }).canReadPublished, true, "site off: as today");
  assert.equal(resolveWorkspaceDocPermission({ ...base, settings: {}, docsSiteOnly: true }).canReadPublished, false);
  assert.equal(resolveWorkspaceDocPermission({ ...base, settings: { docsSite: true }, docsSiteOnly: true }).canReadPublished, true);
  assert.equal(resolveWorkspaceDocPermission({ ...base, settings: {}, docsSiteOnly: true, actorUserId: "m", isActiveMember: true, membershipRole: "member" }).canReadPublished, true);
  assert.equal(resolveWorkspaceDocPermission({ ...base, settings: { docsSite: true, visibilityOverride: "members_only" }, docsSiteOnly: true }).canReadPublished, false, "members only wins");
});
