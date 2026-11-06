import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// Live-fix phase 3 (problems 11–18): the Overview's sections look like the report, not its "problem" examples.
const overview = readFileSync("src/components/organizations/OrgOverviewParts.tsx", "utf8");

test("live-fix 11 (design plan OV9): pinned is the shared line with the author's photo, time, a New badge, × and ⋯ → Unpin", () => {
  assert.match(overview, /<PinnedLine /);
  assert.match(overview, /author=\{/);
  assert.match(overview, /hidePinnedForMeAction\(orgId, pinned\.id\)/);
  assert.match(overview, /aria-label="Hide for me"/);
  assert.match(overview, /toggleWorkspaceUpdatePinAction\(orgId, pinned\.id, false\)/);
  assert.match(overview, /unread=\{pinned\.unread\}/);
});

test("live-fix 12: Today rows have an icon, a bold title, a detail line, an action, and Approve in place", () => {
  assert.match(overview, /TODAY_ICON\[n\.kind\]/);
  assert.match(overview, /approveJoinRequestsAction\(orgId, \[n\.approveId!?\]\)/);
  assert.match(overview, /n\.detail \?/);
});

test("live-fix 13, 14: This sprint is a card; nobody joined yet links to Invite", () => {
  assert.match(overview, />All sprints</);
  assert.match(overview, /'days'\} left/);
  assert.match(overview, /role="progressbar"/);
  assert.match(overview, /Nobody has joined yet/);
  assert.doesNotMatch(overview, /title=\{s\.sprint \? `This sprint · \$\{s\.sprint\.name\}/);
});

test("live-fix 15: This week has date tiles and never repeats its heading", () => {
  assert.match(overview, /DateTile/);
  assert.match(overview, /group !== 'This week'/);
});

test("live-fix 16: Activity filters are one small menu, 5 rows, then Show more", () => {
  assert.match(overview, /<ActivityItem /);
  assert.match(overview, /aria-label="Filter activity"/);
  assert.doesNotMatch(overview, /role="tablist" aria-label="Filter activity"/);
  assert.match(overview, /moreActivity \? activity : activity\.slice\(0, 5\)/);
});

test("live-fix 17, 18: Workspaces rows and People have photos; alone shows the invite panel", () => {
  assert.match(overview, /<WorkspaceRow /);
  assert.match(overview, /overdue/);
  assert.match(overview, /<AvatarStack /);
  assert.match(overview, /<OrgInvitePanel /);
  assert.match(source("src/components/workspaces/WorkspaceAvatar.tsx"), /"row"/);
});

function source(path: string) {
  return readFileSync(path, "utf8");
}

test("live-fix 19–21: About has Edit details and Edit on the welcome note, a two-stop stage line, and Role · Title with photos", () => {
  const about = source("src/components/organizations/OrgAboutTab.tsx");
  assert.match(about, /editLabel="Edit details"/);
  assert.match(about, /editHref=\{viewer === 'admin'/);
  assert.match(source("src/components/organizations/org-ui.tsx"), /aria-label="Edit welcome note"/);
  assert.match(about, /stages === 'timeline' \|\| stages === 'single'/);
  assert.match(about, /\[roleName\(l\.role\), l\.title\]\.filter\(Boolean\)\.join\(' · '\)/);
  assert.match(about, /<UserAvatar /);
  assert.match(source("src/components/workspaces/dashboard/WorkspaceOverviewCard.tsx"), /isCreator && onEdit && editLabel/);
  assert.match(source("src/app/actions/org-dashboard.ts"), /leaders: Array<\{ id: string; name: string; username: string \| null; avatarUrl: string \| null;/);
});

test("live-fix 12–16 follow-ups: every Today type has an icon and action, the sprint card has Start now, Add task and a roster badge, This week has See all, Activity bolds its subject", () => {
  for (const kind of ["team", "unplaced", "needs_projects", "autostart", "plan_sprint", "complete_sprint", "sprint_dates", "group", "reports", "sprint_ending", "term_end", "due_today"]) {
    assert.match(overview, new RegExp(`TODAY_ICON[^\\n]*\\b${kind}:`), `${kind} icon`);
    assert.match(overview, new RegExp(`TODAY_ACTION[^\\n]*\\b${kind}:`), `${kind} action`);
  }
  assert.match(overview, /<StartNowButton projectId=\{orgId\} sprintId=\{s\.next\.id\}/);
  assert.match(overview, />Add task<\/Link>/);
  assert.match(overview, /aria-label=\{`Roster for \$\{i\.title\}`\}/);
  assert.match(overview, />See all</);
  const item = source("src/components/ui/activity-item.tsx");
  assert.match(item, /subject && text\.startsWith\(subject\)/);
  assert.match(source("src/app/actions/org-dashboard.ts"), /next: !active && next \? \{ id: next\.id, name: next\.name/);
});
