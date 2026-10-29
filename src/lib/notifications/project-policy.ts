import type {
    NotificationImportance,
    NotificationKind,
    NotificationPreferenceCategory,
} from "@/lib/notifications/types";

export type ProjectNotificationPreset = "quiet" | "balanced" | "active";
export type ProjectNotificationGroupId =
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
export type ProjectNotificationRecipientGroup =
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
export type ProjectNotificationAggregatePolicy = "none" | "burst_10m" | "digest_only";

export type ProjectNotificationEventKey =
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
    | "updates.follower_digest"
    | OrgNotificationEventKey;

/** Organization events (report §26.3); they show only in an organization's settings. */
export type OrgNotificationEventKey =
    | "org.created"
    | "org.join_requested"
    | "org.join_decided"
    | "org.invited"
    | "org.member_joined"
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
    | "announcements.posted"
    | "credit.changed"
    | "org.code_changed"
    | "org.child_created"
    | "org.child_notice"
    | "org_sprints.started"
    | "org_sprints.completed"
    | "org_sprints.notice";

export type ProjectNotificationRule = {
    enabled: boolean;
    importance: NotificationImportance;
    aggregate?: ProjectNotificationAggregatePolicy;
};

export type ProjectNotificationPolicy = {
    version: 1;
    preset: ProjectNotificationPreset;
    rules: Record<ProjectNotificationEventKey, ProjectNotificationRule>;
};

export type ProjectMemberNotificationOverrides = {
    version: 1;
    mode: "inherit" | "custom";
    rules: Partial<Record<ProjectNotificationEventKey, boolean>>;
};

export type ProjectNotificationRegistryEntry = {
    key: ProjectNotificationEventKey;
    group: ProjectNotificationGroupId;
    label: string;
    description: string;
    category: NotificationPreferenceCategory;
    notificationKind: NotificationKind;
    defaultEnabled: boolean;
    defaultImportance: NotificationImportance;
    defaultRecipients: readonly ProjectNotificationRecipientGroup[];
    allowMemberOverride: boolean;
    mandatory: boolean;
    aggregate: ProjectNotificationAggregatePolicy;
    visible: boolean;
};

export const PROJECT_NOTIFICATION_GROUPS: Array<{
    id: ProjectNotificationGroupId;
    title: string;
    description: string;
    visible: boolean;
}> = [
    { id: "membership_access", title: "Membership and access", description: "Role, access, visibility, and membership changes.", visible: true },
    { id: "roles_applications", title: "Roles and applications", description: "Open roles, application intake, decisions, and review routing.", visible: true },
    { id: "project_lifecycle", title: "Project lifecycle", description: "Sprint and lifecycle changes that affect project momentum.", visible: true },
    { id: "tasks_workflow", title: "Tasks and workflow", description: "Assignments, mentions, status attention, and workflow responsibility.", visible: true },
    { id: "files_workspace", title: "Files and workspace", description: "Uploads, versions, reviews, organization, and sync status.", visible: true },
    { id: "readme", title: "Doc", description: "Documentation publishing and major documentation changes.", visible: true },
    { id: "updates", title: "Updates", description: "Project progress posts, follower notifications, and update discussions.", visible: true },
    { id: "security_audit", title: "Security and audit", description: "Protected actions, exports, archive/delete, and access-sensitive events.", visible: true },
    { id: "future", title: "Future surfaces", description: "Updates and follower digest triggers hidden until enforceable.", visible: false },
    { id: "org_membership", title: "Organization", description: "Join requests, invitations, access changes and removals.", visible: true },
    { id: "org_assignments", title: "Assignments", description: "Published work, submissions, reviews and due dates.", visible: true },
    { id: "org_announcements", title: "Announcements", description: "Announcements for each post’s audience.", visible: true },
    { id: "org_credit", title: "Profile credit", description: "Verified roles and removed verification.", visible: true },
    { id: "org_sprints", title: "Sprints", description: "Org sprints starting and closing, and sprint steps for leads and admins.", visible: true },
];

const ORG_GROUP_IDS = new Set<ProjectNotificationGroupId>(["org_membership", "org_assignments", "org_announcements", "org_credit", "org_sprints"]);

const ORG_KIND: Record<string, NotificationKind> = { org_membership: "org_membership", org_assignments: "org_assignment", org_announcements: "org_announcement", org_credit: "org_credit", org_sprints: "project_sprint_activity" };

/** One line per org event: recipients are chosen by the trigger, so defaultRecipients only labels them. */
const orgEvent = (key: OrgNotificationEventKey, group: ProjectNotificationGroupId, label: string, description: string,
    importance: NotificationImportance, opts: { aggregate?: ProjectNotificationAggregatePolicy; mandatory?: boolean; recipients?: ProjectNotificationRecipientGroup[] } = {}): ProjectNotificationRegistryEntry => ({
    key, group, label, description,
    category: group === "org_assignments" ? "tasks" : "projects",
    notificationKind: ORG_KIND[group]!,
    defaultEnabled: true, defaultImportance: importance,
    defaultRecipients: opts.recipients ?? ["affected_member"],
    allowMemberOverride: !opts.mandatory, mandatory: Boolean(opts.mandatory),
    aggregate: opts.aggregate ?? "none", visible: true,
});

const E = (entry: ProjectNotificationRegistryEntry) => entry;

export const PROJECT_NOTIFICATION_EVENT_REGISTRY = {
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
        description: "Notify the affected member when their project role changes.",
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
        description: "Notify previous and new owner when project ownership changes.",
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
        description: "Notify members when a project becomes public or private.",
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
        label: "Public surfaces changed",
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
        description: "Notify the applicant when their application is accepted, rejected, or reopened.",
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
        label: "Sprint deleted or cancelled",
        description: "Notify leaders when a sprint is deleted or cancelled.",
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
        description: "Bundle many task updates into one low-noise project notification.",
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
        description: "Notify members when a file is uploaded to the project workspace.",
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
        description: "Notify members when a new workspace folder is created.",
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
        label: "Git sync completed or failed",
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
        label: "Protected action failed",
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
        description: "Notify the requester when a project data export is ready.",
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
        description: "Notify members when the project is archived.",
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
        label: "Project update published",
        description: "Notify followers and members when a project member publishes an update.",
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
        description: "Notify an update author when someone comments on their project update.",
        category: "mentions",
        notificationKind: "project_update_activity",
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
        label: "Follower digest",
        description: "Digest-ready trigger for grouped follower-facing project updates.",
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
    "org.member_joined": orgEvent("org.member_joined", "org_membership", "Joins and leaves", "Admins see people joining and leaving, combined.", "more", { aggregate: "burst_10m", recipients: ["owner", "co_leaders"] }),
    "org.role_changed": orgEvent("org.role_changed", "org_membership", "Role changed", "A member hears their new role.", "important"),
    "org.removed": orgEvent("org.removed", "org_membership", "Removed", "A member hears they were removed.", "important", { mandatory: true }),
    "org.child_added": orgEvent("org.child_added", "org_membership", "Added to a project", "A member hears they were added to a workspace in the organization.", "important"),
    "org.child_requests": orgEvent("org.child_requests", "org_membership", "Move-in and detach requests", "Admins hear when a project asks to join or leave.", "important", { recipients: ["owner", "co_leaders"] }),
    "org.lifecycle": orgEvent("org.lifecycle", "org_membership", "Ended, reopened, deleted or new owner", "Members hear when the organization is archived, reopened, deleted, restored, suspended or changes owner.", "important", { mandatory: true }),
    "org.child_decided": orgEvent("org.child_decided", "org_membership", "Move-in and detach answers", "The project’s lead hears the answer.", "important"),
    "assignments.published": orgEvent("assignments.published", "org_assignments", "Assignment published", "Recipients hear about new work and its due date.", "important"),
    "assignments.submitted": orgEvent("assignments.submitted", "org_assignments", "Submissions", "Admins see new submissions, combined.", "more", { aggregate: "burst_10m", recipients: ["owner", "co_leaders"] }),
    "assignments.reviewed": orgEvent("assignments.reviewed", "org_assignments", "Returned or approved", "A member hears their work was returned or approved.", "important"),
    "assignments.due_changed": orgEvent("assignments.due_changed", "org_assignments", "Extended or excused", "A member hears their due date changed or they were excused.", "important"),
    "assignments.due_soon": orgEvent("assignments.due_soon", "org_assignments", "Due soon and overdue", "People who aren’t done hear once a day, at 9:00 their time.", "important"),
    "announcements.posted": orgEvent("announcements.posted", "org_announcements", "Announcements", "Each announcement’s audience hears about it.", "important"),
    "credit.changed": orgEvent("credit.changed", "org_credit", "Verified or removed", "A member hears their role was verified or the verification removed.", "important"),
    "org.child_created": orgEvent("org.child_created", "org_membership", "Workspace created in the organization", "Admins hear when someone creates a project in the organization, combined.", "more", { aggregate: "burst_10m", recipients: ["owner", "co_leaders"] }),
    "org.code_changed": orgEvent("org.code_changed", "org_membership", "Join code changed", "Admins hear when someone makes a new join code.", "more", { recipients: ["owner", "co_leaders"] }),
    "org.child_notice": orgEvent("org.child_notice", "org_membership", "Your workspace", "Leads hear when a seat opens or an org rule changes their project.", "important"),
    "org_sprints.started": orgEvent("org_sprints.started", "org_sprints", "Sprint started", "Members hear when an org sprint starts, if Notify on start is on.", "important", { recipients: ["members"] }),
    "org_sprints.completed": orgEvent("org_sprints.completed", "org_sprints", "Sprint closed", "Members hear an org sprint closed and how much of it they finished.", "more"),
    "org_sprints.notice": orgEvent("org_sprints.notice", "org_sprints", "Sprint steps", "Leads hear to plan or close their linked sprint; admins hear a sprint couldn’t start.", "important"),
} as const satisfies Record<ProjectNotificationEventKey, ProjectNotificationRegistryEntry>;

export const PROJECT_NOTIFICATION_EVENT_KEYS = Object.keys(PROJECT_NOTIFICATION_EVENT_REGISTRY) as ProjectNotificationEventKey[];

export function isProjectNotificationEventKey(value: unknown): value is ProjectNotificationEventKey {
    return typeof value === "string" && value in PROJECT_NOTIFICATION_EVENT_REGISTRY;
}

function defaultRuleFor(entry: ProjectNotificationRegistryEntry): ProjectNotificationRule {
    return {
        enabled: entry.mandatory ? true : entry.defaultEnabled,
        importance: entry.defaultImportance,
        aggregate: entry.aggregate,
    };
}

export function buildDefaultProjectNotificationPolicy(preset: ProjectNotificationPreset = "balanced"): ProjectNotificationPolicy {
    const rules = {} as Record<ProjectNotificationEventKey, ProjectNotificationRule>;
    for (const key of PROJECT_NOTIFICATION_EVENT_KEYS) {
        const entry = PROJECT_NOTIFICATION_EVENT_REGISTRY[key];
        const rule = defaultRuleFor(entry);
        if (!entry.mandatory) {
            if (preset === "quiet" && entry.defaultImportance !== "important") rule.enabled = false;
            if (preset === "active" && entry.visible) rule.enabled = true;
        }
        rules[key] = rule;
    }
    return { version: 1, preset, rules };
}

function normalizePreset(value: unknown): ProjectNotificationPreset {
    return value === "quiet" || value === "active" || value === "balanced" ? value : "balanced";
}

function normalizeImportance(value: unknown, fallback: NotificationImportance): NotificationImportance {
    return value === "important" || value === "more" ? value : fallback;
}

function normalizeAggregate(value: unknown, fallback: ProjectNotificationAggregatePolicy): ProjectNotificationAggregatePolicy {
    return value === "none" || value === "burst_10m" || value === "digest_only" ? value : fallback;
}

export function normalizeProjectNotificationPolicy(value: unknown): ProjectNotificationPolicy {
    const candidate = value && typeof value === "object" ? value as {
        preset?: unknown;
        rules?: Record<string, unknown>;
    } : {};
    const preset = normalizePreset(candidate.preset);
    const base = buildDefaultProjectNotificationPolicy(preset);
    const rawRules = candidate.rules && typeof candidate.rules === "object" ? candidate.rules : {};
    for (const key of PROJECT_NOTIFICATION_EVENT_KEYS) {
        const entry = PROJECT_NOTIFICATION_EVENT_REGISTRY[key];
        const raw = rawRules[key];
        if (!raw || typeof raw !== "object") continue;
        const rawRule = raw as Partial<Record<keyof ProjectNotificationRule, unknown>>;
        base.rules[key] = {
            enabled: entry.mandatory ? true : typeof rawRule.enabled === "boolean" ? rawRule.enabled : base.rules[key].enabled,
            importance: normalizeImportance(rawRule.importance, base.rules[key].importance),
            aggregate: normalizeAggregate(rawRule.aggregate, base.rules[key].aggregate ?? entry.aggregate),
        };
    }
    return base;
}

export function normalizeProjectMemberNotificationOverrides(value: unknown): ProjectMemberNotificationOverrides {
    const candidate = value && typeof value === "object" ? value as {
        mode?: unknown;
        rules?: Record<string, unknown>;
    } : {};
    const mode = candidate.mode === "custom" ? "custom" : "inherit";
    const rules: ProjectMemberNotificationOverrides["rules"] = {};
    if (candidate.rules && typeof candidate.rules === "object") {
        for (const [key, enabled] of Object.entries(candidate.rules)) {
            if (!isProjectNotificationEventKey(key)) continue;
            const entry = PROJECT_NOTIFICATION_EVENT_REGISTRY[key];
            if (entry.mandatory || !entry.allowMemberOverride) continue;
            if (typeof enabled === "boolean") rules[key] = enabled;
        }
    }
    return { version: 1, mode, rules };
}

export function resolveProjectNotificationDecision(params: {
    eventKey: ProjectNotificationEventKey;
    projectPolicy: ProjectNotificationPolicy;
    memberOverrides?: ProjectMemberNotificationOverrides | null;
}) {
    const entry = PROJECT_NOTIFICATION_EVENT_REGISTRY[params.eventKey];
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

/** Org event groups show only for organizations; everything else is unchanged for projects. */
export function getVisibleProjectNotificationEntries(isOrg = false) {
    return PROJECT_NOTIFICATION_EVENT_KEYS
        .map((key) => PROJECT_NOTIFICATION_EVENT_REGISTRY[key] as ProjectNotificationRegistryEntry)
        .filter((entry) => entry.visible && (isOrg || !ORG_GROUP_IDS.has(entry.group)));
}

export function groupProjectNotificationEntries(entries = getVisibleProjectNotificationEntries()) {
    return PROJECT_NOTIFICATION_GROUPS
        .filter((group) => group.visible)
        .map((group) => ({
            ...group,
            entries: entries.filter((entry) => entry.group === group.id),
        }))
        .filter((group) => group.entries.length > 0);
}

export function summarizeProjectNotificationPolicy(policy: ProjectNotificationPolicy, isOrg = false) {
    const visible = getVisibleProjectNotificationEntries(isOrg);
    const enabled = visible.filter((entry) => resolveProjectNotificationDecision({ eventKey: entry.key, projectPolicy: policy }).enabled);
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
export const CREATE_PROJECT_NOTIFICATION_ROWS = [
    { id: "roles_applications", label: "Roles and applications", description: "Applications, decisions, and role changes.", groups: ["roles_applications"] },
    { id: "work", label: "Tasks and workflow", description: "Assignments, lifecycle stages, and file reviews.", groups: ["tasks_workflow", "project_lifecycle", "files_workspace"] },
    { id: "updates_docs", label: "Updates and doc changes", description: "Progress posts and documentation publishing.", groups: ["updates", "readme"] },
] as const satisfies ReadonlyArray<{ id: string; label: string; description: string; groups: readonly ProjectNotificationGroupId[] }>;

export type CreateProjectNotificationRowId = (typeof CREATE_PROJECT_NOTIFICATION_ROWS)[number]["id"];

export function buildCreateProjectNotificationPolicy(
    rows: Partial<Record<CreateProjectNotificationRowId, boolean>> | null | undefined,
): ProjectNotificationPolicy {
    const policy = buildDefaultProjectNotificationPolicy("balanced");
    const offGroups = new Set<ProjectNotificationGroupId>(
        CREATE_PROJECT_NOTIFICATION_ROWS.filter((row) => rows?.[row.id] === false).flatMap((row) => row.groups),
    );
    for (const key of PROJECT_NOTIFICATION_EVENT_KEYS) {
        const entry = PROJECT_NOTIFICATION_EVENT_REGISTRY[key];
        if (!entry.mandatory && offGroups.has(entry.group)) policy.rules[key].enabled = false;
    }
    return policy;
}
