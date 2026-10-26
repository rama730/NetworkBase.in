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
} satisfies Record<string, Record<ChildRole, Grant>>;

export type OrgAction = keyof typeof ORG;
export type ChildAction = keyof typeof CHILD;
export const ORG_ACTIONS = Object.keys(ORG) as OrgAction[];
export const CHILD_ACTIONS = Object.keys(CHILD) as ChildAction[];

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
