export type NotificationKind =
    | "chat_invite"
    | "chat_reminder"
    | "application_received"
    | "application_decision"
    | "connection_request_received"
    | "connection_request_accepted"
    | "task_assigned"
    | "task_reminder"
    | "task_status_attention"
    | "task_comment_mention"
    | "task_comment_reply"
    | "task_file_version"
    | "task_file_replaced"
    | "task_file_needs_review"
    | "file_version_added"
    | "project_role_changed"
    | "project_member_removed"
    | "project_ownership_transferred"
    | "project_member_joined"
    /** Member settings (0114): completed, reopened, left, the owner's decision, role requests. */
    | "project_member_journey"
    | "project_visibility_changed"
    | "project_public_surface_changed"
    | "project_file_permission_changed"
    | "project_role_activity"
    | "project_application_activity"
    | "project_sprint_activity"
    | "project_task_activity"
    | "project_file_activity"
    | "project_security_alert"
    | "project_update_activity"
    | "project_update_like"
    | "project_update_team"
    | "project_update_comment"
    | "project_update_reply"
    | "project_update_mention"
    | "org_membership"
    | "org_assignment"
    | "org_announcement"
    | "org_credit"
    /** Reports, decisions, restrictions and appeals (docs/trust-and-safety-concept.md). Always delivered. */
    | "trust_safety"
    /** An AI agent asks the person something (report §20.4, §26.4). Sent at once. */
    | "agent_question"
    /** An AI agent asks for a permission it wasn't given (report A5 "Asking for more"). Sent at once. */
    | "agent_access_request"
    /** An agent sign-in ends within 7 days (report A5 "Renewal notice"). Daily, deduplicated by its end date. */
    | "agent_access_expiring"
    /** One summary of what an agent session changed (report A11.6). */
    | "agent_session_summary"
    /** A task was finished with a report and is waiting for review (report A2.10). */
    | "task_report_submitted"
    /** A merge request event: review requested, ready, comment, approved, changes requested, checks failed, merged, closed (report H4). */
    | "merge_request"
    /** Saves on a branch, for its watchers: one per branch per 15 minutes (report H8, H24). */
    | "branch_saves"
    /** New matches for a search you saved (global search mix): daily or weekly, one a day at most. */
    | "saved_search_matches";

export type NotificationImportance = "important" | "more";

export type NotificationReason =
    | "mention"
    | "assigned"
    | "message"
    | "application"
    | "connection"
    | "blocked"
    | "done"
    | "workflow"
    | "file"
    | "update"
    | "safety";

export type NotificationPreferenceCategory =
    | "mentions"
    | "workflows"
    | "projects"
    | "tasks"
    | "applications"
    | "connections";

export type NotificationMuteScopeKind = "notification_type" | "project" | "task" | "update" | "person" | "organization";

export type NotificationMuteScope = {
    kind: NotificationMuteScopeKind;
    value: string;
    label?: string | null;
    mutedAt?: string | null;
    /** Mute for a while (member settings §2): after this time the mute no longer applies. Null = until turned back on. */
    until?: string | null;
};

export type NotificationQuietHours = {
    enabled: boolean;
    startMinute: number;
    endMinute: number;
    /** The IANA zone the hours are in (saved from the browser); without it, server time. */
    timeZone?: string | null;
};

export type NotificationDeliveryPreferences = {
    browser: boolean;
    push: boolean;
    email: boolean;
};

/** Messages push choices (Settings › Notifications › Messages). */
export type NotificationChatPreferences = {
    /** Push replies in threads you follow (mentions always push). */
    threadReplies: boolean;
    /** Show the message text in the push; off = "New message" only (privacy on a lock screen). */
    showPreview: boolean;
};

/** Personal Settings › Notifications › Organizations (report §26.8), per org id. */
export type OrgNotificationChoice = {
    level: "all" | "important" | "off";
    email: boolean;
    includeChildren: boolean;
};

export type NotificationPreferences = Record<NotificationPreferenceCategory, boolean> & {
    pausedUntil: string | null;
    mutedScopes: NotificationMuteScope[];
    quietHours: NotificationQuietHours;
    delivery: NotificationDeliveryPreferences;
    chat: NotificationChatPreferences;
    organizations: Record<string, OrgNotificationChoice>;
};

export type NotificationEntityRefs = {
    projectId?: string | null;
    /** The organization the event belongs to (the org itself or a child project's parent). */
    orgId?: string | null;
    projectSlug?: string | null;
    updateId?: string | null;
    taskId?: string | null;
    commentId?: string | null;
    invitationId?: string | null;
    channelId?: string | null;
    applicationId?: string | null;
    connectionId?: string | null;
    fileId?: string | null;
    sprintId?: string | null;
    roleId?: string | null;
    parentCommentId?: string | null;
    targetUserId?: string | null;
    previousRole?: string | null;
    nextRole?: string | null;
    status?: string | null;
    reviewStatus?: string | null;
    createdAt?: string | null;
    /** Grouped post rows: counting starts here, and these people already liked and unliked. */
    countSince?: string | null;
    unliked?: string[] | null;
};

export type NotificationPreview = {
    actorName?: string | null;
    actorAvatarUrl?: string | null;
    thumbnailUrl?: string | null;
    secondaryText?: string | null;
    contextLabel?: string | null;
    contextKind?: "project" | "task" | "connection" | "application" | "workflow" | "file" | null;
};

export type NotificationItem = {
    id: string;
    userId: string;
    actorUserId: string | null;
    kind: NotificationKind;
    importance: NotificationImportance;
    title: string;
    body: string | null;
    href: string | null;
    entityRefs: NotificationEntityRefs | null;
    preview: NotificationPreview | null;
    reason: NotificationReason;
    dedupeKey: string;
    aggregateCount: number;
    readAt: string | null;
    seenAt: string | null;
    dismissedAt: string | null;
    snoozedUntil: string | null;
    createdAt: string;
    /** Timestamp of the latest source event. Viewer actions never change it. */
    activityAt: string;
    updatedAt: string;
};

export type NotificationFeedPage = {
    items: NotificationItem[];
    nextCursor: string | null;
    hasMore: boolean;
    unreadCount: number;
    unreadImportantCount: number;
};

/** "reviews": merge requests waiting on you (report H23), not notifications. */
export type NotificationTrayFilter = "unread" | "all";

export type NotificationTimeGroup = "new" | "today" | "earlier";

export type NotificationFanoutInput = {
    recipientUserId: string;
    actorUserId?: string | null;
    kind: NotificationKind;
    category: NotificationPreferenceCategory;
    importance?: NotificationImportance;
    title: string;
    body?: string | null;
    href?: string | null;
    entityRefs?: NotificationEntityRefs | null;
    preview?: NotificationPreview | null;
    dedupeKey: string;
    aggregateCount?: number;
    /** aggregateCount is the whole count, recomputed by the caller, rather than a number to add. */
    exactCount?: boolean;
    /** Identity of the source event; an aggregate counts each (dedupeKey, sourceEventId) once, however often it is replayed (COR-016). */
    sourceEventId?: string | null;
    /**
     * An organization's or workspace's own notice (a role change, a reminder, assigned work): it still reaches someone
     * who blocked the person who acted, but from the place, without their name (Blocking B43 rule 2, B47).
     */
    placeNotice?: boolean;
    /** The place notice's own title, used instead of one that names the person who acted. */
    placeTitle?: string | null;
    /** An admin action against the recipient (removal, a role change, returned work): across a block it's recorded for trust and safety only (B49). */
    placeAction?: string | null;
};

export type NotificationFanoutWrite = {
    operation: "create" | "aggregate";
    input: NotificationFanoutInput;
};

export type NotificationFanoutEvent = {
    writes: NotificationFanoutWrite[];
    source?: string | null;
    traceId?: string | null;
    queuedAt?: string | null;
    retryAttempt?: number | null;
};
