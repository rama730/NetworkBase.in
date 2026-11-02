/**
 * The organization permissions matrix (docs/organization-concept-report.md §29.4), the source of
 * truth for orgs and child projects. A grant other than "yes"/"no" needs the caller's context:
 * read = read only, counts = counts without names, own = only your own (copy, status, audience),
 * setting = an org or privacy setting decides, public = only when public and allowed,
 * request = asks an admin, after_transfer = only after handing over ownership.
 */
export type Grant = "yes" | "no" | "read" | "counts" | "own" | "setting" | "public" | "request" | "after_transfer";

export const ORG_ROLES = ["owner", "admin", "member", "guest", "visitor"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

//                                owner             admin    member     guest      visitor
const ORG = {
  open_dashboard:           g("yes",            "yes",   "yes",     "yes",     "no"),
  open_about:               g("yes",            "yes",   "yes",     "yes",     "yes"),
  edit_about:               g("yes",            "yes",   "no",      "no",      "no"),
  edit_identity:            g("yes",            "no",    "no",      "no",      "no"), // name, handle, public/private, role names
  manage_joining:           g("yes",            "yes",   "no",      "no",      "no"), // join code, join mode, Max members
  invite_members_guests:    g("yes",            "yes",   "no",      "no",      "no"),
  manage_admins:            g("yes",            "no",    "no",      "no",      "no"),
  review_join_requests:     g("yes",            "yes",   "no",      "no",      "no"),
  remove_members_guests:    g("yes",            "yes",   "no",      "no",      "no"),
  members_tab:              g("yes",            "yes",   "no",      "no",      "no"),
  announce:                 g("yes",            "yes",   "no",      "no",      "no"),
  post_discussion:          g("yes",            "yes",   "setting", "no",      "no"),
  comment_posts:            g("yes",            "yes",   "yes",     "no",      "no"),
  read_posts:               g("yes",            "yes",   "own",     "read",    "public"),
  run_sprints:              g("yes",            "yes",   "no",      "no",      "no"),
  see_sprints:              g("yes",            "yes",   "own",     "counts",  "public"),
  create_assignments:       g("yes",            "yes",   "no",      "no",      "no"),
  see_roster:               g("yes",            "yes",   "own",     "counts",  "no"),
  review_submissions:       g("yes",            "yes",   "no",      "no",      "no"),
  submit_own:               g("no",             "no",    "yes",     "no",      "no"),
  edit_docs:                g("yes",            "yes",   "no",      "no",      "no"),
  read_docs:                g("yes",            "yes",   "yes",     "read",    "public"),
  manage_files:             g("yes",            "yes",   "no",      "no",      "no"),
  read_files:               g("yes",            "yes",   "read",    "read",    "public"),
  download_submissions:     g("yes",            "yes",   "no",      "no",      "no"),
  projects_tab:             g("yes",            "yes",   "own",     "read",    "public"),
  create_child_project:     g("yes",            "yes",   "setting", "no",      "no"),
  archive_detach_child:     g("yes",            "yes",   "no",      "no",      "no"),
  verify_contributions:     g("yes",            "yes",   "no",      "no",      "no"),
  settings:                 g("yes",            "yes",   "own",     "own",     "no"), // admins: sections 1–11; members, guests: "You" only
  org_lifecycle:            g("yes",            "no",    "no",      "no",      "no"), // transfer, archive, duplicate, delete
  general_channel:          g("yes",            "yes",   "yes",     "no",      "no"),
  create_org_channels:      g("yes",            "yes",   "setting", "no",      "no"),
  dm:                       g("yes",            "yes",   "setting", "setting", "setting"),
  follow:                   g("no",             "no",    "no",      "no",      "public"),
  leave:                    g("after_transfer", "yes",   "yes",     "yes",     "no"),
  // Report §21.3 and §39.2 (decisions 33, 109): the type never changes a row; only the role does.
  change_org_type:          g("yes",            "no",    "no",      "no",      "no"),
  request_verified:         g("yes",            "no",    "no",      "no",      "no"),
  appeal:                   g("yes",            "no",    "no",      "no",      "no"),
  create_org_tasks:         g("yes",            "yes",   "no",      "no",      "no"),
  edit_group_task_details:  g("yes",            "yes",   "no",      "no",      "no"),
  update_own_copy:          g("no",             "no",    "own",     "no",      "no"), // owners and admins have no copy
  update_assigned_task:     g("yes",            "yes",   "own",     "no",      "no"),
  edit_for_everyone:        g("yes",            "yes",   "no",      "no",      "no"), // Edit for everyone, Use again, Repeat
  extend_excuse_remind:     g("yes",            "yes",   "no",      "no",      "no"), // Extend, Excuse, Give to, Remind
  close_assignment:         g("yes",            "yes",   "no",      "no",      "no"), // Close, Reopen; never delete once handed in
  approve_return:           g("yes",            "yes",   "no",      "no",      "no"), // never their own work (decision 95)
  set_reviewers:            g("yes",            "yes",   "no",      "no",      "no"),
  export_progress:          g("yes",            "yes",   "no",      "no",      "no"),
  download_all:             g("yes",            "yes",   "no",      "no",      "no"),
  submit_ask_questions:     g("no",             "no",    "yes",     "read",    "no"),
  see_class_overview:       g("yes",            "yes",   "no",      "no",      "no"), // also Seen and Read lists
  mark_away:                g("yes",            "yes",   "no",      "no",      "no"),
  change_member_viewer_role: g("yes",           "yes",   "no",      "no",      "no"), // anything involving Admin is manage_admins
  see_former:               g("yes",            "yes",   "no",      "no",      "no"),
  invite_back_unblock:      g("yes",            "yes",   "no",      "no",      "no"),
  move_member_workspace:    g("yes",            "yes",   "no",      "no",      "no"),
  remove_outside_person:    g("yes",            "yes",   "no",      "no",      "no"),
  handle_team_change:       g("yes",            "yes",   "no",      "no",      "no"),
  approve_move_in:          g("yes",            "yes",   "no",      "no",      "no"), // and leave requests
  assign_lead:              g("yes",            "yes",   "no",      "no",      "no"), // only when there's none
  remind_leads:             g("yes",            "yes",   "no",      "no",      "no"),
  hide_shared_post:         g("yes",            "yes",   "no",      "no",      "no"),
  delete_others_post:       g("yes",            "yes",   "no",      "no",      "no"), // with a reason
  publish_document:         g("yes",            "yes",   "no",      "no",      "no"), // and Required
  see_storage:              g("yes",            "yes",   "no",      "no",      "no"), // and Review
  set_folder_access:        g("yes",            "yes",   "no",      "no",      "no"),
  empty_trash:              g("yes",            "yes",   "no",      "no",      "no"),
  handle_reports:           g("yes",            "yes",   "no",      "no",      "no"),
  see_standing:             g("yes",            "yes",   "no",      "no",      "no"),
  copy_link:                g("yes",            "yes",   "yes",     "yes",     "public"),
} satisfies Record<string, Record<OrgRole, Grant>>;

export const CHILD_ROLES = ["lead", "project_admin", "inherited_admin", "unit_member", "outside", "org_member", "visitor"] as const;
export type ChildRole = (typeof CHILD_ROLES)[number];

//                                lead              project_admin inherited  unit       outside    org_member visitor
const CHILD = {
  open_project:             c("yes",            "yes",        "yes",     "yes",     "yes",     "setting", "public"),
  edit_general:             c("yes",            "no",         "no",      "no",      "no",      "no",      "no"),
  change_visibility:        c("yes",            "yes",        "yes",     "no",      "no",      "no",      "no"),
  manage_members_units:     c("yes",            "yes",        "yes",     "no",      "no",      "no",      "no"),
  remove_members:           c("yes",            "yes",        "yes",     "no",      "no",      "no",      "no"), // never the lead
  transfer_ownership:       c("yes",            "no",         "no",      "no",      "no",      "no",      "no"),
  archive:                  c("yes",            "no",         "yes",     "no",      "no",      "no",      "no"),
  detach:                   c("request",        "no",         "yes",     "no",      "no",      "no",      "no"),
  delete:                   c("yes",            "no",         "no",      "no",      "no",      "no",      "no"),
  create_move_tasks:        c("yes",            "yes",        "yes",     "own",     "own",     "no",      "no"),
  review_own_tasks:         c("yes",            "yes",        "yes",     "no",      "no",      "no",      "no"),
  submit_group_assignment:  c("own",            "own",        "yes",     "own",     "own",     "no",      "no"),
  share_to_org:             c("yes",            "yes",        "yes",     "setting", "no",      "no",      "no"),
  see_org_content:          c("yes",            "yes",        "yes",     "yes",     "no",      "no",      "no"),
  project_channels:         c("yes",            "yes",        "yes",     "yes",     "yes",     "no",      "no"),
  apply_open_seat:          c("no",             "no",         "no",      "no",      "no",      "yes",     "public"),
  leave_project:            c("after_transfer", "yes",        "no",      "yes",     "yes",     "no",      "no"),
  // Report §39.2.
  decide_applications:      c("yes",            "yes",        "yes",     "no",      "no",      "no",      "no"),
  team_tasks:               c("yes",            "yes",        "yes",     "no",      "no",      "no",      "no"), // a task for a team, or each team
  reassign_group_work:      c("yes",            "yes",        "yes",     "no",      "no",      "no",      "no"),
  github_connect_push:      c("yes",            "no",         "no",      "no",      "no",      "no",      "no"),
  github_status:            c("yes",            "yes",        "yes",     "yes",     "yes",     "no",      "no"),
  unarchive:                c("own",            "no",         "yes",     "no",      "no",      "no",      "no"), // the lead only if they archived it
} satisfies Record<string, Record<ChildRole, Grant>>;

export type OrgAction = keyof typeof ORG;
export type ChildAction = keyof typeof CHILD;
export const ORG_ACTIONS = Object.keys(ORG) as OrgAction[];
export const CHILD_ACTIONS = Object.keys(CHILD) as ChildAction[];

/**
 * Rows whose server check hasn't moved to this table yet, and the step that moves it (report §21.3: each action
 * moves as it's built or changed). A test keeps this list honest: every entry names a real row and a step.
 */
export const PENDING_ENFORCEMENT: Partial<Record<OrgAction | ChildAction, string>> = {
  create_org_tasks: "Step 13", edit_group_task_details: "Step 13", update_own_copy: "Step 13", update_assigned_task: "Step 13",
  edit_for_everyone: "Step 13", close_assignment: "Step 13", approve_return: "Step 13", set_reviewers: "Step 13",
  export_progress: "Step 13", submit_ask_questions: "Step 13", see_class_overview: "Step 4",
  mark_away: "Step 14 (after the pilot)", see_former: "Step 11", invite_back_unblock: "Step 11", remove_outside_person: "Step 11",
  handle_team_change: "Step 11", assign_lead: "Step 11",
  publish_document: "Step 10", see_storage: "Step 9",
  handle_reports: "Step 9", see_standing: "Step 9", appeal: "Step 9", request_verified: "Step 9", copy_link: "Step 14",
  decide_applications: "Step 11", team_tasks: "Step 13", reassign_group_work: "Step 13", github_connect_push: "Step 11",
  github_status: "Step 11", unarchive: "Step 11",
};

export function orgGrant(role: OrgRole, action: OrgAction): Grant {
  return ORG[action][role];
}

export function childGrant(role: ChildRole, action: ChildAction): Grant {
  return CHILD[action][role];
}

function g(owner: Grant, admin: Grant, member: Grant, guest: Grant, visitor: Grant): Record<OrgRole, Grant> {
  return { owner, admin, member, guest, visitor };
}

function c(lead: Grant, project_admin: Grant, inherited_admin: Grant, unit_member: Grant, outside: Grant, org_member: Grant, visitor: Grant): Record<ChildRole, Grant> {
  return { lead, project_admin, inherited_admin, unit_member, outside, org_member, visitor };
}
