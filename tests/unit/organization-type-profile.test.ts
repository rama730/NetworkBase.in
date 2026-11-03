import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { ORG_TYPES } from "@/lib/organizations/config";
import { ORG_TYPE_PROFILES, typeProfile } from "@/lib/organizations/type-profile";
import { ORG_ACTIONS, orgGrant, PENDING_ENFORCEMENT } from "@/lib/organizations/permissions";
import { invitesLeftToday, orgLimitBlock } from "@/lib/organizations/limits";

// Step T (report §21): one type profile, the permissions table as the real check, and limits with plain messages.

const source = (relative: string) => fs.readFileSync(path.join(process.cwd(), relative), "utf8");
const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const full = path.join(dir, e.name);
  return e.isDirectory() ? walk(full) : /\.tsx?$/.test(e.name) ? [full] : [];
});

test("21.2: the type profile matches the report's table", () => {
  const row = (type: (typeof ORG_TYPES)[number]) => {
    const p = ORG_TYPE_PROFILES[type];
    return [Object.values(p.roleNames).join("/"), p.finishedWork, p.termDates, p.sprintPrefix, p.joinMode, p.visibility, p.membersPost, p.generalNotify, p.reviewRequired, p.lateRule, p.storyPoints, p.starterFolders.join(", ")];
  };
  assert.deepEqual(row("education"), ["Teacher/TA/Student/Viewer", "Submissions", true, "CO", "instant", "private", false, "mentions", true, "until", "hidden", "Course materials, Docs, Templates, Staff"]);
  assert.deepEqual(row("company"), ["Owner/Manager/Member/Viewer", "Final files", false, "Sprint ", "approval", "private", true, "all", false, "always", "shown", "Shared, Docs, Templates, Managers"]);
  assert.deepEqual(row("research"), ["PI/Researcher/Member/Viewer", "Final files", false, "Sprint ", "approval", "private", true, "all", false, "always", "shown", "Shared, Docs, Templates, Admins"]);
  assert.deepEqual(row("community"), ["Owner/Admin/Member/Viewer", "Final files", false, "Sprint ", "instant", "public", true, "all", false, "always", "shown", "Shared, Docs, Templates, Admins"]);
  assert.deepEqual(row("club"), ["President/Coordinator/Member/Viewer", "Final files", false, "Sprint ", "instant", "public", true, "all", false, "always", "shown", "Shared, Docs, Templates, Admins"]);
  assert.deepEqual(row("other"), ["Owner/Admin/Member/Viewer", "Final files", false, "Sprint ", "approval", "private", true, "all", false, "always", "shown", "Shared, Docs, Templates, Admins"]);
  assert.equal(typeProfile(null).roleNames.owner, "Owner", "no type reads as Community");
  assert.equal(typeProfile("education").planLabel, "Plan your term");
  assert.equal(typeProfile("company").planLabel, "Plan your sprints");
});

test("21.5: no screen or rule checks for Education by itself; the profile is the one source", () => {
  const offenders = walk(path.join(process.cwd(), "src"))
    .filter((file) => !file.endsWith(path.join("organizations", "type-profile.ts")))
    .filter((file) => /(?:orgType|org_type|type)\s*[!=]==\s*['"]education['"]/.test(fs.readFileSync(file, "utf8")))
    .map((file) => path.relative(process.cwd(), file));
  assert.deepEqual(offenders, []);
});

test("21.3, 39.2: the new rows are in the table, with power set by role and never by type", () => {
  const yes = (action: string) => (["owner", "admin", "member", "guest", "visitor"] as const).filter((r) => orgGrant(r, action as never) === "yes");
  assert.deepEqual(yes("change_org_type"), ["owner"]);
  assert.deepEqual(yes("manage_admins"), ["owner"]);
  assert.deepEqual(yes("see_storage"), ["owner", "admin"]);
  assert.deepEqual(yes("set_folder_access"), ["owner", "admin"]);
  assert.deepEqual(yes("close_assignment"), ["owner", "admin"]);
  assert.deepEqual(yes("extend_excuse_remind"), ["owner", "admin"]);
  assert.deepEqual(yes("approve_move_in"), ["owner", "admin"]);
  assert.deepEqual(yes("remind_leads"), ["owner", "admin"]);
  assert.deepEqual(yes("handle_reports"), ["owner", "admin"]);
  assert.equal(orgGrant("member", "invite_members_guests"), "no", "C6: members can't invite, and nothing turns it on");
});

test("decisions 33 and 109: every Members action names its row, and rows not enforced yet say which step moves them", () => {
  const members = source("src/app/actions/org-members.ts");
  const invitee = new Set(["listMyOrgInvitesAction", "acceptOrgInviteAction", "declineOrgInviteAction"]);
  for (const match of members.matchAll(/export async function (\w+)\(([^)]*)\)[^{]*\{([\s\S]*?)\n\}/g)) {
    const [, name, , body] = match;
    if (invitee.has(name!)) continue;
    const action = body!.match(/orgManager\(orgId, '(\w+)'/)?.[1];
    assert.ok(action, `${name} must check a row with orgManager(orgId, '<action>')`);
    assert.ok((ORG_ACTIONS as string[]).includes(action!), `${name}: ${action} is not a row`);
  }
  // Every row is enforced now: nothing waits for a later step.
  assert.deepEqual(PENDING_ENFORCEMENT, {});
  // Each assignment action names its row when it checks the viewer.
  const assignments = source("src/app/actions/assignments.ts");
  for (const [, action] of assignments.matchAll(/adminOf(?:Master|Copy)\(\w+, '(\w+)'\)/g)) assert.ok((ORG_ACTIONS as string[]).includes(action!), action);
  assert.doesNotMatch(assignments, /adminOf(?:Master|Copy)\(\w+\)/, "every assignment helper call names a row");
  const used = walk(path.join(process.cwd(), "src")).filter((f) => !f.endsWith("permissions.ts")).some((f) => /childGrant\(/.test(fs.readFileSync(f, "utf8")));
  assert.ok(used, "childGrant is the real check for child workspaces");
});

test("21.4, decision 34: limits say why, with a different line for admins and members", () => {
  assert.equal(orgLimitBlock("workspaces", 199, { org: "CSE 3B", isAdmin: true }), null);
  assert.equal(orgLimitBlock("workspaces", 200, { org: "CSE 3B", isAdmin: true }), "CSE 3B has reached 200 workspaces. Contact support to raise this.");
  assert.equal(orgLimitBlock("workspaces", 200, { org: "CSE 3B", isAdmin: false }), "CSE 3B has reached 200 workspaces. Ask an admin.");
  assert.equal(orgLimitBlock("admins", 20, { org: "CSE 3B", isAdmin: true }), "CSE 3B has reached 20 admins. Contact support to raise this.");
  assert.equal(orgLimitBlock("documents", 500, { org: "CSE 3B", isAdmin: true }), "CSE 3B has reached 500 documents. Contact support to raise this.");
  assert.equal(orgLimitBlock("teams", 20, { org: "Team Falcon", isAdmin: true }), "Team Falcon has reached 20 teams. Contact support to raise this.");
  assert.equal(orgLimitBlock("teamsPerAssignment", 501, { org: "CSE 3B", isAdmin: true }), "An assignment can go to up to 500 teams.");
  assert.equal(invitesLeftToday(588), 412);
  assert.equal(invitesLeftToday(1_200), 0);
});

test("22.4: What each role can do is generated from every row of the permissions table, once each", async () => {
  const { PERMISSION_AREAS } = await import("@/lib/organizations/permission-labels");
  const listed = PERMISSION_AREAS.flatMap((a) => a.rows.map((r) => r.action));
  assert.deepEqual([...listed].sort(), [...ORG_ACTIONS].sort());
  assert.equal(new Set(listed).size, listed.length);
});

test("19.2, decision 30: a workspace inside an organization holds 2 GB; the organization 5 GB; hand-ins keep their own allowance", async () => {
  const { projectStorageLimit, storageFullMessage } = await import("@/lib/organizations/limits");
  const GB = 1024 ** 3;
  assert.equal(projectStorageLimit({ kind: "workspace", parentId: "org" }, 10 * GB), 2 * GB);
  assert.equal(projectStorageLimit({ kind: "workspace", parentId: null }, 10 * GB), 10 * GB, "back to 10 GB once detached");
  assert.equal(projectStorageLimit({ kind: "organization", parentId: null }, 10 * GB), 5 * GB);
  assert.equal(projectStorageLimit({ kind: "organization", parentId: null }, 10 * GB, true), 10 * GB);
  assert.equal(storageFullMessage({ kind: "workspace", parentId: "org" }, false), "Team storage is full. Remove files to make room.");
  assert.equal(storageFullMessage({ kind: "organization", parentId: null }, false), "Storage is full. Ask an admin.");
});
