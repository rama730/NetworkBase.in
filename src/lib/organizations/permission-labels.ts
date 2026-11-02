import type { OrgAction } from "@/lib/organizations/permissions";

// Report §22.4: "What each role can do", generated from the real permissions, grouped by area. A test keeps every
// row of the permissions table here. `setting` names the Settings section that decides a "setting" row.

export type PermissionRow = { action: OrgAction; label: string; setting?: string };

export const PERMISSION_AREAS: Array<{ area: string; rows: PermissionRow[] }> = [
  { area: "Joining and people", rows: [
    { action: "open_dashboard", label: "Open the Overview tab" },
    { action: "open_about", label: "Read the About tab" },
    { action: "manage_joining", label: "Change the join code and how people join" },
    { action: "invite_members_guests", label: "Invite people" },
    { action: "review_join_requests", label: "Approve join requests" },
    { action: "members_tab", label: "Open the Members tab" },
    { action: "remove_members_guests", label: "Remove people" },
    { action: "change_member_viewer_role", label: "Change someone between member and viewer" },
    { action: "manage_admins", label: "Make or remove admins" },
    { action: "see_former", label: "See former members" },
    { action: "invite_back_unblock", label: "Invite back or unblock someone" },
    { action: "move_member_workspace", label: "Move someone to another workspace" },
    { action: "verify_contributions", label: "Verify contributions" },
    { action: "see_roster", label: "See the roster" },
    { action: "see_class_overview", label: "See how everyone is doing, and who has read things" },
    { action: "mark_away", label: "Mark someone away" },
    { action: "leave", label: "Leave the organization" },
  ] },
  { area: "Updates and messages", rows: [
    { action: "announce", label: "Post announcements" },
    { action: "post_discussion", label: "Start discussions", setting: "org-updates" },
    { action: "comment_posts", label: "Reply to posts" },
    { action: "read_posts", label: "Read posts" },
    { action: "hide_shared_post", label: "Hide a workspace’s post from the organization" },
    { action: "delete_others_post", label: "Remove someone else’s post, with a reason" },
    { action: "general_channel", label: "Post in #general" },
    { action: "create_org_channels", label: "Create channels", setting: "org-messages" },
    { action: "dm", label: "Send direct messages", setting: "privacy-policies" },
    { action: "follow", label: "Follow the organization" },
    { action: "copy_link", label: "Copy links" },
  ] },
  { area: "Sprints and tasks", rows: [
    { action: "run_sprints", label: "Plan and run sprints" },
    { action: "see_sprints", label: "See sprints" },
    { action: "create_assignments", label: "Create assignments" },
    { action: "create_org_tasks", label: "Create tasks" },
    { action: "edit_group_task_details", label: "Change group work’s details" },
    { action: "edit_for_everyone", label: "Edit for everyone, Use again" },
    { action: "extend_excuse_remind", label: "Extend, excuse and remind" },
    { action: "close_assignment", label: "Close or reopen an assignment" },
    { action: "set_reviewers", label: "Choose reviewers" },
    { action: "review_submissions", label: "Review submissions" },
    { action: "approve_return", label: "Approve or return work" },
    { action: "submit_own", label: "Hand in their own work" },
    { action: "update_own_copy", label: "Work on their own copy" },
    { action: "update_assigned_task", label: "Update tasks given to them" },
    { action: "submit_ask_questions", label: "Ask questions on an assignment" },
    { action: "export_progress", label: "Export progress" },
    { action: "download_all", label: "Download everyone’s submissions" },
  ] },
  { area: "Documents and files", rows: [
    { action: "edit_docs", label: "Write documents" },
    { action: "publish_document", label: "Publish documents and mark them required" },
    { action: "read_docs", label: "Read documents" },
    { action: "manage_files", label: "Upload and change files" },
    { action: "read_files", label: "Open files" },
    { action: "set_folder_access", label: "Choose who can see a folder" },
    { action: "download_submissions", label: "Download submissions" },
    { action: "empty_trash", label: "Empty the Trash" },
    { action: "see_storage", label: "See storage" },
  ] },
  { area: "Workspaces", rows: [
    { action: "projects_tab", label: "See workspaces" },
    { action: "create_child_project", label: "Create workspaces", setting: "org-projects" },
    { action: "archive_detach_child", label: "Archive or detach a workspace" },
    { action: "approve_move_in", label: "Approve move-in and leave requests" },
    { action: "remove_outside_person", label: "Remove an outside person from a workspace" },
    { action: "handle_team_change", label: "Handle team change requests" },
    { action: "assign_lead", label: "Choose a team lead for a workspace that has none" },
    { action: "remind_leads", label: "Remind team leads" },
  ] },
  { area: "Settings and safety", rows: [
    { action: "settings", label: "Open the Settings tab" },
    { action: "edit_about", label: "Edit the tagline, description and About" },
    { action: "edit_identity", label: "Change the name, handle, visibility and role names" },
    { action: "change_org_type", label: "Change the type" },
    { action: "request_verified", label: "Ask for the verified badge" },
    { action: "handle_reports", label: "Handle reports" },
    { action: "see_standing", label: "See the organization’s standing" },
    { action: "appeal", label: "Appeal a decision" },
    { action: "org_lifecycle", label: "Transfer, archive, duplicate or delete" },
  ] },
];

/** What a grant reads as in the table. */
export const GRANT_WORDS: Record<string, string> = {
  yes: "Yes", no: "—", setting: "If allowed", own: "Their own", read: "Read only", counts: "Counts only", public: "If public", request: "Asks", after_transfer: "After handing over",
};
