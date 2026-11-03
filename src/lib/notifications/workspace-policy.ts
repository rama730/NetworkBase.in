import { NOTIFICATION_CATEGORIES, type NotificationCategory } from "@/lib/copy/terms";
import type {
    NotificationImportance,
    NotificationKind,
    NotificationPreferenceCategory,
} from "@/lib/notifications/types";

export type WorkspaceNotificationPreset = "quiet" | "balanced" | "active";
export type WorkspaceNotificationGroupId =
    | "membership_access"
    | "roles_applications"
    | "project_lifecycle"
    | "tasks_workflow"
    | "files_workspace"
    | "readme"
    | "updates"
    | "security_audit"
    | "future"
    | "org_membership"
    | "org_assignments"
    | "org_announcements"
    | "org_credit"
    | "org_sprints";
export type WorkspaceNotificationRecipientGroup =
    | "owner"
    | "co_leaders"
    | "members"
    | "viewers"
    | "followers"
    | "assignee"
    | "creator"
    | "reviewer"
    | "applicant"
    | "affected_member"
    | "task_participants";
export type WorkspaceNotificationAggregatePolicy = "none" | "burst_10m" | "digest_only";

export type WorkspaceNotificationEventKey =
    | "members.joined"
    | "members.role_changed"
    | "members.removed"
    | "members.ownership_transferred"
    | "access.visibility_changed"
    | "access.public_tabs_changed"
    | "access.file_upload_permission_changed"
    | "roles.created"
    | "roles.updated"
    | "roles.closed"
    | "applications.received"
    | "applications.decision"
    | "applications.withdrawn"
    | "applications.review_needed"
    | "sprints.created"
    | "sprints.started"
    | "sprints.updated"
    | "sprints.completed"
    | "sprints.deleted"
    | "sprints.task_moved"
    | "tasks.created_assigned"
    | "tasks.assigned"
    | "tasks.status_attention"
    | "tasks.mentions"
    | "tasks.replies"
    | "tasks.bulk_changed"
    | "files.uploaded"
    | "files.bulk_uploaded"
    | "files.folder_created"
    | "files.version_added"
    | "files.replaced"
    | "files.review_requested"
    | "files.organized"
    | "files.deleted_restored"
    | "files.git_sync_status"
    | "security.protected_action"
    | "security.data_export_ready"
    | "security.project_archived"
    | "security.delete_scheduled"
    | "readme.published"
    | "readme.major_edited"
    | "updates.published"
    | "updates.comment"
    | "updates.liked"
    | "updates.team_activity"
    | "updates.comment_liked"
    | "updates.reply"
    | "updates.mention"
    | "updates.follower_digest"
    | OrgNotificationEventKey;

/** Organization events (report §26.3); they show only in an organization's settings. */
export type OrgNotificationEventKey =
    | "org.created"
    | "org.join_requested"
    | "org.join_decided"
    | "org.invited"
    | "org.member_joined"
    | "org.member_left"
    | "org.role_changed"
    | "org.removed"
    | "org.child_added"
    | "org.child_requests"
    | "org.child_decided"
    | "org.lifecycle"
    | "assignments.published"
    | "assignments.submitted"
    | "assignments.reviewed"
    | "assignments.due_changed"
    | "assignments.due_soon"
    | "assignments.reminded"
    | "assignments.question_asked"
    | "assignments.answer_shared"
    | "org.team_changed"
    | "org.member_deleted"
    | "announcements.posted"
    | "credit.changed"
    | "org.code_changed"
    | "org.child_created"
    | "org.child_notice"
    | "org_sprints.started"
    | "org_sprints.completed"
    | "org_sprints.notice";

export type WorkspaceNotificationRule = {
    enabled: boolean;
    importance: NotificationImportance;
    aggregate?: WorkspaceNotificationAggregatePolicy;
};

export type WorkspaceNotificationPolicy = {
    version: 1;
    preset: WorkspaceNotificationPreset;
    rules: Record<WorkspaceNotificationEventKey, WorkspaceNotificationRule>;
};

export type WorkspaceMemberNotificationOverrides = {
    version: 1;
    mode: "inherit" | "custom";
    rules: Partial<Record<WorkspaceNotificationEventKey, boolean>>;
};

export type WorkspaceNotificationRegistryEntry = {
    key: WorkspaceNotificationEventKey;
    group: WorkspaceNotificationGroupId;
    label: string;
    description: string;
    category: NotificationPreferenceCategory;
    notificationKind: NotificationKind;
    defaultEnabled: boolean;
    defaultImportance: NotificationImportance;
    defaultRecipients: readonly WorkspaceNotificationRecipientGroup[];
    allowMemberOverride: boolean;
    mandatory: boolean;
    aggregate: WorkspaceNotificationAggregatePolicy;
    visible: boolean;
};

/** Decision 38: every group belongs to one category of the single list in src/lib/copy/terms.ts. */
const GROUP_CATEGORY: Record<WorkspaceNotificationGroupId, NotificationCategory | null> = {
    membership_access: "members", roles_applications: "applications", project_lifecycle: "sprints", tasks_workflow: "tasks",
    files_workspace: "files", readme: "files", updates: "updates", security_audit: "security", future: null,
    org_membership: "members", org_assignments: "assignments", org_announcements: "updates", org_credit: "members", org_sprints: "sprints",
};
const categoryOf = (id: WorkspaceNotificationGroupId) => NOTIFICATION_CATEGORIES.find((c) => c.id === GROUP_CATEGORY[id]);

export const WORKSPACE_NOTIFICATION_GROUPS: Array<{
    id: WorkspaceNotificationGroupId;
    title: string;
    description: string;
    visible: boolean;
}> = (Object.keys(GROUP_CATEGORY) as WorkspaceNotificationGroupId[]).map((id) => ({
    id,
    title: categoryOf(id)?.label ?? "",
    description: categoryOf(id)?.description ?? "",
    visible: GROUP_CATEGORY[id] !== null,
}));

const ORG_GROUP_IDS = new Set<WorkspaceNotificationGroupId>(["org_membership", "org_assignments", "org_announcements", "org_credit", "org_sprints"]);

const ORG_KIND: Record<string, NotificationKind> = { org_membership: "org_membership", org_assignments: "org_assignment", org_announcements: "org_announcement", org_credit: "org_credit", org_sprints: "project_sprint_activity" };

/** One line per org event: recipients are chosen by the trigger, so defaultRecipients only labels them. */
const orgEvent = (key: OrgNotificationEventKey, group: WorkspaceNotificationGroupId, label: string, description: string,
    importance: NotificationImportance, opts: { aggregate?: WorkspaceNotificationAggregatePolicy; mandatory?: boolean; recipients?: WorkspaceNotificationRecipientGroup[] } = {}): WorkspaceNotificationRegistryEntry => ({
    key, group, label, description,
    category: group === "org_assignments" ? "tasks" : "projects",
    notificationKind: ORG_KIND[group]!,
    defaultEnabled: true, defaultImportance: importance,
    defaultRecipients: opts.recipients ?? ["affected_member"],
    allowMemberOverride: !opts.mandatory, mandatory: Boolean(opts.mandatory),
    aggregate: opts.aggregate ?? "none", visible: true,
});

const E = (entry: WorkspaceNotificationRegistryEntry) => entry;

export const WORKSPACE_NOTIFICATION_EVENT_REGISTRY = {
    "members.joined": E({
        key: "members.joined",
        group: "membership_access",
        label: "Member joined",
        description: "Notify the owner and admins when someone joins.",
        category: "projects",
        notificationKind: "project_member_joined",
        defaultEnabled: true,
        defaultImportance: "more",
        defaultRecipients: ["owner", "co_leaders"],
        allowMemberOverride: true,
        mandatory: false,
        aggregate: "none",
        visible: true,
    }),
    "members.role_changed": E({
        key: "members.role_changed",
        group: "membership_access",
        label: "Role changed",
        description: "Notify the affected member when their workspace role changes.",
        category: "projects",
        notificationKind: "project_role_changed",
        defaultEnabled: true,
        defaultImportance: "important",
        defaultRecipients: ["affected_member"],
        allowMemberOverride: false,
        mandatory: true,
        aggregate: "none",
        visible: true,
    }),
    "members.removed": E({
        key: "members.removed",
        group: "membership_access",
        label: "Member removed",
        description: "Notify the removed member with safe access-removal copy.",
        category: "projects",
        notificationKind: "project_member_removed",
        defaultEnabled: true,
        defaultImportance: "important",
        defaultRecipients: ["affected_member"],
        allowMemberOverride: false,
        mandatory: true,
        aggregate: "none",
        visible: true,
    }),
    "members.ownership_transferred": E({
        key: "members.ownership_transferred",
        group: "membership_access",
        label: "Ownership transferred",
        description: "Notify previous and new owner when workspace ownership changes.",
        category: "projects",
        notificationKind: "project_ownership_transferred",
        defaultEnabled: true,
        defaultImportance: "important",
        defaultRecipients: ["affected_member"],
        allowMemberOverride: false,
        mandatory: true,
        aggregate: "none",
        visible: true,
    }),
    "access.visibility_changed": E({
        key: "access.visibility_changed",
        group: "membership_access",
        label: "Visibility changed",
        description: "Notify members when a workspace becomes public or private.",
        category: "projects",
        notificationKind: "project_visibility_changed",
        defaultEnabled: true,
        defaultImportance: "important",
        defaultRecipients: ["members"],
        allowMemberOverride: true,
        mandatory: false,
        aggregate: "none",
        visible: true,
    }),
    "access.public_tabs_changed": E({
        key: "access.public_tabs_changed",
        group: "membership_access",
        label: "Public page settings changed",
        description: "Notify leaders when public tab visibility changes.",
        category: "projects",
        notificationKind: "project_public_surface_changed",
        defaultEnabled: false,
        defaultImportance: "more",
        defaultRecipients: ["owner", "co_leaders"],
        allowMemberOverride: true,
        mandatory: false,
        aggregate: "burst_10m",
        visible: true,
    }),
    "access.file_upload_permission_changed": E({
        key: "access.file_upload_permission_changed",
        group: "membership_access",
        label: "File upload permission changed",
        description: "Notify a member when their upload access is turned on or off.",
        category: "projects",
        notificationKind: "project_file_permission_changed",
        defaultEnabled: true,
        defaultImportance: "important",
        defaultRecipients: ["affected_member"],
        allowMemberOverride: false,
        mandatory: true,
        aggregate: "none",
        visible: true,
    }),
    "roles.created": E({
        key: "roles.created",
        group: "roles_applications",
        label: "Role created",
        description: "Notify members when a new open role is added.",
        category: "projects",
        notificationKind: "project_role_activity",
        defaultEnabled: false,
        defaultImportance: "more",
        defaultRecipients: ["members"],
        allowMemberOverride: true,
        mandatory: false,
        aggregate: "burst_10m",
        visible: true,
    }),
    "roles.updated": E({
        key: "roles.updated",
        group: "roles_applications",
        label: "Role updated",
        description: "Notify leaders when open role details or application routing changes.",
        category: "projects",
        notificationKind: "project_role_activity",
        defaultEnabled: false,
        defaultImportance: "more",
        defaultRecipients: ["owner", "co_leaders"],
        allowMemberOverride: true,
        mandatory: false,
        aggregate: "burst_10m",
        visible: true,
    }),
    "roles.closed": E({
        key: "roles.closed",
        group: "roles_applications",
        label: "Role closed or reopened",
        description: "Notify affected applicants and leaders when role intake changes.",
        category: "projects",
        notificationKind: "project_role_activity",
        defaultEnabled: true,
        defaultImportance: "more",
        defaultRecipients: ["owner", "co_leaders"],
        allowMemberOverride: true,
        mandatory: false,
        aggregate: "burst_10m",
        visible: true,
    }),
    "applications.received": E({
        key: "applications.received",
        group: "roles_applications",
        label: "Application received",
        description: "Notify the owner and admins when an application needs review.",
        category: "applications",
        notificationKind: "application_received",
        defaultEnabled: true,
        defaultImportance: "important",
        defaultRecipients: ["owner", "co_leaders"],
        allowMemberOverride: true,
        mandatory: false,
        aggregate: "none",
        visible: true,
    }),
    "applications.decision": E({
        key: "applications.decision",
        group: "roles_applications",
        label: "Application decision",
        description: "Notify the applicant when their application is accepted, declined, or reopened.",
        category: "applications",
        notificationKind: "application_decision",
        defaultEnabled: true,
        defaultImportance: "important",
        defaultRecipients: ["applicant"],
        allowMemberOverride: false,
        mandatory: true,
        aggregate: "none",
        visible: true,
    }),
    "applications.withdrawn": E({
        key: "applications.withdrawn",
        group: "roles_applications",
        label: "Application withdrawn",
        description: "Notify reviewers when an active application is withdrawn.",
        category: "applications",
        notificationKind: "project_application_activity",
        defaultEnabled: true,
        defaultImportance: "more",
        defaultRecipients: ["owner", "co_leaders", "reviewer"],
        allowMemberOverride: true,
        mandatory: false,
        aggregate: "none",
        visible: true,
    }),
    "applications.review_needed": E({
        key: "applications.review_needed",
        group: "roles_applications",
        label: "Application review needed",
        description: "Notify assigned reviewers when an application needs action.",
        category: "applications",
        notificationKind: "project_application_activity",
        defaultEnabled: true,
        defaultImportance: "important",
        defaultRecipients: ["reviewer"],
        allowMemberOverride: false,
        mandatory: true,
        aggregate: "none",
        visible: false,
    }),
    "sprints.created": E({
        key: "sprints.created",
        group: "project_lifecycle",
        label: "Sprint created",
        description: "Notify members when a new sprint is created.",
        category: "projects",
        notificationKind: "project_sprint_activity",
        defaultEnabled: true,
        defaultImportance: "more",
        defaultRecipients: ["members"],
        allowMemberOverride: true,
        mandatory: false,
        aggregate: "none",
        visible: true,
    }),
    "sprints.started": E({
        key: "sprints.started",
        group: "project_lifecycle",
        label: "Sprint started",
        description: "Notify members when a sprint becomes active.",
        category: "projects",
        notificationKind: "project_sprint_activity",
        defaultEnabled: true,
        defaultImportance: "more",
        defaultRecipients: ["members"],
        allowMemberOverride: true,
        mandatory: false,
        aggregate: "none",
        // A sprint is activated as part of creation; there is no separate
        // start action, so do not offer a preference that cannot fire.
        visible: false,
    }),
    "sprints.updated": E({
        key: "sprints.updated",
        group: "project_lifecycle",
        label: "Sprint updated",
        description: "Notify members about meaningful sprint edits.",
        category: "projects",
        notificationKind: "project_sprint_activity",
        defaultEnabled: false,
        defaultImportance: "more",
        defaultRecipients: ["members"],
        allowMemberOverride: true,
        mandatory: false,
        aggregate: "burst_10m",
        visible: true,
    }),
    "sprints.completed": E({
        key: "sprints.completed",
        group: "project_lifecycle",
        label: "Sprint completed",
        description: "Notify members when a sprint is completed.",
        category: "projects",
        notificationKind: "project_sprint_activity",
        defaultEnabled: true,
        defaultImportance: "more",
        defaultRecipients: ["members"],
        allowMemberOverride: true,
        mandatory: false,
        aggregate: "none",
        visible: true,
    }),
    "sprints.deleted": E({
        key: "sprints.deleted",
        group: "project_lifecycle",
        label: "Sprint deleted or canceled",
        description: "Notify leaders when a sprint is deleted or canceled.",
        category: "projects",
        notificationKind: "project_sprint_activity",
        defaultEnabled: true,
        defaultImportance: "more",
        defaultRecipients: ["owner", "co_leaders"],
        allowMemberOverride: true,
        mandatory: false,
        aggregate: "none",
        visible: true,
    }),
    "sprints.task_moved": E({
        key: "sprints.task_moved",
        group: "project_lifecycle",
        label: "Task moved in sprint",
        description: "Notify task participants when their task moves into or out of a sprint.",
        category: "tasks",
        notificationKind: "project_sprint_activity",
        defaultEnabled: false,
        defaultImportance: "more",
        defaultRecipients: ["task_participants"],
        allowMemberOverride: true,
        mandatory: false,
        aggregate: "burst_10m",
        visible: true,
    }),
    "tasks.created_assigned": E({
        key: "tasks.created_assigned",
        group: "tasks_workflow",
        label: "Task created with assignee",
        description: "Notify the assignee when a new task is created for them.",
        category: "tasks",
        notificationKind: "task_assigned",
        defaultEnabled: true,
        defaultImportance: "important",
        defaultRecipients: ["assignee"],
        allowMemberOverride: false,
        mandatory: true,
        aggregate: "none",
        visible: true,
    }),
    "tasks.assigned": E({
        key: "tasks.assigned",
        group: "tasks_workflow",
        label: "Task assigned or reassigned",
        description: "Notify the new assignee when task ownership changes.",
        category: "tasks",
        notificationKind: "task_assigned",
        defaultEnabled: true,
        defaultImportance: "important",
        defaultRecipients: ["assignee"],
        allowMemberOverride: false,
        mandatory: true,
        aggregate: "none",
        visible: true,
    }),
    "tasks.status_attention": E({
        key: "tasks.status_attention",
        group: "tasks_workflow",
        label: "Task completion, review, or status change",
        description: "Notify task participants about completion, review submissions, approvals and requested changes.",
        category: "tasks",
        notificationKind: "task_status_attention",
        defaultEnabled: true,
        defaultImportance: "important",
        defaultRecipients: ["task_participants"],
        allowMemberOverride: true,
        mandatory: false,
        aggregate: "none",
        visible: true,
    }),
    "tasks.mentions": E({
        key: "tasks.mentions",
        group: "tasks_workflow",
        label: "Task mention",
        description: "Notify directly mentioned users.",
        category: "mentions",
        notificationKind: "task_comment_mention",
        defaultEnabled: true,
        defaultImportance: "important",
        defaultRecipients: ["affected_member"],
        allowMemberOverride: false,
        mandatory: true,
        aggregate: "none",
        visible: true,
    }),
    "tasks.replies": E({
        key: "tasks.replies",
        group: "tasks_workflow",
        label: "Task reply",
        description: "Notify parent-comment participants about direct replies.",
        category: "mentions",
        notificationKind: "task_comment_reply",
        defaultEnabled: true,
        defaultImportance: "important",
        defaultRecipients: ["affected_member"],
        allowMemberOverride: true,
        mandatory: false,
        aggregate: "none",
        visible: true,
    }),
    "tasks.bulk_changed": E({
        key: "tasks.bulk_changed",
        group: "tasks_workflow",
        label: "Bulk task changes",
        description: "Bundle many task updates into one low-noise workspace notification.",
        category: "tasks",
        notificationKind: "project_task_activity",
        defaultEnabled: false,
        defaultImportance: "more",
        defaultRecipients: ["members"],
        allowMemberOverride: true,
        mandatory: false,
        aggregate: "burst_10m",
        // Bulk task editing is not an application capability yet.
        visible: false,
    }),
    "files.uploaded": E({
        key: "files.uploaded",
        group: "files_workspace",
        label: "File uploaded",
        description: "Notify members when a file is uploaded to the workspace.",
        category: "projects",
        notificationKind: "project_file_activity",
        defaultEnabled: true,
        defaultImportance: "more",
        defaultRecipients: ["members"],
        allowMemberOverride: true,
        mandatory: false,
        aggregate: "burst_10m",
        visible: true,
    }),
    "files.bulk_uploaded": E({
        key: "files.bulk_uploaded",
        group: "files_workspace",
        label: "Bulk files uploaded",
        description: "Bundle multiple uploaded files into one workspace notification.",
        category: "projects",
        notificationKind: "project_file_activity",
        defaultEnabled: true,
        defaultImportance: "more",
        defaultRecipients: ["members"],
        allowMemberOverride: true,
        mandatory: false,
        aggregate: "burst_10m",
        visible: true,
    }),
    "files.folder_created": E({
        key: "files.folder_created",
        group: "files_workspace",
        label: "Folder created",
        description: "Notify members when a new folder is created.",
        category: "projects",
        notificationKind: "project_file_activity",
        defaultEnabled: false,
        defaultImportance: "more",
        defaultRecipients: ["members"],
        allowMemberOverride: true,
        mandatory: false,
        aggregate: "burst_10m",
        visible: true,
    }),
    "files.version_added": E({
        key: "files.version_added",
        group: "files_workspace",
        label: "File version added",
        description: "Notify members or task participants when a file version changes.",
        category: "projects",
        notificationKind: "file_version_added",
        defaultEnabled: true,
        defaultImportance: "more",
        defaultRecipients: ["members"],
        allowMemberOverride: true,
        mandatory: false,
        aggregate: "burst_10m",
        visible: true,
    }),
    "files.replaced": E({
        key: "files.replaced",
        group: "files_workspace",
        label: "File replaced",
        description: "Notify task participants when a linked file is replaced.",
        category: "tasks",
        notificationKind: "task_file_replaced",
        defaultEnabled: true,
        defaultImportance: "more",
        defaultRecipients: ["task_participants"],
        allowMemberOverride: true,
        mandatory: false,
        aggregate: "none",
        visible: true,
    }),
    "files.review_requested": E({
        key: "files.review_requested",
        group: "files_workspace",
        label: "File review requested",
        description: "Notify reviewers or task participants when a file needs review.",
        category: "tasks",
        notificationKind: "task_file_needs_review",
        defaultEnabled: true,
        defaultImportance: "important",
        defaultRecipients: ["reviewer", "task_participants"],
        allowMemberOverride: false,
        mandatory: true,
        aggregate: "none",
        visible: true,
    }),
    "files.organized": E({
        key: "files.organized",
        group: "files_workspace",
        label: "File renamed or moved",
        description: "Notify members about file organization changes when enabled.",
        category: "projects",
        notificationKind: "project_file_activity",
        defaultEnabled: false,
        defaultImportance: "more",
        defaultRecipients: ["members"],
        allowMemberOverride: true,
        mandatory: false,
        aggregate: "burst_10m",
        visible: true,
    }),
    "files.deleted_restored": E({
        key: "files.deleted_restored",
        group: "files_workspace",
        label: "File deleted or restored",
        description: "Notify leaders when files are deleted or restored.",
        category: "projects",
        notificationKind: "project_file_activity",
        defaultEnabled: false,
        defaultImportance: "more",
        defaultRecipients: ["owner", "co_leaders"],
        allowMemberOverride: true,
        mandatory: false,
        aggregate: "burst_10m",
        visible: true,
    }),
    "files.git_sync_status": E({
        key: "files.git_sync_status",
        group: "files_workspace",
        label: "Repository sync finished or failed",
        description: "Notify leaders about repository sync results.",
        category: "projects",
        notificationKind: "project_file_activity",
        defaultEnabled: true,
        defaultImportance: "more",
        defaultRecipients: ["owner", "co_leaders"],
        allowMemberOverride: true,
        mandatory: false,
        aggregate: "burst_10m",
        visible: false,
    }),
    "security.protected_action": E({
        key: "security.protected_action",
        group: "security_audit",
        label: "An action needs your review",
        description: "Notify the owner and admins when an action needs review.",
        category: "projects",
        notificationKind: "project_security_alert",
        defaultEnabled: true,
        defaultImportance: "important",
        defaultRecipients: ["owner", "co_leaders"],
        allowMemberOverride: false,
        mandatory: true,
        aggregate: "none",
        visible: false,
    }),
    "security.data_export_ready": E({
        key: "security.data_export_ready",
        group: "security_audit",
        label: "Data export ready",
        description: "Notify the requester when a workspace data export is ready.",
        category: "projects",
        notificationKind: "project_security_alert",
        defaultEnabled: true,
        defaultImportance: "more",
        defaultRecipients: ["affected_member"],
        allowMemberOverride: true,
        mandatory: false,
        aggregate: "none",
        visible: false,
    }),
    "security.project_archived": E({
        key: "security.project_archived",
        group: "security_audit",
        label: "Workspace archived",
        description: "Notify members when the workspace is archived.",
        category: "projects",
        notificationKind: "project_security_alert",
        defaultEnabled: true,
        defaultImportance: "important",
        defaultRecipients: ["members"],
        allowMemberOverride: true,
        mandatory: false,
        aggregate: "none",
        visible: true,
    }),
    "security.delete_scheduled": E({
        key: "security.delete_scheduled",
        group: "security_audit",
        label: "Delete scheduled",
        description: "Notify the owner and admins when deletion is scheduled.",
        category: "projects",
        notificationKind: "project_security_alert",
        defaultEnabled: true,
        defaultImportance: "important",
        defaultRecipients: ["owner", "co_leaders"],
        allowMemberOverride: false,
        mandatory: true,
        aggregate: "none",
        visible: false,
    }),
    "readme.published": E({
        key: "readme.published",
        group: "readme",
        label: "Doc published",
        description: "Notify members when an admin publishes a Doc with Publish and notify.",
        category: "projects",
        notificationKind: "project_update_activity",
        // Org Docs' Publish & notify is the producer (report §19.3): an explicit admin action, members only.
        defaultEnabled: true,
        defaultImportance: "more",
        defaultRecipients: ["members"],
        allowMemberOverride: true,
        mandatory: false,
        aggregate: "none",
        visible: true,
    }),
    "readme.major_edited": E({
        key: "readme.major_edited",
        group: "readme",
        label: "Doc major edit",
        description: "Notify followers and members when the Doc receives a major update.",
        category: "projects",
        notificationKind: "project_update_activity",
        defaultEnabled: false,
        defaultImportance: "more",
        defaultRecipients: ["followers", "members"],
        allowMemberOverride: true,
        mandatory: false,
        aggregate: "digest_only",
        // Document edits are draft-only until a publish action; publish has
        // its own delivered notification and must not promise a duplicate.
        visible: false,
    }),
    "updates.published": E({
        key: "updates.published",
        group: "updates",
        label: "Workspace update published",
        description: "Notify followers and members when a workspace member publishes an update.",
        category: "projects",
        notificationKind: "project_update_activity",
        defaultEnabled: true,
        defaultImportance: "more",
        defaultRecipients: ["followers", "members"],
        allowMemberOverride: true,
        mandatory: false,
        aggregate: "none",
        visible: true,
    }),
    "updates.comment": E({
        key: "updates.comment",
        group: "updates",
        label: "Update comment",
        description: "Tell an update’s author about comments on it. Tray and push.",
        category: "mentions",
        notificationKind: "project_update_comment",
        defaultEnabled: true,
        defaultImportance: "important",
        defaultRecipients: ["affected_member"],
        allowMemberOverride: true,
        mandatory: false,
        aggregate: "none",
        visible: true,
    }),
    "updates.liked": E({
        key: "updates.liked",
        group: "updates",
        label: "Update liked",
        description: "Tell an update’s author when people like it, as one grouped row. Tray only.",
        category: "projects",
        notificationKind: "project_update_like",
        defaultEnabled: true,
        defaultImportance: "more",
        defaultRecipients: ["affected_member"],
        allowMemberOverride: true,
        mandatory: false,
        aggregate: "none",
        visible: true,
    }),
    "updates.reply": E({
        key: "updates.reply",
        group: "updates",
        label: "Reply to your comment",
        description: "Tell a commenter when someone replies to them. Tray and push.",
        category: "mentions",
        notificationKind: "project_update_reply",
        defaultEnabled: true,
        defaultImportance: "important",
        defaultRecipients: ["affected_member"],
        allowMemberOverride: true,
        mandatory: false,
        aggregate: "none",
        visible: true,
    }),
    "updates.mention": E({
        key: "updates.mention",
        group: "updates",
        label: "Mentioned in a comment",
        description: "Tell someone when a comment on an update mentions them. Tray and push.",
        category: "mentions",
        notificationKind: "project_update_mention",
        defaultEnabled: true,
        defaultImportance: "important",
        defaultRecipients: ["affected_member"],
        allowMemberOverride: true,
        mandatory: false,
        aggregate: "none",
        visible: true,
    }),
    "updates.comment_liked": E({
        key: "updates.comment_liked",
        group: "updates",
        label: "Comment liked",
        description: "Tell a commenter when people like their comment or reply, as one grouped row. Tray only.",
        category: "projects",
        notificationKind: "project_update_like",
        defaultEnabled: true,
        defaultImportance: "more",
        defaultRecipients: ["affected_member"],
        allowMemberOverride: true,
        mandatory: false,
        aggregate: "none",
        visible: true,
    }),
    "updates.team_activity": E({
        key: "updates.team_activity",
        group: "updates",
        label: "Activity on the team’s updates",
        description: "Tell the owner and team about likes, comments and replies, as one grouped row per post. Tray only.",
        category: "projects",
        notificationKind: "project_update_team",
        defaultEnabled: true,
        defaultImportance: "more",
        defaultRecipients: ["affected_member"],
        allowMemberOverride: true,
        mandatory: false,
        aggregate: "none",
        visible: true,
    }),
    "updates.follower_digest": E({
        key: "updates.follower_digest",
        group: "updates",
        label: "Follower summary",
        description: "Digest-ready trigger for grouped follower-facing workspace updates.",
        category: "projects",
        notificationKind: "project_update_activity",
        defaultEnabled: false,
        defaultImportance: "more",
        defaultRecipients: ["followers"],
        allowMemberOverride: true,
        mandatory: false,
        aggregate: "digest_only",
        // Digests require a scheduled delivery service; individual updates
        // already notify followers through updates.published.
        visible: false,
    }),
    "org.created": orgEvent("org.created", "org_membership", "Organization ready", "The owner hears that the organization is ready, with its join code.", "important", { recipients: ["owner"] }),
    "org.join_requested": orgEvent("org.join_requested", "org_membership", "Join requests", "Admins hear about requests to join, combined.", "important", { aggregate: "burst_10m", recipients: ["owner", "co_leaders"] }),
    "org.join_decided": orgEvent("org.join_decided", "org_membership", "Request approved or declined", "The person who asked hears the answer.", "important"),
    "org.invited": orgEvent("org.invited", "org_membership", "Invitations", "People with an account hear they were invited.", "important"),
    "org.member_joined": orgEvent("org.member_joined", "org_membership", "People joining", "Admins see people joining, combined.", "more", { aggregate: "burst_10m", recipients: ["owner", "co_leaders"] }),
    // Report §16.11 finding 23: leaving has its own setting.
    "org.member_left": orgEvent("org.member_left", "org_membership", "People leaving", "Admins see people leaving, combined.", "more", { aggregate: "burst_10m", recipients: ["owner", "co_leaders"] }),
    "org.role_changed": orgEvent("org.role_changed", "org_membership", "Role changed", "A member hears their new role.", "important"),
    "org.removed": orgEvent("org.removed", "org_membership", "Removed", "A member hears they were removed.", "important", { mandatory: true }),
    "org.child_added": orgEvent("org.child_added", "org_membership", "Added to a workspace", "A member hears they were added to a workspace in the organization.", "important"),
    "org.child_requests": orgEvent("org.child_requests", "org_membership", "Organization move requests", "Admins hear when a workspace asks to join or leave.", "important", { recipients: ["owner", "co_leaders"] }),
    "org.lifecycle": orgEvent("org.lifecycle", "org_membership", "Ended, reopened, deleted or new owner", "Members hear when the organization is archived, reopened, deleted, restored, suspended or changes owner.", "important", { mandatory: true }),
    "org.child_decided": orgEvent("org.child_decided", "org_membership", "Move-in and detach answers", "The workspace’s lead hears the answer.", "important"),
    "assignments.published": orgEvent("assignments.published", "org_assignments", "Assignment published", "Recipients hear about new work and its due date.", "important"),
    "assignments.submitted": orgEvent("assignments.submitted", "org_assignments", "Submissions", "Admins see new submissions, combined.", "more", { aggregate: "burst_10m", recipients: ["owner", "co_leaders"] }),
    "assignments.reviewed": orgEvent("assignments.reviewed", "org_assignments", "Returned or approved", "A member hears their work was returned or approved.", "important"),
    "assignments.due_changed": orgEvent("assignments.due_changed", "org_assignments", "Extended, excused or removed", "A member hears their due date changed, they were excused, or the work was removed.", "important"),
    "assignments.due_soon": orgEvent("assignments.due_soon", "org_assignments", "Due soon and overdue", "People who aren’t done hear once a day, at 9:00 their time.", "important"),
    // Report §30.4, decision 66: reminders and team moves are their own settings, apart from due date changes.
    "assignments.reminded": orgEvent("assignments.reminded", "org_assignments", "Reminders", "A member hears when an admin reminds them about open work.", "important"),
    // Report §23.5: a new class question reaches admins, combined; an answer an admin shares reaches everyone on it.
    "assignments.question_asked": orgEvent("assignments.question_asked", "org_assignments", "Class questions", "Admins hear new questions about an assignment, combined.", "more", { aggregate: "burst_10m", recipients: ["owner", "co_leaders"] }),
    "assignments.answer_shared": orgEvent("assignments.answer_shared", "org_assignments", "Shared answers", "Everyone on an assignment hears an answer an admin shares with them.", "important"),
    "org.team_changed": orgEvent("org.team_changed", "org_membership", "Team or group moves", "A member hears they were moved to another team or group.", "important"),
    "org.member_deleted": orgEvent("org.member_deleted", "org_membership", "Deleted accounts", "Admins hear when a member’s account is deleted, with how many submissions went.", "important", { recipients: ["owner", "co_leaders"] }),
    "announcements.posted": orgEvent("announcements.posted", "org_announcements", "Announcements", "Each announcement’s audience hears about it.", "important"),
    "credit.changed": orgEvent("credit.changed", "org_credit", "Verified or removed", "A member hears their role was verified or the verification removed.", "important"),
    "org.child_created": orgEvent("org.child_created", "org_membership", "Workspace created in the organization", "Admins hear when someone creates a workspace in the organization, combined.", "more", { aggregate: "burst_10m", recipients: ["owner", "co_leaders"] }),
    "org.code_changed": orgEvent("org.code_changed", "org_membership", "Join code changed", "Admins hear when someone makes a new join code.", "more", { recipients: ["owner", "co_leaders"] }),
    "org.child_notice": orgEvent("org.child_notice", "org_membership", "Your workspace", "Leads hear when a seat opens or an org rule changes their workspace.", "important"),
    "org_sprints.started": orgEvent("org_sprints.started", "org_sprints", "Sprint started", "Members hear when an org sprint starts, if Notify on start is on.", "important", { recipients: ["members"] }),
    "org_sprints.completed": orgEvent("org_sprints.completed", "org_sprints", "Sprint closed", "Members hear an org sprint closed and how much of it they finished.", "more"),
    "org_sprints.notice": orgEvent("org_sprints.notice", "org_sprints", "Sprint steps", "Leads hear to plan or close their linked sprint; admins hear a sprint couldn’t start.", "important"),
} as const satisfies Record<WorkspaceNotificationEventKey, WorkspaceNotificationRegistryEntry>;

export const WORKSPACE_NOTIFICATION_EVENT_KEYS = Object.keys(WORKSPACE_NOTIFICATION_EVENT_REGISTRY) as WorkspaceNotificationEventKey[];

export function isWorkspaceNotificationEventKey(value: unknown): value is WorkspaceNotificationEventKey {
    return typeof value === "string" && value in WORKSPACE_NOTIFICATION_EVENT_REGISTRY;
}

function defaultRuleFor(entry: WorkspaceNotificationRegistryEntry): WorkspaceNotificationRule {
    return {
        enabled: entry.mandatory ? true : entry.defaultEnabled,
        importance: entry.defaultImportance,
        aggregate: entry.aggregate,
    };
}

export function buildDefaultWorkspaceNotificationPolicy(preset: WorkspaceNotificationPreset = "balanced"): WorkspaceNotificationPolicy {
    const rules = {} as Record<WorkspaceNotificationEventKey, WorkspaceNotificationRule>;
    for (const key of WORKSPACE_NOTIFICATION_EVENT_KEYS) {
        const entry = WORKSPACE_NOTIFICATION_EVENT_REGISTRY[key];
        const rule = defaultRuleFor(entry);
        if (!entry.mandatory) {
            if (preset === "quiet" && entry.defaultImportance !== "important") rule.enabled = false;
            if (preset === "active" && entry.visible) rule.enabled = true;
        }
        rules[key] = rule;
    }
    return { version: 1, preset, rules };
}

function normalizePreset(value: unknown): WorkspaceNotificationPreset {
    return value === "quiet" || value === "active" || value === "balanced" ? value : "balanced";
}

function normalizeAggregate(value: unknown, fallback: WorkspaceNotificationAggregatePolicy): WorkspaceNotificationAggregatePolicy {
    return value === "none" || value === "burst_10m" || value === "digest_only" ? value : fallback;
}

export function normalizeWorkspaceNotificationPolicy(value: unknown): WorkspaceNotificationPolicy {
    const candidate = value && typeof value === "object" ? value as {
        preset?: unknown;
        rules?: Record<string, unknown>;
    } : {};
    const preset = normalizePreset(candidate.preset);
    const base = buildDefaultWorkspaceNotificationPolicy(preset);
    const rawRules = candidate.rules && typeof candidate.rules === "object" ? candidate.rules : {};
    for (const key of WORKSPACE_NOTIFICATION_EVENT_KEYS) {
        const entry = WORKSPACE_NOTIFICATION_EVENT_REGISTRY[key];
        const raw = rawRules[key];
        if (!raw || typeof raw !== "object") continue;
        const rawRule = raw as Partial<Record<keyof WorkspaceNotificationRule, unknown>>;
        base.rules[key] = {
            enabled: entry.mandatory ? true : typeof rawRule.enabled === "boolean" ? rawRule.enabled : base.rules[key].enabled,
            // Nobody can edit importance, so a stored copy is only an old default.
            importance: base.rules[key].importance,
            aggregate: normalizeAggregate(rawRule.aggregate, base.rules[key].aggregate ?? entry.aggregate),
        };
    }
    return base;
}

export function normalizeWorkspaceMemberNotificationOverrides(value: unknown): WorkspaceMemberNotificationOverrides {
    const candidate = value && typeof value === "object" ? value as {
        mode?: unknown;
        rules?: Record<string, unknown>;
    } : {};
    const mode = candidate.mode === "custom" ? "custom" : "inherit";
    const rules: WorkspaceMemberNotificationOverrides["rules"] = {};
    if (candidate.rules && typeof candidate.rules === "object") {
        for (const [key, enabled] of Object.entries(candidate.rules)) {
            if (!isWorkspaceNotificationEventKey(key)) continue;
            const entry = WORKSPACE_NOTIFICATION_EVENT_REGISTRY[key];
            if (entry.mandatory || !entry.allowMemberOverride) continue;
            if (typeof enabled === "boolean") rules[key] = enabled;
        }
    }
    return { version: 1, mode, rules };
}

export function resolveWorkspaceNotificationDecision(params: {
    eventKey: WorkspaceNotificationEventKey;
    projectPolicy: WorkspaceNotificationPolicy;
    memberOverrides?: WorkspaceMemberNotificationOverrides | null;
}) {
    const entry = WORKSPACE_NOTIFICATION_EVENT_REGISTRY[params.eventKey];
    const projectRule = params.projectPolicy.rules[params.eventKey] ?? defaultRuleFor(entry);
    if (entry.mandatory) {
        return { enabled: true, mandatory: true, rule: { ...projectRule, enabled: true } };
    }
    if (!projectRule.enabled) {
        return { enabled: false, mandatory: false, rule: projectRule, reason: "project_disabled" as const };
    }
    const overrides = params.memberOverrides;
    if (
        entry.allowMemberOverride &&
        overrides?.mode === "custom" &&
        typeof overrides.rules[params.eventKey] === "boolean" &&
        overrides.rules[params.eventKey] === false
    ) {
        return { enabled: false, mandatory: false, rule: projectRule, reason: "member_disabled" as const };
    }
    return { enabled: true, mandatory: false, rule: projectRule };
}

/** What one person hears about updates in one workspace (UP8). */
export type UpdateActivityLevel = "all" | "about_me" | "nothing";
const UPDATE_PERSONAL_EVENTS = ["updates.comment", "updates.reply", "updates.mention", "updates.liked", "updates.comment_liked"] as const;

export function updateActivityLevel(overrides: WorkspaceMemberNotificationOverrides): UpdateActivityLevel {
    if (overrides.mode !== "custom") return "all";
    if (UPDATE_PERSONAL_EVENTS.every((key) => overrides.rules[key] === false)) return "nothing";
    return overrides.rules["updates.team_activity"] === false ? "about_me" : "all";
}

export function withUpdateActivityLevel(overrides: WorkspaceMemberNotificationOverrides, level: UpdateActivityLevel): WorkspaceMemberNotificationOverrides {
    const rules = { ...overrides.rules, "updates.team_activity": level === "all" };
    for (const key of UPDATE_PERSONAL_EVENTS) rules[key] = level !== "nothing";
    return { ...overrides, mode: "custom", rules };
}

/** Org event groups show only for organizations; everything else is unchanged for projects. */
export function getVisibleWorkspaceNotificationEntries(isOrg = false) {
    return WORKSPACE_NOTIFICATION_EVENT_KEYS
        .map((key) => WORKSPACE_NOTIFICATION_EVENT_REGISTRY[key] as WorkspaceNotificationRegistryEntry)
        .filter((entry) => entry.visible && (isOrg || !ORG_GROUP_IDS.has(entry.group)));
}

export function groupWorkspaceNotificationEntries(entries = getVisibleWorkspaceNotificationEntries()) {
    // Groups in the same category (workspace and organization rules) show as one section.
    const sections = new Map<string, (typeof WORKSPACE_NOTIFICATION_GROUPS)[number] & { entries: typeof entries }>();
    for (const group of WORKSPACE_NOTIFICATION_GROUPS.filter((g) => g.visible)) {
        const own = entries.filter((entry) => entry.group === group.id);
        const section = sections.get(group.title);
        if (section) section.entries.push(...own);
        else sections.set(group.title, { ...group, entries: own });
    }
    const order = (title: string) => NOTIFICATION_CATEGORIES.findIndex((c) => c.label === title);
    return [...sections.values()].filter((group) => group.entries.length > 0).sort((x, y) => order(x.title) - order(y.title));
}

export function summarizeWorkspaceNotificationPolicy(policy: WorkspaceNotificationPolicy, isOrg = false) {
    const visible = getVisibleWorkspaceNotificationEntries(isOrg);
    const enabled = visible.filter((entry) => resolveWorkspaceNotificationDecision({ eventKey: entry.key, projectPolicy: policy }).enabled);
    const mandatory = visible.filter((entry) => entry.mandatory);
    return {
        visibleCount: visible.length,
        enabledCount: enabled.length,
        mandatoryCount: mandatory.length,
        optionalEnabledCount: enabled.filter((entry) => !entry.mandatory).length,
    };
}

/**
 * Create-project step 4 shows three plain switches over the real policy groups. Membership and
 * security stay on (mandatory events are never switched off). Switched-off rows disable the
 * non-mandatory events in their groups; switched-on rows keep the balanced defaults.
 */
export const CREATE_WORKSPACE_NOTIFICATION_ROWS = [
    { id: "roles_applications", label: "Roles and applications", description: "Applications, decisions, and role changes.", groups: ["roles_applications"] },
    { id: "work", label: "Tasks and workflow", description: "Assignments, lifecycle stages, and file reviews.", groups: ["tasks_workflow", "project_lifecycle", "files_workspace"] },
    { id: "updates_docs", label: "Updates and doc changes", description: "Progress posts and documentation publishing.", groups: ["updates", "readme"] },
] as const satisfies ReadonlyArray<{ id: string; label: string; description: string; groups: readonly WorkspaceNotificationGroupId[] }>;

export type CreateWorkspaceNotificationRowId = (typeof CREATE_WORKSPACE_NOTIFICATION_ROWS)[number]["id"];

export function buildCreateWorkspaceNotificationPolicy(
    rows: Partial<Record<CreateWorkspaceNotificationRowId, boolean>> | null | undefined,
): WorkspaceNotificationPolicy {
    const policy = buildDefaultWorkspaceNotificationPolicy("balanced");
    const offGroups = new Set<WorkspaceNotificationGroupId>(
        CREATE_WORKSPACE_NOTIFICATION_ROWS.filter((row) => rows?.[row.id] === false).flatMap((row) => row.groups),
    );
    for (const key of WORKSPACE_NOTIFICATION_EVENT_KEYS) {
        const entry = WORKSPACE_NOTIFICATION_EVENT_REGISTRY[key];
        if (!entry.mandatory && offGroups.has(entry.group)) policy.rules[key].enabled = false;
    }
    return policy;
}
