import type { readOrgTabBadgesAction } from "@/app/actions/assignments";
import type { readOrgDashboardAction, readOrgWorkspacesAction } from "@/app/actions/org-dashboard";
import type { readOrgMembersAction } from "@/app/actions/org-members";

/** An organization page's first reads, started on the server for the open tab (live-fix phase 1, problem 1). */
export type OrgStartedReads = {
  dashboard?: ReturnType<typeof readOrgDashboardAction>;
  workspaces?: ReturnType<typeof readOrgWorkspacesAction>;
  members?: ReturnType<typeof readOrgMembersAction>;
  badges?: ReturnType<typeof readOrgTabBadgesAction>;
};
