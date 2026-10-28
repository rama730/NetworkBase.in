import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  boolean,
  jsonb,
  index,
  uniqueIndex,
  integer,
  bigint,
  smallint,
  foreignKey,
  primaryKey,
  check,
  unique,
  customType,
  doublePrecision,
  date,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import type { SyncManifest, SyncResult, SyncStatus } from "@/lib/github/sync-contract";
import type { EmailKind, EmailPayload, EmailDeliveryState } from "@/lib/email/contracts";
const tsvector = customType<{ data: string }>({
  dataType: () => "tsvector",
});

type ProfileExperienceEntry = Record<string, unknown>;
type ProfileEducationEntry = Record<string, unknown>;
type ImportSourceMetadata = Record<string, unknown>;
type ProjectPublicTabVisibility = {
  dashboard: boolean;
  readme: boolean;
  updates: boolean;
  files: boolean;
  sprints: boolean;
  tasks: boolean;
};
type ProjectUpdateEntityRefs = {
  taskId?: string | null;
  sprintId?: string | null;
  fileId?: string | null;
  readmeVersionId?: string | null;
  roleId?: string | null;
  milestoneId?: string | null;
};
type ProjectUpdateMediaItem = {
  type: "image" | "file" | "link";
  url?: string | null;
  label?: string | null;
  mimeType?: string | null;
  size?: number | null;
};
type ProjectNotificationPreferencesRecord = Record<string, unknown>;
type ProjectMemberNotificationPreferencesRecord = Record<string, unknown>;
type ProjectDocHeadingRecord = {
  id: string;
  level: number;
  text: string;
};
type ProjectDocQualityRecord = Record<string, unknown>;
type NotificationPreferencesRecord = {
  /** Legacy key from the old chat; still in the column default, ignored by normalization. */
  messages?: boolean;
  mentions: boolean;
  workflows: boolean;
  projects: boolean;
  tasks: boolean;
  applications: boolean;
  connections: boolean;
  pausedUntil?: string | null;
  mutedScopes?: Array<{
    kind: "notification_type" | "project" | "task" | "person" | "organization";
    value: string;
    label?: string | null;
    mutedAt?: string | null;
  }>;
};
type UserNotificationEntityRefs = {
  projectId?: string | null;
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
  status?: string | null;
};
type UserNotificationPreview = {
  actorName?: string | null;
  actorAvatarUrl?: string | null;
  thumbnailUrl?: string | null;
  secondaryText?: string | null;
  contextLabel?: string | null;
  contextKind?:
    | "project"
    | "task"
    | "conversation"
    | "connection"
    | "application"
    | "workflow"
    | "file"
    | null;
};
type MessageWorkLinkMetadata = Record<string, unknown>;

// ============================================================================
// ENUMS
// ============================================================================
export const statusJobEnum = pgEnum("status_job", [
  "processing",
  "completed",
  "failed",
]);
export const statusConnectionEnum = pgEnum("status_connection", [
  "pending",
  "accepted",
  "rejected",
  "cancelled",
  "disconnected",
  "blocked",
]);
export const statusProjectEnum = pgEnum("status_project", [
  "draft",
  "active",
  "completed",
  "archived",
]);
export const statusRoleApplicationEnum = pgEnum("status_role_application", [
  "pending",
  "accepted",
  "rejected",
  "withdrawn",
  "proposed",
]);
export const statusSprintEnum = pgEnum("status_sprint", [
  "planning",
  "active",
  "completed",
  "archived",
  "cancelled",
]);
export const statusTaskEnum = pgEnum("status_task", [
  "todo",
  "in_progress",
  "done",
  "blocked",
]);
export const statusNotificationEnum = pgEnum("status_notification", [
  "delivered",
  "failed",
  "dropped",
]);
export const statusFileEnum = pgEnum("status_file", [
  "pending",
  "finalized",
  "expired",
  "failed",
]);

// ============================================================================
// PROFILES TABLE
// ============================================================================
export const profiles = pgTable(
  "profiles",
  {
    id: uuid("id").primaryKey(), // References auth.users.id
    email: text("email").notNull().unique(),
    username: text("username").unique(),
    fullName: text("full_name"),
    avatarUrl: text("avatar_url"),
    bannerUrl: text("banner_url"),
    avatarAssetId: uuid("avatar_asset_id").references(
      (): AnyPgColumn => storageAssets.id,
      { onDelete: "set null" },
    ),
    bannerAssetId: uuid("banner_asset_id").references(
      (): AnyPgColumn => storageAssets.id,
      { onDelete: "set null" },
    ),
    bio: text("bio"),
    headline: text("headline"),
    location: text("location"),
    website: text("website"),
    skills: jsonb("skills").$type<string[]>().default([]),
    interests: jsonb("interests").$type<string[]>().default([]),
    experience: jsonb("experience")
      .$type<ProfileExperienceEntry[]>()
      .default([]),
    education: jsonb("education").$type<ProfileEducationEntry[]>().default([]),
    openTo: jsonb("open_to").$type<string[]>().default([]),
    openToCollaborate: boolean("open_to_collaborate").default(false).notNull(),
    // Legacy records and the ordered V2 item list share this JSONB column.
    // Existing rows remain readable; owners are upgraded on their next save.
    socialLinks: jsonb("social_links")
      .$type<import("@/lib/profile/normalization").SocialLinkStorage>()
      .default({}),
    socialLinkMetadata: jsonb("social_link_metadata")
      .$type<
        Record<
          string,
          { health: "unknown" | "active" | "unavailable"; checkedAt?: string }
        >
      >()
      .default({})
      .notNull(),
    experienceLevel: text("experience_level", {
      enum: ["student", "junior", "mid", "senior", "lead", "founder"],
    }),
    hoursPerWeek: text("hours_per_week", {
      enum: ["lt_5", "h_5_10", "h_10_20", "h_20_40", "h_40_plus"],
    }),
    genderIdentity: text("gender_identity", {
      enum: ["male", "female", "non_binary", "prefer_not_to_say", "other"],
    }),
    pronouns: text("pronouns"),
    visibility: text("visibility", {
      enum: ["public", "connections", "private"],
    }).default("public"),
    messagePrivacy: text("message_privacy", {
      enum: ["everyone", "connections"],
    }).default("connections"),
    connectionPrivacy: text("connection_privacy", {
      enum: ["everyone", "mutuals_only", "nobody"],
    }).default("everyone"),
    onboardingStatus: text("onboarding_status", {
      enum: ["not_started", "in_progress", "completed"],
    })
      .default("not_started")
      .notNull(),
    onboardingCompletedAt: timestamp("onboarding_completed_at", {
      withTimezone: true,
    }),
    onboardingVersion: integer("onboarding_version").default(1).notNull(),
    notificationPreferences: jsonb("notification_preferences")
      .$type<NotificationPreferencesRecord>()
      .default({
        messages: true,
        mentions: true,
        workflows: true,
        projects: true,
        tasks: true,
        applications: true,
        connections: true,
        pausedUntil: null,
        mutedScopes: [],
      }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    // Workspace dashboard layout customization (JSONB, NULL = default layout)
    workspaceLayout: jsonb("workspace_layout")
      .$type<{
        version: number;
        widgets: Array<{
          widgetId: string;
          col: number;
          row: number;
          colSpan: number;
          rowSpan: number;
        }>;
        quickNotes?: {
          content: string;
          updatedAt: string;
        };
        pins?: Array<{
          type: "task" | "project";
          id: string;
          title: string;
          projectSlug?: string | null;
          projectKey?: string | null;
          taskNumber?: number | null;
          projectId?: string;
        }>;
      } | null>()
      .default(null),
    // Pure Optimization: Denormalized counts for 1M+ Users Scalability
    connectionsCount: integer("connections_count").default(0).notNull(),
    projectsCount: integer("projects_count").default(0).notNull(),
    followersCount: integer("followers_count").default(0).notNull(),
    workspaceInboxCount: integer("workspace_inbox_count").default(0).notNull(),
    workspaceDueTodayCount: integer("workspace_due_today_count")
      .default(0)
      .notNull(),
    workspaceOverdueCount: integer("workspace_overdue_count")
      .default(0)
      .notNull(),
    workspaceInProgressCount: integer("workspace_in_progress_count")
      .default(0)
      .notNull(),
    // Last activity timestamp (debounced, updated at most every 5 minutes via Redis guard)
    lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
    // Presence (0184). Not granted to browsers; read via app/actions/presence.ts.
    showActivity: boolean("show_activity").default(true).notNull(),
    statusEmoji: text("status_emoji"),
    statusText: text("status_text"),
    statusExpiresAt: timestamp("status_expires_at", { withTimezone: true }),
    statusSetAt: timestamp("status_set_at", { withTimezone: true }),
    statusPausesNotifications: boolean("status_pauses_notifications").default(false).notNull(),
    statusVisibility: text("status_visibility", { enum: ["everyone", "network", "team"] }).default("network").notNull(),
    openToCustomRoles: text("open_to_custom_roles")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    preferredCategories: text("preferred_categories")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
  },
  (t) => ({
    // Optimize lookups by email (auth)
    // Optimization: GIN Index for fast skill matching (1M Users Scalability)
    skillsIdx: index("profiles_skills_idx").using("gin", t.skills),
    customRolesGinIdx: index("profiles_custom_roles_gin_idx").using(
      "gin",
      t.openToCustomRoles,
    ),
    interestsIdx: index("profiles_interests_idx").using("gin", t.interests),
    // Optimization: Sort Index for ISR (Profile Page Optimization)
    createdAtIdx: index("profiles_created_at_idx").on(t.createdAt),
    // Optimization: GIN Index for fast user search (Connections Optimization)
    usernameSearchIdx: index("profiles_username_search_idx").using(
      "gin",
      sql`${t.username} gin_trgm_ops`,
    ),
    fullNameSearchIdx: index("profiles_full_name_search_idx").using(
      "gin",
      sql`${t.fullName} gin_trgm_ops`,
    ),
    // Optimization: Performance indices for stats sorting (Leaderboards/Popularity)
    connectionsCountIdx: index("profiles_connections_count_idx").on(
      t.connectionsCount,
    ),
    projectsCountIdx: index("profiles_projects_count_idx").on(t.projectsCount),
    // Index for "Active today/this week" filtering in discover
    lastActiveAtIdx: index("profiles_last_active_at_idx").on(t.lastActiveAt),
    avatarAssetIdx: index("profiles_avatar_asset_idx").on(t.avatarAssetId),
    bannerAssetIdx: index("profiles_banner_asset_idx").on(t.bannerAssetId),
    onboardingStatusIdx: index("profiles_onboarding_status_idx").on(
      t.onboardingStatus,
      t.updatedAt,
    ),
  }),
);

export const profileSecurityStates = pgTable(
  "profile_security_states",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => profiles.id, { onDelete: "cascade" }),
    securityRecoveryCodes: jsonb("security_recovery_codes")
      .$type<
        Array<{
          id: string;
          salt: string;
          hash: string;
          usedAt: string | null;
        }>
      >()
      .default([])
      .notNull(),
    recoveryCodesGeneratedAt: timestamp("recovery_codes_generated_at", {
      withTimezone: true,
    }),
    // SEC-H3: bind the stored recovery codes to the TOTP factor that was
    // verified when they were issued. On redemption we verify the factor is
    // still present; rotating the TOTP factor therefore invalidates any
    // codes a past attacker may have exfiltrated.
    recoveryCodesFactorId: text("recovery_codes_factor_id"),
    // Monotonic counter bumped on any MFA factor change so codes from a
    // prior generation can be rejected even if the factor ID is unknown.
    recoveryCodesGeneration: integer("recovery_codes_generation")
      .default(0)
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    generatedAtIdx: index("profile_security_states_generated_at_idx").on(
      t.recoveryCodesGeneratedAt,
    ),
  }),
);

export const reservedUsernames = pgTable("reserved_usernames", {
  username: text("username").primaryKey(),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const usernameAliases = pgTable(
  "username_aliases",
  {
    username: text("username").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    isPrimary: boolean("is_primary").default(false).notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    replacedAt: timestamp("replaced_at", { withTimezone: true }),
  },
  (t) => ({
    userPrimaryIdx: index("username_aliases_user_primary_idx").on(
      t.userId,
      t.isPrimary,
    ),
    userClaimedAtIdx: index("username_aliases_user_claimed_at_idx").on(
      t.userId,
      t.claimedAt,
    ),
    uniquePrimaryIdx: uniqueIndex("username_aliases_user_primary_unique_idx")
      .on(t.userId)
      .where(sql`${t.isPrimary} = true`),
  }),
);

export const profileAuditEvents = pgTable(
  "profile_audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => profiles.id, {
      onDelete: "set null",
    }),
    eventType: text("event_type").notNull(),
    previousValue: jsonb("previous_value")
      .$type<Record<string, unknown> | null>()
      .default(null),
    nextValue: jsonb("next_value")
      .$type<Record<string, unknown> | null>()
      .default(null),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    storyRequestUnique: uniqueIndex("profile_audit_events_story_request_unique").on(t.userId,sql`(${t.metadata}->>'requestId')`).where(sql`${t.eventType} = 'contribution_story_saved'`),
    userEventIdx: index("profile_audit_events_user_event_idx").on(
      t.userId,
      t.eventType,
      t.createdAt,
    ),
    userCreatedIdx: index("profile_audit_events_user_created_idx").on(
      t.userId,
      t.createdAt,
    ),
    retentionIdx: index("profile_audit_events_retention_idx").on(
      t.createdAt,
      t.id,
    ),
  }),
);

export const onboardingDrafts = pgTable(
  "onboarding_drafts",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => profiles.id, { onDelete: "cascade" }),
    step: integer("step").default(1).notNull(),
    completedThrough: integer("completed_through").default(0).notNull(),
    activeSection: text("active_section").default("identity").notNull(),
    version: integer("version").default(1).notNull(),
    schemaVersion: integer("schema_version").default(3).notNull(),
    draft: jsonb("draft")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true })
      .default(sql`now() + interval '30 days'`)
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    updatedAtIdx: index("onboarding_drafts_updated_at_idx").on(t.updatedAt),
    expiresAtIdx: index("onboarding_drafts_expires_at_idx").on(t.expiresAt),
  }),
);

export const onboardingEvents = pgTable(
  "onboarding_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => profiles.id, {
      onDelete: "set null",
    }),
    eventType: text("event_type").notNull(),
    step: integer("step"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    userIdx: index("onboarding_events_user_idx").on(t.userId, t.createdAt),
    eventIdx: index("onboarding_events_event_idx").on(t.eventType, t.createdAt),
    retentionIdx: index("onboarding_events_retention_idx").on(t.createdAt, t.id),
  }),
);

export const onboardingSubmissions = pgTable(
  "onboarding_submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    idempotencyKey: text("idempotency_key").notNull(),
    status: statusJobEnum("status").default("processing").notNull(),
    response: jsonb("response")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    claimsRepairedAt: timestamp("claims_repaired_at", { withTimezone: true }),
    /** Owner of the row: takeover and finalization compare-and-swap on it. */
    attemptToken: uuid("attempt_token").defaultRandom().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    userKeyUniqueIdx: uniqueIndex("onboarding_submissions_user_key_unique").on(
      t.userId,
      t.idempotencyKey,
    ),
    statusUpdatedIdx: index("onboarding_submissions_status_updated_idx").on(
      t.status,
      t.updatedAt,
    ),
  }),
);

// ============================================================================
// CONNECTIONS TABLE
// ============================================================================
export const connections = pgTable(
  "connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requesterId: uuid("requester_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    addresseeId: uuid("addressee_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    status: statusConnectionEnum("status").default("pending").notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    blockedBy: uuid("blocked_by").references(() => profiles.id, {
      onDelete: "cascade",
    }),
    blockedAt: timestamp("blocked_at", { withTimezone: true }),
    // Optional message sent with the connection request
    message: text("message"),
    // Optional user-provided tag categories (e.g., "Collaborator", "Classmate")
    tags: jsonb("tags").$type<string[]>().default([]),
    // Optional reason selected when declining a request
    rejectionReason: text("rejection_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    // Optimize fetching connections for a user
    requesterIdx: index("connections_requester_idx").on(t.requesterId),
    addresseeIdx: index("connections_addressee_idx").on(t.addresseeId),
    // Composite index for common "my accepted connections" query
    statusRequesterIdx: index("connections_status_requester_idx").on(
      t.status,
      t.requesterId,
    ),
    statusAddresseeIdx: index("connections_status_addressee_idx").on(
      t.status,
      t.addresseeId,
    ),

    // Pure Optimization: Composite Indices for Stats & Requests (1M+ Users)
    // 1. "Connections This Month" Stats (Fast Aggregation)
    requesterStatsIdx: index("connections_requester_stats_idx").on(
      t.requesterId,
      t.status,
      t.updatedAt,
    ),
    addresseeStatsIdx: index("connections_addressee_stats_idx").on(
      t.addresseeId,
      t.status,
      t.updatedAt,
    ),

    // 2. "Pending Requests" Sorting (Fast List)
    pendingRequestsIdx: index("connections_pending_idx").on(
      t.status,
      t.createdAt,
    ),
    blockedByIdx: index("connections_blocked_by_idx").on(
      t.blockedBy,
      t.blockedAt,
    ),
    activePairUidx: uniqueIndex("connections_active_pair_unique").on(
      sql`LEAST(${t.requesterId}, ${t.addresseeId})`,
      sql`GREATEST(${t.requesterId}, ${t.addresseeId})`,
    ),
    noSelfCheck: check(
      "connections_no_self_check",
      sql`${t.requesterId} <> ${t.addresseeId}`,
    ),
    blockedStatusCheck: check(
      "connections_blocked_status_check",
      sql`(${t.status} <> 'blocked') OR (${t.blockedBy} IS NOT NULL AND ${t.blockedAt} IS NOT NULL)`,
    ),
    reqAddrStatusIdx: index("connections_req_addr_status_idx").on(
      t.requesterId,
      t.addresseeId,
      t.status,
    ),
  }),
);

export const connectionSuggestionDismissals = pgTable(
  "connection_suggestion_dismissals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    dismissedProfileId: uuid("dismissed_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    userDismissedUniqueIdx: uniqueIndex(
      "connection_suggestion_dismissals_user_profile_unique",
    ).on(t.userId, t.dismissedProfileId),
    userCreatedIdx: index(
      "connection_suggestion_dismissals_user_created_idx",
    ).on(t.userId, t.createdAt),
    dismissedProfileIdx: index(
      "connection_suggestion_dismissals_profile_idx",
    ).on(t.dismissedProfileId),
  }),
);

// ============================================================================
// CONNECTION SUGGESTIONS TABLE (Pre-computed for 1M+ Users Scalability)
// ============================================================================
export const connectionSuggestions = pgTable(
  "connection_suggestions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    suggestedUserId: uuid("suggested_user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    mutualConnectionsCount: integer("mutual_connections_count")
      .default(0)
      .notNull(),
    score: integer("score").default(0).notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    userSuggestionUniqueIdx: uniqueIndex(
      "connection_suggestions_user_suggested_unique",
    ).on(t.userId, t.suggestedUserId),
    userScoreIdx: index("connection_suggestions_user_score_idx").on(
      t.userId,
      t.score,
    ),
    userScoreKeysetIdx: index(
      "connection_suggestions_user_score_keyset_idx",
    ).on(t.userId, t.score.desc(), t.suggestedUserId.desc()),
    suggestedUserIdx: index("connection_suggestions_suggested_user_idx").on(
      t.suggestedUserId,
    ),
  }),
);

// ============================================================================
// PROJECTS TABLE
// ============================================================================
export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    slug: text("slug").unique(),
    description: text("description"),
    problemStatement: text("problem_statement"),
    solutionStatement: text("solution_statement"),
    shortDescription: text("short_description"),
    coverImage: text("cover_image"),
    coverImageBucket: text("cover_image_bucket"),
    coverImageKey: text("cover_image_key"),
    coverImageAssetId: uuid("cover_image_asset_id").references(
      (): AnyPgColumn => storageAssets.id,
      { onDelete: "set null" },
    ),
    category: text("category"),
    viewCount: integer("view_count").default(0).notNull(),
    followersCount: integer("followers_count").default(0).notNull(),
    savesCount: integer("saves_count").default(0).notNull(),

    tags: jsonb("tags").$type<string[]>().default([]),
    skills: jsonb("skills").$type<string[]>().default([]),
    externalLinks: jsonb("external_links")
      .$type<import("@/lib/profile/normalization").SocialLinkStorage>()
      .default({})
      .notNull(),
    externalLinkMetadata: jsonb("external_link_metadata")
      .$type<import("@/lib/profile/normalization").ProjectLinkMetadataRecord>()
      .default({})
      .notNull(),
    // "org" = Org only: readable by people in the parent org (0241).
    visibility: text("visibility", {
      enum: ["public", "private", "unlisted", "org"],
    }).default("public"),
    // Organizations (0241): an org is a project with kind "organization"; children point to it with parentId.
    kind: text("kind", { enum: ["project", "organization"] }).default("project").notNull(),
    parentId: uuid("parent_id").references((): AnyPgColumn => projects.id, { onDelete: "set null" }),
    orgType: text("org_type", { enum: ["education", "company", "community", "research", "club"] }),
    orgSettings: jsonb("org_settings").$type<Record<string, unknown>>().default({}).notNull(),
    termStart: date("term_start"),
    termEnd: date("term_end"),
    timeZone: text("time_zone"),
    welcomeNote: text("welcome_note"),
    joinCode: text("join_code"),
    joinCodeEnabled: boolean("join_code_enabled").default(true).notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    verifiedBy: uuid("verified_by").references((): AnyPgColumn => profiles.id, { onDelete: "set null" }),
    verificationDomain: text("verification_domain"),
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    suspendReason: text("suspend_reason"),
    deletionScheduledAt: timestamp("deletion_scheduled_at", { withTimezone: true }),
    // Project status (0184), set by owners and admins.
    statusEmoji: text("status_emoji"),
    statusText: text("status_text"),
    statusExpiresAt: timestamp("status_expires_at", { withTimezone: true }),
    statusSetBy: uuid("status_set_by"),
    statusSetAt: timestamp("status_set_at", { withTimezone: true }),
    publicTabVisibility: jsonb("public_tab_visibility")
      .$type<ProjectPublicTabVisibility>()
      .default({
        dashboard: true,
        readme: true,
        updates: true,
        files: true,
        sprints: false,
        tasks: false,
      })
      .notNull(),
    notificationPreferences: jsonb("notification_preferences")
      .$type<ProjectNotificationPreferencesRecord>()
      .default({
        version: 1,
        preset: "balanced",
        rules: {},
      })
      .notNull(),
    status: statusProjectEnum("status").default("draft"),

    taskReviewRequired: boolean("task_review_required").default(false).notNull(),
    taskCompletionPolicyVersion: integer("task_completion_policy_version").default(0).notNull(),

    // Project Key System
    key: text("key").unique(), // e.g. "NB"
    currentTaskNumber: integer("current_task_number").default(0),
    currentSequenceNumber: bigint("current_sequence_number", { mode: "number" })
      .default(0)
      .notNull(),

    openRolesCount: integer("open_roles_count").default(0).notNull(),
    lookingForCollaborators: boolean("looking_for_collaborators").default(
      false,
    ),
    memberUpdatesEnabled: boolean("member_updates_enabled")
      .default(true)
      .notNull(),
    // Default for project_members.file_upload_enabled when someone joins (set at creation, editable in Settings).
    memberFileUploadDefault: boolean("member_file_upload_default")
      .default(true)
      .notNull(),
    maxCollaborators: text("max_collaborators"),
    lifecycleStages: jsonb("lifecycle_stages").$type<string[]>().default([]),
    currentStageIndex: integer("current_stage_index").default(0),
    stageCompletionDates: jsonb("stage_completion_dates")
      .$type<Record<string, string>>()
      .default({}),
    importSource: jsonb("import_source").$type<{
      type: "github" | "upload" | "scratch";
      repoUrl?: string;
      branch?: string;
      s3Key?: string;
      metadata?: ImportSourceMetadata;
    }>(),
    syncStatus: text("sync_status", {
      enum: ["pending", "cloning", "indexing", "ready", "failed"],
    })
      .default("ready")
      .notNull(),
    githubRepoUrl: text("github_repo_url"),
    githubDefaultBranch: text("github_default_branch").default("main"),
    githubLastSyncAt: timestamp("github_last_sync_at", { withTimezone: true }),
    githubLastCommitSha: text("github_last_commit_sha"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    ownerIdx: index("projects_owner_idx").on(t.ownerId),
    statusSetByIdx: index("projects_status_set_by_idx").on(t.statusSetBy),
    coverImageAssetIdx: index("projects_cover_image_asset_idx").on(
      t.coverImageAssetId,
    ),
    // Multi-column indexes for filtering (critical for 1M users)
    statusVisibilityIdx: index("projects_status_visibility_idx").on(
      t.status,
      t.visibility,
    ),
    categoryStatusIdx: index("projects_category_status_idx").on(
      t.category,
      t.status,
    ),
    // Sort index for the main "Newest Projects" feed
    createdAtStatusIdx: index("projects_created_at_status_idx").on(
      t.createdAt,
      t.status,
    ),
    // Optimization: GIN Index for fast project search (Hub Optimization)
    // Note: Requires pg_trgm extension. If fails, fallback to b-tree on title is suboptimal but works.
    titleSearchIdx: index("projects_title_search_idx").using(
      "gin",
      sql`${t.title} gin_trgm_ops`,
    ),
    descriptionSearchIdx: index("projects_description_search_idx").using(
      "gin",
      sql`${t.description} gin_trgm_ops`,
    ),

    // Pure Optimization: Composite Indices for Sorted Feeds (Avoids Sorting after Filtering)
    // 2. "Most Viewed Projects": Filter by Public Visibility + Status -> Sort by ViewCount
    feedMostViewedIdx: index("projects_feed_most_viewed_idx").on(
      t.visibility,
      t.status,
      t.viewCount,
    ),

    // 3. "My Projects": Filter by Owner -> Sort by CreatedAt
    myProjectsIdx: index("projects_my_projects_idx").on(t.ownerId, t.createdAt),
    // Discover's feed (0195): the predicate is exactly the feed's filter, so each sort reads in order.
    discoverNewestIdx: index("projects_discover_newest_idx")
      .on(t.createdAt.desc(), t.id.desc())
      .where(sql`${t.deletedAt} IS NULL AND ${t.visibility} IN ('public', 'unlisted') AND ${t.status} <> 'draft'`),
    discoverMostViewedIdx: index("projects_discover_most_viewed_idx")
      .on(t.viewCount.desc(), t.createdAt.desc(), t.id.desc())
      .where(sql`${t.deletedAt} IS NULL AND ${t.visibility} IN ('public', 'unlisted') AND ${t.status} <> 'draft'`),
    discoverMostFollowedIdx: index("projects_discover_most_followed_idx")
      .on(t.followersCount.desc(), t.createdAt.desc(), t.id.desc())
      .where(sql`${t.deletedAt} IS NULL AND ${t.visibility} IN ('public', 'unlisted') AND ${t.status} <> 'draft'`),
    publicFeedMostFollowedActiveIdx: index(
      "projects_public_feed_most_followed_active_idx",
    )
      .on(
        t.visibility,
        t.status,
        t.followersCount.desc(),
        t.createdAt.desc(),
        t.id.desc(),
      )
      .where(sql`${t.deletedAt} IS NULL`),

    // Pure Optimization: Partial index for active (non-deleted) projects
    // Eliminates full table scans on hub queries filtering WHERE deleted_at IS NULL
    activeProjectsIdx: index("projects_active_idx")
      .on(t.id)
      .where(sql`${t.deletedAt} IS NULL`),

    // 4. Composite index for profile project fetches
    ownerDeletedAtViewCountIdx: index(
      "projects_owner_deleted_view_count_idx",
    ).on(t.ownerId, t.deletedAt, t.viewCount),
    parentIdx: index("projects_parent_idx").on(t.parentId).where(sql`${t.parentId} IS NOT NULL`),
    verifiedByIdx: index("projects_verified_by_idx").on(t.verifiedBy).where(sql`${t.verifiedBy} IS NOT NULL`),
    joinCodeUnique: uniqueIndex("projects_join_code_unique").on(t.joinCode).where(sql`${t.joinCode} IS NOT NULL`),
    kindCheck: check("projects_kind_check", sql`${t.kind} IN ('project', 'organization')`),
    orgHasNoParent: check("projects_org_has_no_parent", sql`${t.kind} = 'project' OR ${t.parentId} IS NULL`),
    orgTypeCheck: check("projects_org_type_check", sql`${t.orgType} IS NULL OR ${t.orgType} IN ('education', 'company', 'community', 'research', 'club')`),
    termCheck: check("projects_term_check", sql`${t.termEnd} IS NULL OR ${t.termStart} IS NULL OR ${t.termEnd} >= ${t.termStart}`),
  }),
);

// ============================================================================
// PROJECT MEMBERS TABLE
// ============================================================================
export const projectMembers = pgTable(
  "project_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "admin", "member", "viewer"] })
      .default("member")
      .notNull(),
    fileUploadEnabled: boolean("file_upload_enabled").default(true).notNull(),
    notificationPreferences: jsonb("notification_preferences")
      .$type<ProjectMemberNotificationPreferencesRecord>()
      .default({
        version: 1,
        mode: "inherit",
        rules: {},
      })
      .notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    // Organizations (0241)
    title: text("title"),
    showOnProfile: boolean("show_on_profile").default(true).notNull(),
    lastSeenUpdatesAt: timestamp("last_seen_updates_at", { withTimezone: true }),
    unitId: uuid("unit_id").references((): AnyPgColumn => projectOpenRoles.id, { onDelete: "set null" }),
  },
  (t) => ({
    unitIdx: index("project_members_unit_idx").on(t.unitId).where(sql`${t.unitId} IS NOT NULL`),
    titleLength: check("project_members_title_length", sql`${t.title} IS NULL OR char_length(${t.title}) <= 60`),
    projectUserUnique: uniqueIndex("project_members_project_user_unique").on(
      t.projectId,
      t.userId,
    ),
    userIdx: index("project_members_user_idx").on(t.userId),
    userRoleIdx: index("project_members_user_role_idx").on(t.userId, t.role),
    projectJoinedAtIdx: index("project_members_project_joined_at_idx").on(
      t.projectId,
      t.joinedAt.desc(),
      t.id.desc(),
    ),
    fileUploadIdx: index("project_members_file_upload_idx").on(
      t.projectId,
      t.fileUploadEnabled,
    ),
  }),
);

// ============================================================================
// ORGANIZATIONS (0241): server-only tables, no browser grants.
// ============================================================================
export const orgJoinBlocks = pgTable(
  "org_join_blocks",
  {
    orgId: uuid("org_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    blockedBy: uuid("blocked_by").references(() => profiles.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.orgId, t.userId] }),
    userIdx: index("org_join_blocks_user_idx").on(t.userId),
    blockedByIdx: index("org_join_blocks_blocked_by_idx").on(t.blockedBy).where(sql`${t.blockedBy} IS NOT NULL`),
  }),
);

/** Invites for people without an account yet, matched by email at sign-up. */
export const orgEmailInvites = pgTable(
  "org_email_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role", { enum: ["admin", "member", "viewer"] }).default("member").notNull(),
    title: text("title"),
    childProjectId: uuid("child_project_id").references(() => projects.id, { onDelete: "set null" }),
    unitId: uuid("unit_id").references(() => projectOpenRoles.id, { onDelete: "set null" }),
    invitedBy: uuid("invited_by").references(() => profiles.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    openUnique: uniqueIndex("org_email_invites_open_unique").on(t.orgId, t.email).where(sql`${t.acceptedAt} IS NULL`),
    emailIdx: index("org_email_invites_email_idx").on(t.email).where(sql`${t.acceptedAt} IS NULL`),
    orgIdx: index("org_email_invites_org_idx").on(t.orgId),
    childProjectIdx: index("org_email_invites_child_project_idx").on(t.childProjectId).where(sql`${t.childProjectId} IS NOT NULL`),
    unitIdx: index("org_email_invites_unit_idx").on(t.unitId).where(sql`${t.unitId} IS NOT NULL`),
    invitedByIdx: index("org_email_invites_invited_by_idx").on(t.invitedBy).where(sql`${t.invitedBy} IS NOT NULL`),
    emailCheck: check("org_email_invites_email_check", sql`${t.email} = lower(${t.email}) AND char_length(${t.email}) <= 320`),
    roleCheck: check("org_email_invites_role_check", sql`${t.role} IN ('admin', 'member', 'viewer')`),
    titleCheck: check("org_email_invites_title_check", sql`${t.title} IS NULL OR char_length(${t.title}) <= 60`),
  }),
);

/** Old org handles stay taken (and redirect) until heldUntil, 90 days after a rename. */
export const orgHandleHolds = pgTable(
  "org_handle_holds",
  {
    handle: text("handle").primaryKey(),
    orgId: uuid("org_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    heldUntil: timestamp("held_until", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    orgIdx: index("org_handle_holds_org_idx").on(t.orgId),
  }),
);

// ============================================================================
// PROJECT INVITATIONS AND GUIDANCE APPOINTMENTS
// A project invitation is durable even when an optional direct-message card
// cannot be delivered. Guidance is an appointment layered on existing admin
// membership, never a separate permission role.
// ============================================================================
export const projectInvitations = pgTable(
  "project_invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    inviterId: uuid("inviter_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    kind: text("kind", {
      enum: ["ordinary_role", "guidance_appointment"],
    }).notNull(),
    roleId: uuid("role_id").references(() => projectOpenRoles.id, {
      onDelete: "set null",
    }),
    roleTitle: text("role_title"),
    guidanceLabel: text("guidance_label"),
    note: text("note"),
    projectTitle: text("project_title").notNull(),
    status: text("status", {
      enum: ["pending", "accepted", "declined", "cancelled", "expired"],
    })
      .notNull()
      .default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    reviewAt: timestamp("review_at", { withTimezone: true }),
    idempotencyKey: text("idempotency_key"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: uuid("resolved_by").references(() => profiles.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    projectCandidateIdx: index("project_invitations_project_candidate_idx").on(
      t.projectId,
      t.candidateId,
      t.status,
      t.createdAt,
    ),
    candidateInboxIdx: index("project_invitations_candidate_inbox_idx").on(
      t.candidateId,
      t.status,
      t.createdAt,
    ),
    roleIdx: index("project_invitations_role_idx").on(t.roleId),
    resolvedByIdx: index("project_invitations_resolved_by_idx").on(
      t.resolvedBy,
    ),
    expiresIdx: index("project_invitations_expires_idx").on(t.expiresAt),
    inviterIdx: index("project_invitations_inviter_idx").on(t.inviterId),
    idempotencyUnique: uniqueIndex("project_invitations_idempotency_unique")
      .on(t.inviterId, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} IS NOT NULL`),
    pendingOrdinaryUnique: uniqueIndex(
      "project_invitations_pending_ordinary_unique",
    )
      .on(t.projectId, t.candidateId)
      .where(sql`${t.kind} = 'ordinary_role' AND ${t.status} = 'pending'`),
    pendingGuidanceUnique: uniqueIndex(
      "project_invitations_pending_guidance_unique",
    )
      .on(t.projectId)
      .where(
        sql`${t.kind} = 'guidance_appointment' AND ${t.status} = 'pending'`,
      ),
    kindCheck: check(
      "project_invitations_kind_check",
      sql`${t.kind} IN ('ordinary_role', 'guidance_appointment')`,
    ),
    statusCheck: check(
      "project_invitations_status_check",
      sql`${t.status} IN ('pending', 'accepted', 'declined', 'cancelled', 'expired')`,
    ),
    snapshotCheck: check(
      "project_invitations_snapshot_check",
      sql`(${t.kind} = 'ordinary_role' AND ${t.roleTitle} IS NOT NULL AND ${t.guidanceLabel} IS NULL)
            OR (${t.kind} = 'guidance_appointment' AND ${t.guidanceLabel} IS NOT NULL AND ${t.roleId} IS NULL)`,
    ),
  }),
);

export const projectGuidanceAppointments = pgTable(
  "project_guidance_appointments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    guideUserId: uuid("guide_user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    invitationId: uuid("invitation_id")
      .notNull()
      .references(() => projectInvitations.id, { onDelete: "restrict" }),
    label: text("label").notNull(),
    status: text("status", { enum: ["active", "ended", "revoked"] })
      .notNull()
      .default("active"),
    reviewAt: timestamp("review_at", { withTimezone: true }),
    publicAttributionConsent: boolean("public_attribution_consent")
      .notNull()
      .default(false),
    previousMembershipRole: text("previous_membership_role", {
      enum: ["owner", "admin", "member", "viewer"],
    }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    endedBy: uuid("ended_by").references(() => profiles.id, {
      onDelete: "set null",
    }),
    endReason: text("end_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    projectGuideIdx: index(
      "project_guidance_appointments_project_guide_idx",
    ).on(t.projectId, t.guideUserId, t.status),
    guideIdx: index("project_guidance_appointments_guide_idx").on(t.guideUserId),
    guideActiveIdx: index("project_guidance_appointments_guide_active_idx")
      .on(t.guideUserId, t.acceptedAt)
      .where(sql`${t.status} = 'active'`),
    invitationIdx: index("project_guidance_appointments_invitation_idx").on(
      t.invitationId,
    ),
    endedByIdx: index("project_guidance_appointments_ended_by_idx").on(
      t.endedBy,
    ),
    activeProjectUnique: uniqueIndex(
      "project_guidance_appointments_active_project_unique",
    )
      .on(t.projectId)
      .where(sql`${t.status} = 'active'`),
    statusCheck: check(
      "project_guidance_appointments_status_check",
      sql`${t.status} IN ('active', 'ended', 'revoked')`,
    ),
  }),
);

// ============================================================================
// PROFILE COLLABORATION PROJECTIONS
// ============================================================================
export const profileProjectContributions = pgTable(
  "profile_project_contributions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    externalKey: text("external_key"),
    projectTitle: text("project_title"),
    projectUrl: text("project_url"),
    repositoryUrl: text("repository_url"),
    presentation: jsonb("presentation").$type<import("@/lib/profile/contribution-story").ContributionStory>(),
    featured: boolean("featured").default(false).notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    source: text("source", {
      enum: ["membership", "application", "owner", "manual"],
    })
      .default("membership")
      .notNull(),
    roleKind: text("role_kind", {
      enum: ["owner", "admin", "member", "viewer", "contributor"],
    })
      .default("contributor")
      .notNull(),
    roleTitle: text("role_title"),
    summary: text("summary"),
    skills: jsonb("skills").$type<string[]>().default([]).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    /** Org admins revoke a "Verified by <org>" with a reason (0248). */
    verificationRevokedReason: text("verification_revoked_reason"),
    verifiedBy: uuid("verified_by").references(() => profiles.id, {
      onDelete: "set null",
    }),
    visibility: text("visibility", { enum: ["public", "private"] })
      .default("public")
      .notNull(),
    version: integer("version").default(1).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    profileProjectActiveUnique: uniqueIndex(
      "profile_project_contributions_profile_project_active_unique",
    )
      .on(t.profileId, t.projectId)
      .where(sql`${t.deletedAt} IS NULL AND ${t.projectId} IS NOT NULL`),
    profileExternalActiveUnique: uniqueIndex(
      "profile_project_contributions_profile_external_active_unique",
    )
      .on(t.profileId, t.externalKey)
      .where(sql`${t.deletedAt} IS NULL AND ${t.projectId} IS NULL`),
    profileVisibleIdx: index(
      "profile_project_contributions_profile_visible_idx",
    )
      .on(t.profileId, t.visibility, t.updatedAt.desc())
      .where(sql`${t.deletedAt} IS NULL`),
    profileIdx: index("profile_project_contributions_profile_idx").on(t.profileId),
    projectRefIdx: index("profile_project_contributions_project_ref_idx").on(t.projectId).where(sql`${t.projectId} IS NOT NULL`),
    projectIdx: index("profile_project_contributions_project_idx")
      .on(t.projectId, t.updatedAt.desc())
      .where(sql`${t.deletedAt} IS NULL`),
    verifiedIdx: index("profile_project_contributions_verified_idx")
      .on(t.profileId, t.verifiedAt.desc())
      .where(sql`${t.deletedAt} IS NULL AND ${t.verifiedAt} IS NOT NULL`),
    verifiedByIdx: index("profile_project_contributions_verified_by_idx").on(
      t.verifiedBy,
    ),
    presentationSizeCheck: check("profile_contribution_presentation_size",sql`${t.presentation} IS NULL OR octet_length(${t.presentation}::text) <= 150000`),
    authorityShapeCheck: check(
      "profile_project_contributions_authority_shape_check",
      sql`((${t.projectId} IS NOT NULL AND ${t.externalKey} IS NULL) OR (${t.projectId} IS NULL AND ${t.externalKey} IS NOT NULL AND NULLIF(BTRIM(${t.projectTitle}), '') IS NOT NULL))`,
    ),
    versionCheck: check(
      "profile_project_contributions_version_check",
      sql`${t.version} > 0`,
    ),
  }),
);

export const profileProjectContributionStages = pgTable(
  "profile_project_contribution_stages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contributionId: uuid("contribution_id")
      .notNull()
      .references(() => profileProjectContributions.id, {
        onDelete: "cascade",
      }),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    source: text("source", {
      enum: [
        "membership",
        "application",
        "owner",
        "manual",
        "role_change",
        "project_invite",
        "ownership_transfer",
        "removal",
        "backfill",
      ],
    })
      .default("membership")
      .notNull(),
    roleKind: text("role_kind", {
      enum: ["owner", "admin", "member", "viewer", "contributor"],
    })
      .default("contributor")
      .notNull(),
    roleTitle: text("role_title"),
    summary: text("summary"),
    skills: jsonb("skills").$type<string[]>().default([]).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    verifiedBy: uuid("verified_by").references(() => profiles.id, {
      onDelete: "set null",
    }),
    eventId: uuid("event_id"),
    visibility: text("visibility", { enum: ["public", "private"] })
      .default("public")
      .notNull(),
    manualOverride: boolean("manual_override").default(false).notNull(),
    displayOrder: integer("display_order").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    contributionRefIdx: index("profile_project_contribution_stages_contribution_ref_idx").on(t.contributionId),
    profileRefIdx: index("profile_project_contribution_stages_profile_ref_idx").on(t.profileId),
    contributionIdx: index(
      "profile_project_contribution_stages_contribution_idx",
    )
      .on(t.contributionId, t.startedAt.desc(), t.createdAt.desc())
      .where(sql`${t.deletedAt} IS NULL`),
    profileProjectIdx: index(
      "profile_project_contribution_stages_profile_project_idx",
    )
      .on(t.profileId, t.projectId, t.startedAt.desc())
      .where(sql`${t.deletedAt} IS NULL`),
    currentUnique: uniqueIndex(
      "profile_project_contribution_stages_current_unique",
    )
      .on(t.contributionId)
      .where(sql`${t.deletedAt} IS NULL AND ${t.endedAt} IS NULL`),
    eventUnique: uniqueIndex("profile_project_contribution_stages_event_unique")
      .on(t.eventId)
      .where(sql`${t.eventId} IS NOT NULL`),
    visibleIdx: index("profile_project_contribution_stages_visible_idx")
      .on(t.profileId, t.visibility, t.startedAt.desc())
      .where(sql`${t.deletedAt} IS NULL`),
    projectFkIdx: index("profile_contribution_stages_project_idx").on(
      t.projectId,
    ),
    verifiedByIdx: index("profile_contribution_stages_verified_by_idx").on(
      t.verifiedBy,
    ),
  }),
);

export const profileCollaborationSummaries = pgTable(
  "profile_collaboration_summaries",
  {
    profileId: uuid("profile_id")
      .primaryKey()
      .references(() => profiles.id, { onDelete: "cascade" }),
    version: integer("version").default(1).notNull(),
    summary: jsonb("summary")
      .$type<unknown>()
      .default({
        version: 1,
        generatedAt: "",
        projects: [],
        contributions: [],
        stats: {
          projectsCount: 0,
          visibleProjectsCount: 0,
          contributionCount: 0,
        },
      })
      .notNull(),
    projectCount: integer("project_count").default(0).notNull(),
    visibleProjectCount: integer("visible_project_count").default(0).notNull(),
    contributionCount: integer("contribution_count").default(0).notNull(),
    stale: boolean("stale").default(false).notNull(),
    refreshedAt: timestamp("refreshed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    staleIdx: index("profile_collaboration_summaries_stale_idx").on(
      t.stale,
      t.updatedAt,
    ),
    refreshedIdx: index("profile_collaboration_summaries_refreshed_idx").on(
      t.refreshedAt,
    ),
  }),
);

// ============================================================================
// PROJECT MARKDOWNS
// ============================================================================
export const projectDocs = pgTable(
  "project_docs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),

    publishedVersionId: uuid("published_version_id"),
    linkedNodeId: uuid("linked_node_id").references(() => projectNodes.id, {
      onDelete: "set null",
    }),
    filename: text("filename").default("README.md").notNull(),
    slug: text("slug").default("readme").notNull(),
    settings: jsonb("settings")
      .$type<{
        version: number;
        editPolicy: "leaders" | "members";
        visibilityOverride:
          | "inherit_project"
          | "public"
          | "members_only"
          | "leaders_only";
        externalImages: boolean;
        projectBlocks: boolean;
        /** Org docs (report §19): see src/lib/organizations/doc-rules.ts. */
        org?: Record<string, unknown>;
      }>()
      .default({
        version: 1,
        editPolicy: "leaders",
        visibilityOverride: "inherit_project",
        externalImages: false,
        projectBlocks: true,
      })
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    projectSlugUnique: uniqueIndex("project_docs_slug_unique").on(
      t.projectId,
      t.slug,
    ),
    publishedVersionIdx: index("project_docs_published_version_idx").on(
      t.publishedVersionId,
    ),
    linkedNodeIdx: index("project_docs_linked_node_idx").on(
      t.linkedNodeId,
    ),
  }),
);

export const projectDocVersions = pgTable(
  "project_doc_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    docId: uuid("doc_id")
      .notNull()
      .references(() => projectDocs.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    content: text("content").notNull(),
    excerpt: text("excerpt"),
    headings: jsonb("headings")
      .$type<ProjectDocHeadingRecord[]>()
      .default([])
      .notNull(),
    qualityReport: jsonb("quality_report")
      .$type<ProjectDocQualityRecord>()
      .default({})
      .notNull(),
    contentHash: text("content_hash").notNull(),
    changeSummary: text("change_summary"),
    coAuthors: jsonb("co_authors").$type<string[]>().default([]).notNull(),
    createdBy: uuid("created_by").references(() => profiles.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    docVersionUnique: uniqueIndex(
      "project_doc_versions_doc_id_version_number_key",
    ).on(t.docId, t.versionNumber),
    projectDeletedIdx: index(
      "project_doc_versions_project_deleted_idx",
    ).on(t.projectId, t.deletedAt),
    createdByIdx: index("project_doc_versions_created_by_idx").on(
      t.createdBy,
    ),
  }),
);

// ============================================================================
// OPEN ROLES TABLE
// ============================================================================
export const projectOpenRoles = pgTable(
  "project_open_roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    role: text("role").notNull(), // e.g. "Frontend Developer"
    title: text("title"), // Display title
    description: text("description"),
    count: integer("count").default(1).notNull(),
    filled: integer("filled").default(0).notNull(),
    skills: jsonb("skills").$type<string[]>().default([]),
    commitmentType: text("commitment_type"),
    experienceRequired: text("experience_required"),
    hoursPerWeek: text("hours_per_week"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    projectUpdatedIdx: index("project_open_roles_project_updated_idx").on(
      t.projectId,
      t.updatedAt,
    ),
    countNonNegativeCheck: check(
      "project_open_roles_count_non_negative_check",
      sql`${t.count} >= 0`,
    ),
    filledNonNegativeCheck: check(
      "project_open_roles_filled_non_negative_check",
      sql`${t.filled} >= 0`,
    ),
    filledWithinCountCheck: check(
      "project_open_roles_filled_lte_count_check",
      sql`${t.filled} <= ${t.count}`,
    ),
  }),
);

// ============================================================================
// ROLE APPLICATIONS TABLE
// ============================================================================
export const roleApplications = pgTable(
  "role_applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    roleId: uuid("role_id").references(() => projectOpenRoles.id, {
      onDelete: "set null",
    }),
    applicantId: uuid("applicant_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    // History only (the owner when it was sent); reviewers come from project membership. Survives its profile.
    creatorId: uuid("creator_id").references(() => profiles.id, { onDelete: "set null" }),
    message: text("message"), // Application message from user
    status: statusRoleApplicationEnum("status").default("pending").notNull(),
    acceptedRoleTitle: text("accepted_role_title"),
    decisionAt: timestamp("decision_at", { withTimezone: true }),
    decisionBy: uuid("decision_by").references(() => profiles.id, {
      onDelete: "set null",
    }),
    decisionReasonCode: text("decision_reason_code"),
    decisionReasonText: text("decision_reason_text"),
    // Structured apply-form fields (portfolioUrl, availability).
    details: jsonb("details").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    // O(1) lookups for user's applications
    applicantIdx: index("role_applications_applicant_idx").on(
      t.applicantId,
      t.status,
    ),
    roleApplicantUniqIdx: uniqueIndex("role_applicant_uniq_idx").on(
      t.roleId,
      t.applicantId,
    ),
    // O(1) lookups for creator's pending applications
    creatorPendingIdx: index("role_applications_creator_pending_idx").on(
      t.creatorId,
      t.status,
    ),
    // O(1) cooldown check (project + applicant + updated_at)
    cooldownIdx: index("role_applications_cooldown_idx").on(
      t.projectId,
      t.applicantId,
      t.updatedAt,
    ),
    // O(1) lookups for project-member role title enrichment.
    acceptedProjectMemberIdx: index("role_applications_accepted_member_idx").on(
      t.projectId,
      t.applicantId,
      t.status,
      t.updatedAt,
    ),
    projectUpdatedIdx: index("role_applications_project_updated_idx").on(
      t.projectId,
      t.updatedAt,
    ),
    uniqueAppIdx: uniqueIndex("role_applications_unique_idx").on(
      t.projectId,
      t.applicantId,
    ),
    // A reviewer's queue: pending applications of their projects.
    pendingProjectIdx: index("role_applications_pending_project_idx")
      .on(t.projectId)
      .where(sql`${t.status} = 'pending'`),
    decisionByIdx: index("role_applications_decision_by_idx").on(t.decisionBy),
  }),
);

export const applicationEvents = pgTable(
  "application_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => roleApplications.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => profiles.id, {
      onDelete: "set null",
    }),
    kind: text("kind", {
      enum: [
        "created",
        "edited",
        "withdrawn",
        "reopened",
        "accepted",
        "rejected",
      ],
    }).notNull(),
    fromStatus: text("from_status"),
    toStatus: text("to_status"),
    reasonCode: text("reason_code"),
    reasonText: text("reason_text"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    applicationCreatedIdx: index(
      "application_events_application_created_idx",
    ).on(t.applicationId, t.createdAt),
    actorCreatedIdx: index("application_events_actor_created_idx").on(
      t.actorId,
      t.createdAt,
    ),
    kindCreatedIdx: index("application_events_kind_created_idx").on(
      t.kind,
      t.createdAt,
    ),
  }),
);

// ============================================================================
// PROJECT FOLLOWS TABLE
// ============================================================================
export const projectFollows = pgTable(
  "project_follows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    userIdx: index("project_follows_user_id_idx").on(t.userId),
    uniqueFollow: uniqueIndex("project_follows_unique_idx").on(
      t.projectId,
      t.userId,
    ),
  }),
);

// ============================================================================
// PROJECT UPDATES
// Intentional, social-style progress posts on a project.
// ============================================================================
export const projectUpdates = pgTable(
  "project_updates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    authorId: uuid("author_id").references(() => profiles.id, {
      onDelete: "set null",
    }),
    content: text("content").notNull(),
    updateType: text("update_type", {
      enum: [
        "progress",
        "milestone",
        "release",
        "blocker",
        "decision",
        "collaboration_request",
        "behind_the_scenes",
        // Organizations (0245)
        "announcement",
        "discussion",
      ],
    }),
    visibility: text("visibility", { enum: ["public", "members"] })
      .default("public")
      .notNull(),
    // "closed" = comments off (0245).
    replyPolicy: text("reply_policy", { enum: ["logged_in", "members", "closed"] })
      .default("logged_in")
      .notNull(),
    // Organizations (0245): who sees the post (empty = everyone), notify level, unpin date, shared up from a child project.
    audience: jsonb("audience").$type<import("@/lib/organizations/update-rules").UpdateAudience>().default({}).notNull(),
    notifyLevel: text("notify_level", { enum: ["in_app", "email"] }).default("in_app").notNull(),
    pinnedUntil: timestamp("pinned_until", { withTimezone: true }),
    sharedToOrgAt: timestamp("shared_to_org_at", { withTimezone: true }),
    entityRefs: jsonb("entity_refs")
      .$type<ProjectUpdateEntityRefs>()
      .default({})
      .notNull(),
    media: jsonb("media")
      .$type<ProjectUpdateMediaItem[]>()
      .default([])
      .notNull(),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    isPinned: boolean("is_pinned").default(false).notNull(),
    likeCount: integer("like_count").default(0).notNull(),
    commentCount: integer("comment_count").default(0).notNull(),
    deletedBy: uuid("deleted_by").references(() => profiles.id, {
      onDelete: "set null",
    }),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    projectPinnedCreatedIdx: index(
      "project_updates_project_pinned_created_idx",
    ).on(t.projectId, t.isPinned, t.createdAt.desc(), t.id.desc()),
    projectCreatedActiveIdx: index("project_updates_project_created_active_idx")
      .on(t.projectId, t.createdAt.desc(), t.id.desc())
      .where(sql`${t.deletedAt} IS NULL`),
    memberFeedIdx: index("project_updates_member_feed_idx")
      .on(t.projectId, t.isPinned.desc(), t.createdAt.desc(), t.id.desc())
      .where(sql`${t.deletedAt} IS NULL`),
    publicFeedIdx: index("project_updates_public_feed_idx")
      .on(
        t.projectId,
        t.visibility,
        t.isPinned,
        t.createdAt.desc(),
        t.id.desc(),
      )
      .where(sql`${t.deletedAt} IS NULL`),
    authorCreatedIdx: index("project_updates_author_created_idx").on(
      t.authorId,
      t.createdAt.desc(),
    ),
    deletedAtIdx: index("project_updates_deleted_at_idx").on(t.deletedAt),
    likeCountNonNegative: check(
      "project_updates_like_count_nonnegative",
      sql`${t.likeCount} >= 0`,
    ),
    commentCountNonNegative: check(
      "project_updates_comment_count_nonnegative",
      sql`${t.commentCount} >= 0`,
    ),
  }),
);

export const projectUpdateMediaAssets = pgTable(
  "project_update_media_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    updateId: uuid("update_id")
      .notNull()
      .references(() => projectUpdates.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references((): AnyPgColumn => storageAssets.id, { onDelete: "restrict" }),
    ordinal: integer("ordinal").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    updateOrdinalUnique: uniqueIndex("project_update_media_assets_update_ordinal_unique").on(
      t.updateId,
      t.ordinal,
    ),
    updateAssetUnique: uniqueIndex("project_update_media_assets_update_asset_unique").on(
      t.updateId,
      t.assetId,
    ),
    assetIdx: index("project_update_media_assets_asset_idx").on(t.assetId),
  }),
);

export const projectUpdateDrafts = pgTable(
  "project_update_drafts",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    content: text("content").default("").notNull(),
    visibility: text("visibility", { enum: ["public", "members"] })
      .default("public")
      .notNull(),
    updateType: text("update_type", {
      enum: [
        "progress",
        "milestone",
        "release",
        "blocker",
        "decision",
        "collaboration_request",
        "behind_the_scenes",
        "announcement",
        "discussion",
      ],
    }),
    entityRefs: jsonb("entity_refs")
      .$type<ProjectUpdateEntityRefs>()
      .default({})
      .notNull(),
    media: jsonb("media")
      .$type<ProjectUpdateMediaItem[]>()
      .default([])
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.projectId, t.userId] }),
    updatedAtIdx: index("project_update_drafts_updated_at_idx").on(t.updatedAt),
    userIdx: index("project_update_drafts_user_idx").on(t.userId),
  }),
);

export const projectUpdateDraftMediaAssets = pgTable(
  "project_update_draft_media_assets",
  {
    projectId: uuid("project_id").notNull(),
    userId: uuid("user_id").notNull(),
    assetId: uuid("asset_id")
      .notNull()
      .references((): AnyPgColumn => storageAssets.id, { onDelete: "restrict" }),
    ordinal: integer("ordinal").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.projectId, t.userId, t.assetId] }),
    draftOrdinalUnique: uniqueIndex("project_update_draft_media_assets_ordinal_unique").on(
      t.projectId,
      t.userId,
      t.ordinal,
    ),
    assetIdx: index("project_update_draft_media_assets_asset_idx").on(t.assetId),
    draftFk: foreignKey({
      columns: [t.projectId, t.userId],
      foreignColumns: [projectUpdateDrafts.projectId, projectUpdateDrafts.userId],
    }).onDelete("cascade"),
  }),
);

export const projectUpdateLikes = pgTable(
  "project_update_likes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    updateId: uuid("update_id")
      .notNull()
      .references(() => projectUpdates.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    updateIdx: index("project_update_likes_update_idx").on(t.updateId),
    userIdx: index("project_update_likes_user_idx").on(t.userId),
    uniqueLike: uniqueIndex("project_update_likes_unique").on(
      t.updateId,
      t.userId,
    ),
  }),
);

export const projectUpdateComments = pgTable(
  "project_update_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    updateId: uuid("update_id")
      .notNull()
      .references(() => projectUpdates.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id"),
    userId: uuid("user_id").references(() => profiles.id, {
      onDelete: "set null",
    }),
    targetUserId: uuid("target_user_id").references(() => profiles.id, {
      onDelete: "set null",
    }),
    content: text("content").notNull(),
    deletedBy: uuid("deleted_by").references(() => profiles.id, {
      onDelete: "set null",
    }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    updateCreatedIdx: index("project_update_comments_update_created_idx").on(
      t.updateId,
      t.createdAt,
      t.id,
    ),
    updateActiveIdx: index("project_update_comments_update_active_idx")
      .on(t.updateId, t.createdAt)
      .where(sql`${t.deletedAt} IS NULL`),
    parentIdx: index("project_update_comments_parent_idx")
      .on(t.parentId, t.updateId)
      .where(sql`${t.parentId} IS NOT NULL`),
    projectCreatedIdx: index("project_update_comments_project_created_idx").on(
      t.projectId,
      t.createdAt.desc(),
    ),
    userCreatedIdx: index("project_update_comments_user_created_idx").on(
      t.userId,
      t.createdAt.desc(),
    ),
    activeParentIdx: index("project_update_comments_active_parent_idx")
      .on(t.updateId, t.parentId, t.createdAt.desc())
      .where(sql`${t.deletedAt} IS NULL`),
    deletedByIdx: index("project_update_comments_deleted_by_idx").on(
      t.deletedBy,
    ),
    targetUserIdx: index("project_update_comments_target_user_idx").on(
      t.targetUserId,
    ),
  }),
);

// ============================================================================
// SPRINTS TABLE
// ============================================================================
export const projectSprints = pgTable(
  "project_sprints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    creatorId: uuid("creator_id").references(() => profiles.id, {
      onDelete: "set null",
    }),
    sprintNumber: integer("sprint_number").notNull(),
    name: text("name").notNull(),
    goal: text("goal"),
    description: text("description"),
    startDate: timestamp("start_date", { withTimezone: true }).notNull(),
    endDate: timestamp("end_date", { withTimezone: true }).notNull(),
    status: statusSprintEnum("status").default("planning").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    // Org sprints (0243): a child project's sprint inside an org sprint; opt out of starting on the date.
    parentSprintId: uuid("parent_sprint_id").references((): AnyPgColumn => projectSprints.id, { onDelete: "set null" }),
    autoStart: boolean("auto_start").default(true).notNull(),
    showInChildren: boolean("show_in_children").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    parentIdx: index("project_sprints_parent_idx").on(t.parentSprintId).where(sql`${t.parentSprintId} IS NOT NULL`),
    projectNumberIdx: uniqueIndex("project_sprints_project_number_idx").on(
      t.projectId,
      t.sprintNumber,
    ),
    oneActivePerProjectIdx: uniqueIndex("project_sprints_one_active_idx")
      .on(t.projectId)
      .where(sql`${t.status} = 'active'`),
    projectUpdatedIdx: index("project_sprints_project_updated_idx").on(
      t.projectId,
      t.updatedAt,
    ),
    statusIdx: index("project_sprints_status_idx").on(t.status),
    creatorIdx: index("project_sprints_creator_idx").on(t.creatorId),
  }),
);

// One task can participate in many Sprints over time. Current placement stays
// on tasks.sprint_id for fast task-board reads; this table is the durable history.
export const sprintTaskMemberships = pgTable(
  "sprint_task_memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    sprintId: uuid("sprint_id")
      .notNull()
      .references(() => projectSprints.id, { onDelete: "restrict" }),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "restrict" }),
    addedBy: uuid("added_by").references(() => profiles.id, {
      onDelete: "set null",
    }),
    removedBy: uuid("removed_by").references(() => profiles.id, {
      onDelete: "set null",
    }),
    addedAt: timestamp("added_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    removedAt: timestamp("removed_at", { withTimezone: true }),
  },
  (t) => ({
    sprintAddedIdx: index("sprint_task_memberships_sprint_added_idx").on(
      t.sprintId,
      t.addedAt,
      t.id,
    ),
    taskAddedIdx: index("sprint_task_memberships_task_added_idx").on(
      t.taskId,
      t.addedAt.desc(),
    ),
    activeTaskIdx: uniqueIndex("sprint_task_memberships_active_task_idx")
      .on(t.taskId)
      .where(sql`${t.removedAt} IS NULL`),
    addedByIdx: index("sprint_task_memberships_added_by_idx").on(t.addedBy),
    projectIdIdx: index("sprint_task_memberships_project_id_idx").on(
      t.projectId,
    ),
    removedByIdx: index("sprint_task_memberships_removed_by_idx").on(
      t.removedBy,
    ),
  }),
);

// A sprint is a project-level lifecycle, so its audit trail cannot live on a
// task. Keep this deliberately narrow: only durable lifecycle transitions and
// edits belong here; task activity remains in task_activity_events.
export const projectSprintEvents = pgTable(
  "project_sprint_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    sprintId: uuid("sprint_id")
      .notNull()
      .references(() => projectSprints.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => profiles.id, {
      onDelete: "set null",
    }),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    sprintCreatedIdx: index("project_sprint_events_sprint_created_idx").on(
      t.sprintId,
      t.createdAt.desc(),
    ),
    projectCreatedIdx: index("project_sprint_events_project_created_idx").on(
      t.projectId,
      t.createdAt.desc(),
    ),
    actorIdx: index("project_sprint_events_actor_idx").on(t.actorId),
  }),
);

// Project-owned columns provide flexible presentation while `tasks.status` remains the analytics category.
export const projectWorkflowColumns = pgTable(
  "project_workflow_columns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    status: statusTaskEnum("status").notNull(),
    title: text("title").notNull(),
    accentClassName: text("accent_class_name").notNull(),
    emptyTitle: text("empty_title").notNull(),
    emptyDescription: text("empty_description").notNull(),
    position: integer("position").notNull(),
    isDefault: boolean("is_default").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    projectPositionIdx: uniqueIndex(
      "project_workflow_columns_project_position_idx",
    ).on(t.projectId, t.position),
    projectDefaultStatusIdx: uniqueIndex(
      "project_workflow_columns_project_default_status_idx",
    )
      .on(t.projectId, t.status)
      .where(sql`${t.isDefault} = TRUE`),
  }),
);

// ============================================================================
// TASKS TABLE
// ============================================================================
export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    workflowColumnId: uuid("workflow_column_id").references(
      () => projectWorkflowColumns.id,
      { onDelete: "set null" },
    ),
    sprintId: uuid("sprint_id").references(() => projectSprints.id, {
      onDelete: "set null",
    }),
    // Legacy first-Sprint snapshot retained for backwards compatibility.
    // New Sprint history reads and writes use sprint_task_memberships.
    timelineOriginSprintId: uuid("timeline_origin_sprint_id").references(
      () => projectSprints.id,
      { onDelete: "set null" },
    ),
    timelineOriginAt: timestamp("timeline_origin_at", { withTimezone: true }),
    assigneeId: uuid("assignee_id").references(() => profiles.id, {
      onDelete: "set null",
    }),
    creatorId: uuid("creator_id").references(() => profiles.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    description: text("description"),
    status: statusTaskEnum("status").default("todo").notNull(),
    reviewStatus: text("review_status", {
      enum: ["none", "pending", "rejected"],
    })
      .default("none")
      .notNull(),
    reviewSubmittedAt: timestamp("review_submitted_at", { withTimezone: true }),
    reviewContentHash: text("review_content_hash"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedBy: uuid("completed_by").references(() => profiles.id, { onDelete: "set null" }),
    completionSource: text("completion_source", { enum: ["direct", "review", "legacy"] }),
    position: doublePrecision("position"),
    priority: text("priority", { enum: ["low", "medium", "high", "urgent"] })
      .default("medium")
      .notNull(),

    // Project Key System
    taskNumber: integer("task_number"), // e.g. 12 (displayed as NB-12)

    storyPoints: integer("story_points"),
    dueDate: timestamp("due_date", { withTimezone: true }),
    // Assignments (0244): masters have kind "assignment"; copies point to theirs with assignmentId.
    kind: text("kind", { enum: ["task", "assignment"] }).default("task").notNull(),
    assignmentId: uuid("assignment_id").references((): AnyPgColumn => tasks.id, { onDelete: "cascade" }),
    assignmentSettings: jsonb("assignment_settings").$type<import("@/lib/organizations/assignment-rules").AssignmentSettings>(),
    submission: jsonb("submission").$type<import("@/lib/organizations/assignment-rules").AssignmentSubmission>(),
    excusedAt: timestamp("excused_at", { withTimezone: true }),
    excusedReason: text("excused_reason"),
    teamName: text("team_name"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    completedByIdx: index("tasks_completed_by_idx").on(t.completedBy),
    assignmentIdx: index("tasks_assignment_idx").on(t.assignmentId).where(sql`${t.assignmentId} IS NOT NULL`),
    kindCheck: check("tasks_kind_check", sql`${t.kind} IN ('task', 'assignment')`),
    pendingReviewIdx: index("tasks_pending_review_idx").on(t.projectId).where(sql`${t.reviewStatus} = 'pending' AND ${t.deletedAt} IS NULL`),
    workflowColumnIdx: index("tasks_workflow_column_idx").on(
      t.workflowColumnId,
    ),
    sprintIdx: index("tasks_sprint_id_idx").on(t.sprintId),
    timelineOriginSprintIdx: index("tasks_timeline_origin_sprint_idx").on(
      t.timelineOriginSprintId,
      t.timelineOriginAt,
      t.id,
    ),
    assigneeIdx: index("tasks_assignee_idx").on(t.assigneeId),
    statusIdx: index("tasks_status_idx").on(t.status),
    assigneeStatusDueIdx: index("tasks_assignee_status_due_idx").on(
      t.assigneeId,
      t.status,
      t.dueDate,
    ),
    // Composite indexes for filtering
    projectStatusIdx: index("tasks_project_status_idx").on(
      t.projectId,
      t.status,
    ),
    projectSprintIdx: index("tasks_project_sprint_idx").on(
      t.projectId,
      t.sprintId,
    ),
    projectAssigneeIdx: index("tasks_project_assignee_idx").on(
      t.projectId,
      t.assigneeId,
    ),
    projectUpdatedIdx: index("tasks_project_updated_idx").on(
      t.projectId,
      t.updatedAt,
    ),
    // Optimization: GIN Index for fast title search (Tasks Search Optimization)
    titleSearchIdx: index("tasks_title_search_idx").using(
      "gin",
      sql`${t.title} gin_trgm_ops`,
    ),
    // Optimization: Creator Index for "My Tasks"
    creatorIdx: index("tasks_creator_id_idx").on(t.creatorId),
    projectNumberIdx: index("tasks_project_number_idx").on(
      t.projectId,
      t.taskNumber,
    ),
    activeProjectStatusPositionIdx: index(
      "tasks_active_project_status_position_idx",
    )
      .on(
        t.projectId,
        t.status,
        t.position.desc(),
        t.createdAt.desc(),
        t.id.desc(),
      )
      .where(sql`${t.deletedAt} IS NULL`),
  }),
);

// Durable task lifecycle events. The task itself is soft-deleted, so its audit trail remains available to owners.
export const projectTaskPolicyEvents = pgTable("project_task_policy_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  actorId: uuid("actor_id").references(() => profiles.id, { onDelete: "set null" }),
  reviewRequired: boolean("review_required").notNull(),
  policyVersion: integer("policy_version").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({ projectVersionIdx: uniqueIndex("project_task_policy_events_version_idx").on(t.projectId, t.policyVersion), actorIdx: index("project_task_policy_events_actor_idx").on(t.actorId) }));

export const taskActivityEvents = pgTable(
  "task_activity_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // This is the sprint at the moment the event happened. Do not derive it
    // from tasks.sprint_id: tasks can move after the activity was recorded.
    sprintId: uuid("sprint_id").references(() => projectSprints.id, {
      onDelete: "set null",
    }),
    actorId: uuid("actor_id").references(() => profiles.id, {
      onDelete: "set null",
    }),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    taskCreatedIdx: index("task_activity_events_task_created_idx").on(
      t.taskId,
      t.createdAt.desc(),
    ),
    projectCreatedIdx: index("task_activity_events_project_created_idx").on(
      t.projectId,
      t.createdAt.desc(),
    ),
    sprintCreatedIdx: index("task_activity_events_sprint_created_idx").on(
      t.projectId,
      t.sprintId,
      t.createdAt,
      t.id,
    ),
    sprintIdx: index("task_activity_events_sprint_idx").on(t.sprintId),
    actorIdx: index("task_activity_events_actor_idx").on(t.actorId),
  }),
);

// ============================================================================
// TASK SUBTASKS TABLE
// ============================================================================
export const taskSubtasks = pgTable(
  "task_subtasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    completed: boolean("completed").default(false).notNull(),
    position: integer("position").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    taskPositionIdx: index("task_subtasks_position_idx").on(
      t.taskId,
      t.position,
    ),
    taskCompletedIdx: index("task_subtasks_task_completed_idx").on(
      t.taskId,
      t.completed,
    ),
  }),
);
// ============================================================================
// TASK READ RECEIPTS TABLE
// ============================================================================
export const taskReadReceipts = pgTable(
  "task_read_receipts",
  {
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    lastReadAt: timestamp("last_read_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.taskId, t.userId] }),
    userTaskReadIdx: index("task_read_receipts_user_task_idx").on(
      t.userId,
      t.taskId,
    ),
  }),
);

// ============================================================================
// TASK COMMENTS TABLE
// ============================================================================
export const taskComments = pgTable(
  "task_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    parentCommentId: uuid("parent_comment_id").references(
      (): AnyPgColumn => taskComments.id,
      { onDelete: "cascade" },
    ),
    content: text("content").notNull(),
    deletedBy: uuid("deleted_by").references(() => profiles.id, {
      onDelete: "set null",
    }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    createdAtIdx: index("task_comments_created_at_idx").on(
      t.taskId,
      t.createdAt,
    ),
    parentCreatedAtIdx: index("task_comments_parent_created_at_idx").on(
      t.taskId,
      t.parentCommentId,
      t.createdAt,
    ),
    taskCreatedActiveIdx: index("task_comments_task_created_active_idx")
      .on(t.taskId, t.createdAt.desc())
      .where(sql`${t.deletedAt} IS NULL`),
    parentIdx: index("task_comments_parent_id_idx").on(t.parentCommentId),
    deletedByIdx: index("task_comments_deleted_by_idx").on(t.deletedBy),
    userIdx: index("task_comments_user_id_idx").on(t.userId),
  }),
);

// ============================================================================
// TASK COMMENT LIKES TABLE
// ============================================================================
export const taskCommentLikes = pgTable(
  "task_comment_likes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    commentId: uuid("comment_id")
      .notNull()
      .references(() => taskComments.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    commentIdx: index("task_comment_likes_comment_id_idx").on(t.commentId),
    userIdx: index("task_comment_likes_user_id_idx").on(t.userId),
    uniqueLike: uniqueIndex("task_comment_likes_unique").on(
      t.commentId,
      t.userId,
    ),
  }),
);

// ============================================================================
// COMMENT MENTIONS TABLE
// One row per (comment, mentioned_user) pair. Raw mention text lives inside
// `taskComments.content` as `@{userId|DisplayName}` tokens; this table is the
// indexed projection used for notification fan-out and mention-inbox queries.
// ============================================================================
export const commentMentions = pgTable(
  "comment_mentions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    commentId: uuid("comment_id")
      .notNull()
      .references(() => taskComments.id, { onDelete: "cascade" }),
    mentionedUserId: uuid("mentioned_user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    uniquePair: uniqueIndex("comment_mentions_comment_user_unique").on(
      t.commentId,
      t.mentionedUserId,
    ),
    userCreatedIdx: index("comment_mentions_user_created_idx").on(
      t.mentionedUserId,
      t.createdAt,
    ),
    commentIdx: index("comment_mentions_comment_idx").on(t.commentId),
  }),
);

// ============================================================================
// USER NOTIFICATIONS
// ============================================================================
export const userNotifications = pgTable(
  "user_notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id").references(() => profiles.id, {
      onDelete: "set null",
    }),
    kind: text("kind").notNull(),
    importance: text("importance", { enum: ["important", "more"] })
      .notNull()
      .default("more"),
    title: text("title").notNull(),
    body: text("body"),
    href: text("href"),
    entityRefs: jsonb("entity_refs")
      .$type<UserNotificationEntityRefs | null>()
      .default(null),
    preview: jsonb("preview")
      .$type<UserNotificationPreview | null>()
      .default(null),
    dedupeKey: text("dedupe_key").notNull(),
    aggregateCount: integer("aggregate_count").notNull().default(1),
    readAt: timestamp("read_at", { withTimezone: true }),
    seenAt: timestamp("seen_at", { withTimezone: true }),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    // Event activity and viewer-state mutations have different semantics. The
    // tray is ordered by activityAt so reading/snoozing an item never makes it
    // jump to the top of the feed.
    activityAt: timestamp("activity_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    userUpdatedIdx: index("user_notifications_user_updated_idx").on(
      t.userId,
      t.updatedAt,
    ),
    userActivityIdx: index("user_notifications_user_activity_idx").on(
      t.userId,
      t.activityAt,
    ),
    userReadIdx: index("user_notifications_user_read_idx").on(
      t.userId,
      t.readAt,
    ),
    userDismissedIdx: index("user_notifications_user_dismissed_idx").on(
      t.userId,
      t.dismissedAt,
    ),
    userSnoozedIdx: index("user_notifications_user_snoozed_idx").on(
      t.userId,
      t.snoozedUntil,
    ),
    trayVisibleIdx: index("user_notifications_tray_visible_idx")
      .on(t.userId, t.updatedAt)
      .where(sql`${t.dismissedAt} IS NULL`),
    trayVisibleActivityIdx: index(
      "user_notifications_tray_visible_activity_idx",
    )
      .on(t.userId, t.activityAt)
      .where(sql`${t.dismissedAt} IS NULL`),
    unreadIdx: index("user_notifications_unread_idx")
      .on(t.userId, t.importance)
      .where(sql`${t.readAt} IS NULL AND ${t.dismissedAt} IS NULL`),
    dismissedAgeIdx: index("user_notifications_dismissed_age_idx")
      .on(t.dismissedAt)
      .where(sql`${t.dismissedAt} IS NOT NULL`),
    readAgeIdx: index("user_notifications_read_age_idx")
      .on(t.readAt)
      .where(sql`${t.readAt} IS NOT NULL AND ${t.dismissedAt} IS NULL`),
    userDedupeUnique: uniqueIndex("user_notifications_user_dedupe_unique").on(
      t.userId,
      t.dedupeKey,
    ),
    actorUserIdIdx: index("user_notifications_actor_user_id_idx").on(
      t.actorUserId,
    ),
  }),
);

// ============================================================================
// PUSH SUBSCRIPTIONS (WEB PUSH)
// ============================================================================
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgent: text("user_agent"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    failureCount: integer("failure_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    endpointUnique: uniqueIndex("push_subscriptions_endpoint_unique").on(
      t.endpoint,
    ),
    userIdx: index("push_subscriptions_user_idx").on(t.userId),
    staleIdx: index("push_subscriptions_stale_idx").on(t.lastSeenAt),
  }),
);

// ============================================================================
// NOTIFICATION DELIVERIES (per-channel attempt log)
// ============================================================================
export const notificationDeliveries = pgTable(
  "notification_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    notificationId: uuid("notification_id").references(
      () => userNotifications.id,
      { onDelete: "cascade" },
    ),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    channel: text("channel", {
      enum: ["in_app", "web_push", "email"],
    }).notNull(),
    status: statusNotificationEnum("status").notNull(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    attemptedAt: timestamp("attempted_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    channelStatusTimeIdx: index(
      "notification_deliveries_channel_status_time_idx",
    ).on(t.channel, t.status, t.attemptedAt.desc()),
    userTimeIdx: index("notification_deliveries_user_time_idx").on(
      t.userId,
      t.attemptedAt.desc(),
    ),
    notificationIdx: index("notification_deliveries_notification_idx")
      .on(t.notificationId)
      .where(sql`${t.notificationId} IS NOT NULL`),
    notificationChannelStatusIdx: index(
      "notification_deliveries_notif_channel_status_idx",
    )
      .on(t.notificationId, t.channel, t.status)
      .where(sql`${t.notificationId} IS NOT NULL`),
    userStatusCoveringIdx: index(
      "notification_deliveries_user_status_covering_idx",
    ).on(t.userId, t.status, t.attemptedAt.desc()),
  }),
);

// Server-only transactional mail. No browser/Data API grants or realtime publication.
export const emailOutbox = pgTable("email_outbox", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventKey: text("event_key").notNull(),
  kind: text("kind").$type<EmailKind>().notNull(),
  // Null only for invitations to an address without an account (toEmail).
  userId: uuid("user_id").references(() => profiles.id, { onDelete: "cascade" }),
  toEmail: text("to_email"),
  data: jsonb("data").$type<Record<string, unknown>>(),
  actorId: uuid("actor_id"),
  projectId: uuid("project_id"),
  taskId: uuid("task_id"),
  status: text("status").$type<"pending" | "processing" | "accepted" | "dropped" | "failed" | "needs_review">().default("pending").notNull(),
  dueAt: timestamp("due_at", { withTimezone: true }).defaultNow().notNull(),
  leaseId: uuid("lease_id"),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  attempts: integer("attempts").default(0).notNull(),
  firstAttemptAt: timestamp("first_attempt_at", { withTimezone: true }),
  payload: jsonb("payload").$type<EmailPayload>(),
  providerId: uuid("provider_id"),
  deliveryState: text("delivery_state").$type<EmailDeliveryState>(),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  eventIdx: uniqueIndex("email_outbox_event_idx").on(t.eventKey),
  userIdx: index("email_outbox_user_idx").on(t.userId),
  providerIdx: uniqueIndex("email_outbox_provider_idx").on(t.providerId),
  dueIdx: index("email_outbox_due_idx").on(t.dueAt).where(sql`${t.status} = 'pending'`),
  leaseIdx: index("email_outbox_lease_idx").on(t.leaseExpiresAt).where(sql`${t.status} = 'processing'`),
  kindCheck: check("email_outbox_kind_check", sql`${t.kind} IN ('welcome', 'task_assignment', 'org_ready', 'org_invite', 'org_invite_signup', 'org_welcome', 'org_assignment', 'org_due_soon', 'org_overdue', 'org_returned', 'org_announcement', 'org_ended', 'org_digest', 'org_removed', 'org_ownership', 'org_deleted', 'security_password_changed', 'security_mfa_changed', 'security_token_created', 'account_deletion_scheduled', 'account_deletion_cancelled', 'account_deletion_reminder')`),
  recipientCheck: check("email_outbox_recipient_check", sql`${t.userId} IS NOT NULL OR ${t.toEmail} IS NOT NULL`),
  statusCheck: check("email_outbox_status_check", sql`${t.status} IN ('pending', 'processing', 'accepted', 'dropped', 'failed', 'needs_review')`),
  attemptsCheck: check("email_outbox_attempts_check", sql`${t.attempts} >= 0`),
  deliveryCheck: check("email_outbox_delivery_check", sql`${t.deliveryState} IN ('accepted', 'delivered', 'failed', 'bounced', 'complained')`),
}));

export const emailWebhookEvents = pgTable("email_webhook_events", {
  id: text("id").primaryKey(),
  providerId: uuid("provider_id").notNull(),
  state: text("state").$type<EmailDeliveryState>().notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  providerIdx: index("email_webhook_events_provider_idx").on(t.providerId),
  stateCheck: check("email_webhook_events_state_check", sql`${t.state} IN ('accepted', 'delivered', 'failed', 'bounced', 'complained')`),
}));

export const emailSuppressions = pgTable("email_suppressions", {
  email: text("email").primaryKey(),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({ reasonCheck: check("email_suppressions_reason_check", sql`${t.reason} IN ('hard_bounce', 'complaint')`) }));

export const notificationDeliveriesRelations = relations(
  notificationDeliveries,
  ({ one }) => ({
    notification: one(userNotifications, {
      fields: [notificationDeliveries.notificationId],
      references: [userNotifications.id],
    }),
    user: one(profiles, {
      fields: [notificationDeliveries.userId],
      references: [profiles.id],
    }),
  }),
);

// ============================================================================
// JOB HEARTBEATS (watchdog for recurring background jobs)
// ============================================================================
export const jobHeartbeats = pgTable("job_heartbeats", {
  jobId: text("job_id").primaryKey(),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }).notNull(),
  lastPayload: jsonb("last_payload"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// ============================================================================
// PROJECT NODES (FILE SYSTEM)
// ============================================================================
export const projectNodes = pgTable(
  "project_nodes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id"),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "cascade" }),
    canonicalNodeId: uuid("canonical_node_id").references(
      (): AnyPgColumn => projectNodes.id,
      { onDelete: "set null" },
    ),
    path: text("path").notNull().default("/"),
    // Circular ref handled by foreignKey below
    type: text("type", { enum: ["folder", "file"] }).notNull(),
    name: text("name").notNull(),

    // File specifics
    s3Key: text("s3_key"),
    assetId: uuid("asset_id").references(
      (): AnyPgColumn => storageAssets.id,
      { onDelete: "set null" },
    ),
    size: bigint("size", { mode: "number" }).default(0),
    mimeType: text("mime_type"),
    // Version counter — bumped each time replaceNodeWithNewVersion() lands a
    // new blob for this file node. Folders always stay at 1.  A pill of "vN"
    // is rendered in the Files tab whenever current_version > 1.
    currentVersion: integer("current_version").notNull().default(1),

    // Metadata
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),

    // Git tracking
    gitHash: text("git_blob_hash"),
    lastSyncedCommitSha: text("last_synced_commit_sha"),
    syncStatus: text("sync_status").default("merged").notNull(),

    // Audit
    createdBy: uuid("created_by").references(() => profiles.id, {
      onDelete: "set null",
    }),
    deletedBy: uuid("deleted_by").references(() => profiles.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    parentIdx: index("project_nodes_parent_id_idx").on(t.parentId),
    projectPathIdx: index("project_nodes_project_path_idx").on(
      t.projectId,
      t.path,
    ),
    // Optimization: Covered Index for listing (Listing Optimization)
    // Allows "Index Only Scan" for getProjectNodes which filters by (projectId, parentId) and sorts by (type, name)
    listingIdx: index("project_nodes_listing_idx").on(
      t.projectId,
      t.parentId,
      t.type,
      t.name,
    ),
    projectUpdatedIdx: index("project_nodes_project_updated_idx").on(
      t.projectId,
      t.updatedAt,
    ),
    taskStatusIdx: index("project_nodes_task_status_idx").on(
      t.projectId,
      t.taskId,
      t.syncStatus,
    ),
    canonicalIdx: index("project_nodes_canonical_idx").on(
      t.projectId,
      t.canonicalNodeId,
    ),
    canonicalNodeFkIdx: index("project_nodes_canonical_node_idx").on(
      t.canonicalNodeId,
    ),
    taskFkIdx: index("project_nodes_task_idx").on(t.taskId),
    syncGitIdx: index("project_nodes_sync_git_idx").on(
      t.projectId,
      t.syncStatus,
      t.gitHash,
    ),
    activeParentNameIdx: uniqueIndex("project_nodes_active_parent_name_unique")
      .on(
        t.projectId,
        sql`COALESCE(${t.parentId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
        sql`LOWER(${t.name})`,
        sql`COALESCE(${t.taskId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      )
      .where(sql`${t.deletedAt} IS NULL`),
    activeProjectPathIdx: uniqueIndex("project_nodes_active_project_path_unique")
      .on(
        t.projectId,
        t.path,
        sql`COALESCE(${t.taskId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      )
      .where(sql`${t.deletedAt} IS NULL`),
    // Self-referencing FK with cascade
    parentFk: foreignKey({
      columns: [t.parentId],
      foreignColumns: [t.id],
    }).onDelete("cascade"),
    noSelfParentCheck: check(
      "project_nodes_no_self_parent_check",
      sql`${t.parentId} IS NULL OR ${t.parentId} <> ${t.id}`,
    ),
    createdByIdx: index("project_nodes_created_by_idx").on(t.createdBy),
    deletedByIdx: index("project_nodes_deleted_by_idx").on(t.deletedBy),
    deletedAtPartialIdx: index("project_nodes_deleted_at_partial_idx")
      .on(t.deletedAt)
      .where(sql`${t.deletedAt} IS NULL`),
    projectTrashedIdx: index("project_nodes_trashed_idx")
      .on(t.projectId, t.deletedAt.desc())
      .where(sql`${t.deletedAt} IS NOT NULL`),
    activeParentIdx: index("project_nodes_active_parent_idx")
      .on(t.projectId, t.parentId)
      .where(sql`${t.deletedAt} IS NULL`),
    activeFileIdx: index("project_nodes_active_file_idx")
      .on(t.projectId, t.id)
      .where(sql`${t.type} = 'file' AND ${t.deletedAt} IS NULL`),
    activeFileS3KeyIdx: index("project_nodes_active_file_s3_key_idx")
      .on(t.s3Key.op("text_pattern_ops"))
      .where(sql`${t.type} = 'file' AND ${t.deletedAt} IS NULL`),
    assetIdx: index("project_nodes_asset_idx").on(t.assetId),
    permanentDeleteRootIdx: index("project_nodes_permanent_delete_root_idx")
      .on(t.updatedAt)
      .where(sql`${t.deletedAt} IS NOT NULL AND (${t.metadata}->>'permanentDeleteRoot') = ${t.id}::text`),
  }),
);

// ============================================================================
// FILE VERSIONS
// Version history sidecar for `projectNodes` rows where type='file'. Each row
// captures the blob metadata for a specific version; the newest row for a
// node has version = projectNodes.currentVersion. Inserts go through the
// Canonical mutations go through `applyFileRevision`: new revisions append,
// while an explicit active-revision save updates only the current row.
// ============================================================================
export const fileVersions = pgTable(
  "file_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    nodeId: uuid("node_id")
      .notNull()
      .references(() => projectNodes.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    s3Key: text("s3_key").notNull(),
    assetId: uuid("asset_id").references(
      (): AnyPgColumn => storageAssets.id,
      { onDelete: "set null" },
    ),
    size: bigint("size", { mode: "number" }).notNull(),
    mimeType: text("mime_type").notNull(),
    // Lowercase hex SHA-256 of the blob. NULL only for legacy rows backfilled
    // by migration 0069; subsequent uploads always populate this for dedup.
    contentHash: text("content_hash"),
    uploadedBy: uuid("uploaded_by").references(() => profiles.id, {
      onDelete: "set null",
    }),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    // Optional version note supplied by the uploader ("fixed typo", etc).
    comment: text("comment"),
    attribution: jsonb("attribution").$type<Record<string, unknown>>().default({}).notNull(),
  },
  (t) => ({
    uniqueNodeVersion: uniqueIndex("file_versions_node_version_unique").on(
      t.nodeId,
      t.version,
    ),
    contentHashIdx: index("file_versions_content_hash_idx").on(t.contentHash),
    assetIdx: index("file_versions_asset_idx").on(t.assetId),
    uploadedByIdx: index("file_versions_uploaded_by_idx").on(t.uploadedBy),
    nodeUploadedAtIdx: index("file_versions_node_uploaded_at_idx").on(
      t.nodeId,
      t.uploadedAt.desc(),
    ),
  }),
);

// Server-owned object lifecycle. Domain tables keep their own authorization;
// this ledger owns byte identity, verification, quota accounting, and deletion.
export const storageAssets = pgTable(
  "storage_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Deliberately retained after profile/project deletion so cleanup and
    // quota evidence cannot disappear with the domain row.
    ownerUserId: uuid("owner_user_id"),
    projectId: uuid("project_id"),
    bucket: text("bucket").notNull(),
    storageKey: text("storage_key").notNull(),
    purpose: text("purpose").notNull(),
    state: text("state", {
      enum: ["pending", "verified", "delete_pending", "deleting", "deleted", "missing"],
    }).default("pending").notNull(),
    declaredMimeType: text("declared_mime_type").notNull(),
    declaredSize: bigint("declared_size", { mode: "number" }).notNull(),
    verifiedMimeType: text("verified_mime_type"),
    verifiedSize: bigint("verified_size", { mode: "number" }),
    contentHash: text("content_hash"),
    sourceAssetId: uuid("source_asset_id").references(
      (): AnyPgColumn => storageAssets.id,
      { onDelete: "set null" },
    ),
    idempotencyKey: text("idempotency_key"),
    requestFingerprint: text("request_fingerprint"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
    // Exactly one physical object in a derivative chain owns the logical
    // quota charge. Private staging can therefore be replaced by a verified
    // public derivative without double charging during publication.
    quotaTracked: boolean("quota_tracked").default(true).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    verificationLeaseToken: uuid("verification_lease_token"),
    verificationLeaseExpiresAt: timestamp("verification_lease_expires_at", { withTimezone: true }),
    verificationFence: bigint("verification_fence", { mode: "number" }).default(0).notNull(),
    deleteAfter: timestamp("delete_after", { withTimezone: true }),
    deletionLeaseToken: uuid("deletion_lease_token"),
    deletionLeaseExpiresAt: timestamp("deletion_lease_expires_at", { withTimezone: true }),
    deletionFence: bigint("deletion_fence", { mode: "number" }).default(0).notNull(),
    backupState: text("backup_state", { enum: ["not_required", "pending", "verified"] })
      .default("not_required")
      .notNull(),
    lastErrorCode: text("last_error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    bucketKeyUnique: uniqueIndex("storage_assets_bucket_key_unique").on(t.bucket, t.storageKey),
    ownerIdempotencyUnique: uniqueIndex("storage_assets_owner_purpose_idempotency_unique")
      .on(t.ownerUserId, t.purpose, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} IS NOT NULL AND ${t.ownerUserId} IS NOT NULL`),
    stateExpiryIdx: index("storage_assets_state_expiry_idx").on(t.state, t.expiresAt, t.id),
    verificationLeaseIdx: index("storage_assets_verification_lease_idx")
      .on(t.state, t.verificationLeaseExpiresAt, t.id)
      .where(sql`${t.state} = 'pending'`),
    verificationWorkIdx: index("storage_assets_verification_work_idx")
      .on(t.verificationLeaseExpiresAt, t.updatedAt, t.id)
      .where(sql`${t.state} = 'pending' AND (${t.verificationLeaseToken} IS NOT NULL OR ${t.lastErrorCode} IS NOT NULL)`),
    backupDueIdx: index("storage_assets_backup_due_idx")
      .on(t.verifiedAt, t.id)
      .where(sql`${t.backupState} = 'pending' AND ${t.state} IN ('verified', 'delete_pending')`),
    deletionDueIdx: index("storage_assets_deletion_due_idx")
      .on(t.deleteAfter, t.id)
      .where(sql`${t.state} = 'delete_pending'`),
    ownerIdx: index("storage_assets_owner_idx").on(t.ownerUserId, t.createdAt),
    projectIdx: index("storage_assets_project_idx").on(t.projectId, t.createdAt),
    sourceIdx: index("storage_assets_source_idx").on(t.sourceAssetId),
    declaredSizeCheck: check("storage_assets_declared_size_check", sql`${t.declaredSize} >= 0`),
    verifiedSizeCheck: check(
      "storage_assets_verified_size_check",
      sql`${t.verifiedSize} IS NULL OR ${t.verifiedSize} >= 0`,
    ),
    verificationFenceCheck: check(
      "storage_assets_verification_fence_check",
      sql`${t.verificationFence} >= 0`,
    ),
    deletionFenceCheck: check(
      "storage_assets_deletion_fence_check",
      sql`${t.deletionFence} >= 0`,
    ),
  }),
);

/** Durable lease with a rising fence for long-running work (ARCH-001). Server-only. */
export const workLeases = pgTable("work_leases", {
  scope: text("scope").primaryKey(),
  leaseId: uuid("lease_id").notNull(),
  fence: bigint("fence", { mode: "number" }).default(1).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/** Redis counter batches already applied to PostgreSQL; the batch id makes a replayed flush a no-op. Server-only. */
export const counterFlushBatches = pgTable("counter_flush_batches", {
  batchId: text("batch_id").primaryKey(),
  kind: text("kind").notNull(),
  entryCount: integer("entry_count").default(0).notNull(),
  appliedAt: timestamp("applied_at", { withTimezone: true }).defaultNow().notNull(),
});

export const storageAssetOperations = pgTable(
  "storage_asset_operations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => storageAssets.id, { onDelete: "restrict" }),
    ownerUserId: uuid("owner_user_id").references(() => profiles.id, { onDelete: "set null" }),
    operation: text("operation", { enum: ["upload", "verify", "publish", "delete", "backup"] }).notNull(),
    state: text("state", { enum: ["pending", "running", "succeeded", "failed", "cancelled"] })
      .default("pending")
      .notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    result: jsonb("result").$type<Record<string, unknown>>(),
    errorCode: text("error_code"),
    leaseToken: uuid("lease_token"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => ({
    ownerIdempotencyUnique: uniqueIndex("storage_asset_operations_owner_idempotency_unique")
      .on(t.ownerUserId, t.idempotencyKey)
      .where(sql`${t.ownerUserId} IS NOT NULL`),
    assetStateIdx: index("storage_asset_operations_asset_state_idx").on(t.assetId, t.state),
    leaseIdx: index("storage_asset_operations_lease_idx")
      .on(t.state, t.leaseExpiresAt, t.id)
      .where(sql`${t.state} IN ('pending', 'running')`),
  }),
);

// Serialized quota rows keep upload admission O(1) for large tenants. Every
// writer locks the user row before an optional project row.
export const storageQuotaScopes = pgTable(
  "storage_quota_scopes",
  {
    scopeType: text("scope_type", { enum: ["user", "project"] }).notNull(),
    scopeId: uuid("scope_id").notNull(),
    limitBytes: bigint("limit_bytes", { mode: "number" }).notNull(),
    reservedBytes: bigint("reserved_bytes", { mode: "number" }).default(0).notNull(),
    retainedBytes: bigint("retained_bytes", { mode: "number" }).default(0).notNull(),
    outstandingUploads: integer("outstanding_uploads").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.scopeType, t.scopeId] }),
    dueIdx: index("storage_quota_scopes_outstanding_idx").on(t.outstandingUploads, t.updatedAt),
    limitCheck: check("storage_quota_scopes_limit_check", sql`${t.limitBytes} > 0`),
    reservedCheck: check("storage_quota_scopes_reserved_check", sql`${t.reservedBytes} >= 0`),
    retainedCheck: check("storage_quota_scopes_retained_check", sql`${t.retainedBytes} >= 0`),
    outstandingCheck: check("storage_quota_scopes_outstanding_check", sql`${t.outstandingUploads} >= 0`),
  }),
);

// Short-lived references held while a response or background operation reads
// immutable bytes. Physical deletion must ignore expired pins and reject any
// asset with an active pin.
export const storageAssetPins = pgTable(
  "storage_asset_pins",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => storageAssets.id, { onDelete: "cascade" }),
    operationId: uuid("operation_id").notNull(),
    kind: text("kind", { enum: ["export"] }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    operationAssetUnique: uniqueIndex("storage_asset_pins_operation_asset_unique").on(
      t.operationId,
      t.assetId,
    ),
    activeAssetIdx: index("storage_asset_pins_asset_expiry_idx").on(t.assetId, t.expiresAt),
    expiryIdx: index("storage_asset_pins_expiry_idx").on(t.expiresAt, t.id),
  }),
);

// Durable cleanup evidence for pre-lifecycle objects. These rows deliberately
// have no domain foreign keys so account/project cascades cannot erase the
// last record needed to remove legacy bytes.
export const storageLegacyCleanupTargets = pgTable(
  "storage_legacy_cleanup_targets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceType: text("source_type", {
      enum: ["project_update_media", "project_update_draft_media"],
    }).notNull(),
    sourceId: uuid("source_id").notNull(),
    sourceProjectId: uuid("source_project_id"),
    bucket: text("bucket").notNull(),
    storageKey: text("storage_key").notNull(),
    state: text("state", { enum: ["pending", "deleting", "retry", "deleted"] })
      .default("pending")
      .notNull(),
    attempts: integer("attempts").default(0).notNull(),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).defaultNow().notNull(),
    leaseToken: uuid("lease_token"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    fence: bigint("fence", { mode: "number" }).default(0).notNull(),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    sourceObjectUnique: uniqueIndex("storage_legacy_cleanup_source_object_unique").on(
      t.sourceType,
      t.sourceId,
      t.sourceProjectId,
      t.bucket,
      t.storageKey,
    ),
    dueIdx: index("storage_legacy_cleanup_due_idx").on(t.state, t.nextAttemptAt, t.id),
    leaseIdx: index("storage_legacy_cleanup_lease_idx").on(t.state, t.leaseExpiresAt, t.id),
    fenceCheck: check("storage_legacy_cleanup_fence_check", sql`${t.fence} >= 0`),
    attemptsCheck: check("storage_legacy_cleanup_attempts_check", sql`${t.attempts} >= 0`),
  }),
);

export const storageRepairFailures = pgTable(
  "storage_repair_failures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    repairKind: text("repair_kind").notNull(),
    subjectId: text("subject_id").notNull(),
    errorCode: text("error_code").notNull(),
    detail: text("detail"),
    attempts: integer("attempts").default(1).notNull(),
    nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    subjectUnique: uniqueIndex("storage_repair_failures_subject_unique").on(
      t.repairKind,
      t.subjectId,
    ),
    dueIdx: index("storage_repair_failures_due_idx").on(
      t.repairKind,
      t.resolvedAt,
      t.nextRetryAt,
      t.id,
    ),
    unresolvedDueIdx: index("storage_repair_failures_unresolved_due_idx")
      .on(t.nextRetryAt, t.createdAt, t.id)
      .where(sql`${t.resolvedAt} IS NULL`),
  }),
);

export const uploadIntents = pgTable(
  "upload_intents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    assetId: uuid("asset_id")
      .references(() => storageAssets.id, { onDelete: "set null" }),
    bucket: text("bucket").notNull(),
    storageKey: text("storage_key").notNull(),
    scope: text("scope", {
      enum: ["project_file", "project_update_media", "profile_image", "project_cover", "chat_attachment", "recovery_draft", "import_manifest", "sync_snapshot", "contribution_image"],
    }).notNull(),
    kind: text("kind", { enum: ["file", "avatar", "banner", "cover", "draft", "manifest", "snapshot"] }).notNull(),
    expectedMimeType: text("expected_mime_type").notNull(),
    expectedSize: bigint("expected_size", { mode: "number" }).notNull(),
    finalizedMimeType: text("finalized_mime_type"),
    finalizedSize: bigint("finalized_size", { mode: "number" }),
    status: statusFileEnum("status").default("pending").notNull(),
    failureReason: text("failure_reason"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    userIdx: index("upload_intents_user_idx").on(t.userId, t.createdAt),
    projectIdx: index("upload_intents_project_idx").on(
      t.projectId,
      t.createdAt,
    ),
    storageIdx: uniqueIndex("upload_intents_bucket_key_unique").on(
      t.bucket,
      t.storageKey,
    ),
    statusExpiresIdx: index("upload_intents_status_expires_idx").on(
      t.status,
      t.expiresAt,
    ),
    projectStatusIdx: index("upload_intents_project_status_idx").on(
      t.projectId,
      t.status,
    ),
    assetIdx: uniqueIndex("upload_intents_asset_unique")
      .on(t.assetId)
      .where(sql`${t.assetId} IS NOT NULL`),
  }),
);

export const recoveryCodeRedemptions = pgTable(
  "recovery_code_redemptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    codeId: text("code_id").notNull(),
    redeemedAt: timestamp("redeemed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    userRedeemedIdx: index("recovery_code_redemptions_user_redeemed_idx").on(
      t.userId,
      t.redeemedAt,
    ),
    uniqueUserCodeIdx: uniqueIndex(
      "recovery_code_redemptions_user_code_unique",
    ).on(t.userId, t.codeId),
  }),
);

// ============================================================================
// TASK NODE LINKS (Many-to-Many Task <-> File/Folder)
// ============================================================================
export const taskNodeLinks = pgTable(
  "task_node_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    nodeId: uuid("node_id")
      .notNull()
      .references(() => projectNodes.id, { onDelete: "cascade" }),
    order: integer("order").default(0).notNull(),
    annotation: text("annotation"),
    tags: jsonb("tags").$type<string[]>().default([]).notNull(),
    linkedAt: timestamp("linked_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdBy: uuid("created_by").references(() => profiles.id, {
      onDelete: "set null",
    }),
  },
  (t) => ({
    taskIdx: index("task_node_links_task_id_idx").on(t.taskId),
    taskLinkedAtIdx: index("task_node_links_task_linked_at_idx").on(
      t.taskId,
      t.linkedAt.desc(),
    ),
    nodeIdx: index("task_node_links_node_id_idx").on(t.nodeId),
    uniqueLink: uniqueIndex("task_node_links_unique_idx").on(
      t.taskId,
      t.nodeId,
    ),
    createdByIdx: index("task_node_links_created_by_idx").on(t.createdBy),
  }),
);

// ============================================================================
// PROJECT FILE INDEX (Find-in-project)
// ============================================================================
export const projectFileIndex = pgTable(
  "project_file_index",
  {
    nodeId: uuid("node_id")
      .primaryKey()
      .notNull()
      .references(() => projectNodes.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    content: text("content").default("").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    projectIdx: index("project_file_index_project_id_idx").on(t.projectId),
    // Optimization: GIN Index for fast trigram search (Search Optimization)
    // Needs `CREATE EXTENSION IF NOT EXISTS pg_trgm;` in migration
    contentSearchIdx: index("project_file_index_content_search_idx").using(
      "gin",
      sql`${t.content} gin_trgm_ops`,
    ),
  }),
);

// ============================================================================
// PROJECT NODE LOCKS (Soft locks for multi-user editing)
// ============================================================================
export const projectNodeLocks = pgTable(
  "project_node_locks",
  {
    nodeId: uuid("node_id")
      .primaryKey()
      .notNull()
      .references(() => projectNodes.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    lockedBy: uuid("locked_by")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").notNull(),
    leaseId: uuid("lease_id").defaultRandom().notNull(),
    clientKind: text("client_kind", { enum: ["web", "vscode"] })
      .default("web")
      .notNull(),
    deviceSessionId: uuid("device_session_id"),
    fencingToken: bigint("fencing_token", { mode: "number" }).notNull(),
    acquiredAt: timestamp("acquired_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    renewedAt: timestamp("renewed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    projectIdx: index("project_node_locks_project_id_idx").on(t.projectId),
    expiresIdx: index("project_node_locks_expires_idx").on(t.expiresAt),
    projectExpiresIdx: index("project_node_locks_project_expires_idx").on(
      t.projectId,
      t.expiresAt,
    ),
    ownerSessionIdx: index("project_node_locks_owner_session_idx").on(
      t.lockedBy,
      t.sessionId,
    ),
    deviceSessionIdx: index("project_node_locks_device_session_idx").on(
      t.deviceSessionId,
    ),
  }),
);

// ============================================================================
// PROJECT NODE EVENTS (Audit trail)
// ============================================================================
export const projectEventCounters = pgTable("project_event_counters", {
  projectId: uuid("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  nextSequence: bigint("next_sequence", { mode: "number" }).default(0).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  nextSequenceCheck: check("project_event_counters_next_sequence_check", sql`${t.nextSequence} >= 0`),
}));

export const projectNodeEvents = pgTable(
  "project_node_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    nodeId: uuid("node_id").references(() => projectNodes.id, {
      onDelete: "set null",
    }),
    actorId: uuid("actor_id").references(() => profiles.id, {
      onDelete: "set null",
    }),
    type: text("type").notNull(),
    sequenceNumber: bigint("sequence_number", { mode: "number" })
      .default(0)
      .notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    projectIdx: index("project_node_events_project_idx").on(
      t.projectId,
      t.createdAt,
    ),
    nodeIdx: index("project_node_events_node_idx").on(t.nodeId, t.createdAt),
    operationIdx: index("project_node_events_operation_idx").on(t.projectId,t.actorId,sql`(${t.metadata}->>'operationId')`),
    actorIdx: index("project_node_events_actor_id_idx").on(t.actorId),
    seqIdx: uniqueIndex("project_node_events_seq_idx").on(
      t.projectId,
      t.sequenceNumber,
      t.createdAt,
    ),
    reconciliationKeyIdx: index("project_node_events_reconciliation_key_idx").on(
      t.projectId,
      sql`(${t.metadata}->>'reconciliationKey')`,
    ),
  }),
);

// Reviewed sync operations and per-file baselines. Credentials never leave the server.
export const githubSyncConnections = pgTable("github_sync_connections", {
  projectId: uuid("project_id").primaryKey().references(() => projects.id, { onDelete: "cascade" }),
  repository: text("repository").notNull(),
  repositoryId: bigint("repository_id", { mode: "number" }).notNull(),
  branch: text("branch").notNull(),
  version: integer("version").notNull().default(1),
  installationId: bigint("installation_id", { mode: "number" }),
  incomingSha: text("incoming_sha"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  repoBranchIdx: index("github_sync_connections_repo_branch_idx").on(
    t.repositoryId,
    t.branch,
  ),
}));
export const githubSyncRuns = pgTable("github_sync_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  actorId: uuid("actor_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  status: text("status").$type<SyncStatus>().notNull().default("review"),
  stage: text("stage").notNull().default("Ready for review"),
  manifest: jsonb("manifest").$type<SyncManifest>().notNull(),
  result: jsonb("result").$type<SyncResult>().notNull().default({}),
  credential: jsonb("credential").$type<Record<string, unknown> | null>(),
  error: text("error"),
  leaseId: uuid("lease_id"),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, t => ({ projectIdx: index("github_sync_runs_project_idx").on(t.projectId, t.createdAt.desc()), queueIdx: index("github_sync_runs_queue_idx").on(t.status, t.updatedAt), activeIdx: uniqueIndex("github_sync_runs_active_idx").on(t.projectId).where(sql`${t.status} IN ('queued', 'running')`), actorIdx: index("github_sync_runs_actor_idx").on(t.actorId) }));
export const githubSyncSnapshotAssets = pgTable("github_sync_snapshot_assets", {
  runId: uuid("run_id").notNull().references(() => githubSyncRuns.id, { onDelete: "cascade" }),
  assetId: uuid("asset_id").notNull().references(() => storageAssets.id, { onDelete: "restrict" }),
  path: text("path").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, t => ({
  pk: primaryKey({ columns: [t.runId, t.assetId] }),
  runPathUnique: uniqueIndex("github_sync_snapshot_assets_run_path_unique").on(t.runId, t.path),
  assetIdx: index("github_sync_snapshot_assets_asset_idx").on(t.assetId),
}));
export const githubSyncFiles = pgTable("github_sync_files", {
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  repositoryId: bigint("repository_id", { mode: "number" }).notNull(),
  branch: text("branch").notNull(),
  path: text("path").notNull(),
  nodeId: uuid("node_id").references(() => projectNodes.id, { onDelete: "set null" }),
  blobSha: text("blob_sha"),
  localHash: text("local_hash"),
  localBlobSha: text("local_blob_sha"),
  commitSha: text("commit_sha").notNull(),
  sequence: bigint("sequence", { mode: "number" }).notNull().default(0),
}, t => ({
  pk: primaryKey({ columns: [t.projectId, t.repositoryId, t.branch, t.path] }),
  nodeIdx: index("github_sync_files_node_idx").on(t.nodeId),
  localBlobShaIdx: index("github_sync_files_local_sha_idx").on(t.projectId, t.localBlobSha),
  blobShaIdx: index("github_sync_files_blob_sha_idx").on(t.projectId, t.blobSha),
}));
export const githubContributorIdentities = pgTable("github_contributor_identities", {
  userId: uuid("user_id").primaryKey().references(() => profiles.id, { onDelete: "cascade" }),
  githubId: bigint("github_id", { mode: "number" }).notNull(),
  login: text("login").notNull(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  avatarUrl: text("avatar_url"),
  approvedAt: timestamp("approved_at", { withTimezone: true }).defaultNow().notNull(),
}, t => ({ githubIdx: uniqueIndex("github_contributor_identity_unique").on(t.githubId) }));

// ============================================================================
// RELATIONS
// ============================================================================
export const profilesRelations = relations(profiles, ({ many, one }) => ({
  sentConnections: many(connections, { relationName: "requester" }),
  receivedConnections: many(connections, { relationName: "addressee" }),
  projects: many(projects),
  projectMemberships: many(projectMembers),
  followedProjects: many(projectFollows),
  receivedNotifications: many(userNotifications, {
    relationName: "notification_recipient",
  }),
  authoredNotifications: many(userNotifications, {
    relationName: "notification_actor",
  }),
  securityState: one(profileSecurityStates),
  collaborationSummary: one(profileCollaborationSummaries),
  projectContributions: many(profileProjectContributions, {
    relationName: "profile_project_contributor",
  }),
  projectContributionStages: many(profileProjectContributionStages, {
    relationName: "profile_project_stage_profile",
  }),
  verifiedProjectContributions: many(profileProjectContributions, {
    relationName: "profile_project_verifier",
  }),
  verifiedProjectContributionStages: many(profileProjectContributionStages, {
    relationName: "profile_project_stage_verifier",
  }),
  tasks: many(tasks, { relationName: "assignee" }),
  createdTasks: many(tasks, { relationName: "creator" }),
  roleApplications: many(roleApplications, { relationName: "applicant" }),
  createdRoleApplications: many(roleApplications, {
    relationName: "applicationCreator",
  }),
  taskComments: many(taskComments),
  projectNodes: many(projectNodes),
}));

export const profileSecurityStatesRelations = relations(
  profileSecurityStates,
  ({ one }) => ({
    profile: one(profiles, {
      fields: [profileSecurityStates.userId],
      references: [profiles.id],
    }),
  }),
);

export const connectionsRelations = relations(connections, ({ one }) => ({
  requester: one(profiles, {
    fields: [connections.requesterId],
    references: [profiles.id],
    relationName: "requester",
  }),
  addressee: one(profiles, {
    fields: [connections.addresseeId],
    references: [profiles.id],
    relationName: "addressee",
  }),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  owner: one(profiles, {
    fields: [projects.ownerId],
    references: [profiles.id],
  }),
  members: many(projectMembers),
  followers: many(projectFollows),
  updates: many(projectUpdates),

  sprints: many(projectSprints),
  tasks: many(tasks),
  openRoles: many(projectOpenRoles),
  nodes: many(projectNodes),
  applications: many(roleApplications),
  profileContributions: many(profileProjectContributions),
  profileContributionStages: many(profileProjectContributionStages),
  docs: many(projectDocs),
  docVersions: many(projectDocVersions),
}));

export const projectOpenRolesRelations = relations(
  projectOpenRoles,
  ({ one, many }) => ({
    project: one(projects, {
      fields: [projectOpenRoles.projectId],
      references: [projects.id],
    }),
    applications: many(roleApplications),
  }),
);

export const roleApplicationsRelations = relations(
  roleApplications,
  ({ one }) => ({
    project: one(projects, {
      fields: [roleApplications.projectId],
      references: [projects.id],
    }),
    role: one(projectOpenRoles, {
      fields: [roleApplications.roleId],
      references: [projectOpenRoles.id],
    }),
    applicant: one(profiles, {
      fields: [roleApplications.applicantId],
      references: [profiles.id],
      relationName: "applicant",
    }),
    creator: one(profiles, {
      fields: [roleApplications.creatorId],
      references: [profiles.id],
      relationName: "applicationCreator",
    }),
    decisionMaker: one(profiles, {
      fields: [roleApplications.decisionBy],
      references: [profiles.id],
      relationName: "applicationDecisionMaker",
    }),
  }),
);

export const projectMembersRelations = relations(projectMembers, ({ one }) => ({
  project: one(projects, {
    fields: [projectMembers.projectId],
    references: [projects.id],
  }),
  user: one(profiles, {
    fields: [projectMembers.userId],
    references: [profiles.id],
  }),
}));

export const profileProjectContributionsRelations = relations(
  profileProjectContributions,
  ({ many, one }) => ({
    profile: one(profiles, {
      fields: [profileProjectContributions.profileId],
      references: [profiles.id],
      relationName: "profile_project_contributor",
    }),
    project: one(projects, {
      fields: [profileProjectContributions.projectId],
      references: [projects.id],
    }),
    verifier: one(profiles, {
      fields: [profileProjectContributions.verifiedBy],
      references: [profiles.id],
      relationName: "profile_project_verifier",
    }),
    stages: many(profileProjectContributionStages),
  }),
);

export const profileProjectContributionStagesRelations = relations(
  profileProjectContributionStages,
  ({ one }) => ({
    contribution: one(profileProjectContributions, {
      fields: [profileProjectContributionStages.contributionId],
      references: [profileProjectContributions.id],
    }),
    profile: one(profiles, {
      fields: [profileProjectContributionStages.profileId],
      references: [profiles.id],
      relationName: "profile_project_stage_profile",
    }),
    project: one(projects, {
      fields: [profileProjectContributionStages.projectId],
      references: [projects.id],
    }),
    verifier: one(profiles, {
      fields: [profileProjectContributionStages.verifiedBy],
      references: [profiles.id],
      relationName: "profile_project_stage_verifier",
    }),
  }),
);

export const profileCollaborationSummariesRelations = relations(
  profileCollaborationSummaries,
  ({ one }) => ({
    profile: one(profiles, {
      fields: [profileCollaborationSummaries.profileId],
      references: [profiles.id],
    }),
  }),
);

export const projectDocsRelations = relations(
  projectDocs,
  ({ one, many }) => ({
    project: one(projects, {
      fields: [projectDocs.projectId],
      references: [projects.id],
    }),

    publishedVersion: one(projectDocVersions, {
      fields: [projectDocs.publishedVersionId],
      references: [projectDocVersions.id],
    }),
    linkedNode: one(projectNodes, {
      fields: [projectDocs.linkedNodeId],
      references: [projectNodes.id],
    }),
    versions: many(projectDocVersions),
  }),
);

export const projectDocVersionsRelations = relations(
  projectDocVersions,
  ({ one, many }) => ({
    project: one(projects, {
      fields: [projectDocVersions.projectId],
      references: [projects.id],
    }),
    doc: one(projectDocs, {
      fields: [projectDocVersions.docId],
      references: [projectDocs.id],
    }),
    author: one(profiles, {
      fields: [projectDocVersions.createdBy],
      references: [profiles.id],
    }),
  }),
);

export const projectFollowsRelations = relations(projectFollows, ({ one }) => ({
  project: one(projects, {
    fields: [projectFollows.projectId],
    references: [projects.id],
  }),
  user: one(profiles, {
    fields: [projectFollows.userId],
    references: [profiles.id],
  }),
}));

export const projectUpdatesRelations = relations(
  projectUpdates,
  ({ one, many }) => ({
    project: one(projects, {
      fields: [projectUpdates.projectId],
      references: [projects.id],
    }),
    author: one(profiles, {
      fields: [projectUpdates.authorId],
      references: [profiles.id],
    }),
    deletedByProfile: one(profiles, {
      fields: [projectUpdates.deletedBy],
      references: [profiles.id],
      relationName: "project_update_deleted_by",
    }),
    likes: many(projectUpdateLikes),
    comments: many(projectUpdateComments),
  }),
);

export const projectUpdateLikesRelations = relations(
  projectUpdateLikes,
  ({ one }) => ({
    update: one(projectUpdates, {
      fields: [projectUpdateLikes.updateId],
      references: [projectUpdates.id],
    }),
    user: one(profiles, {
      fields: [projectUpdateLikes.userId],
      references: [profiles.id],
    }),
  }),
);

export const projectUpdateCommentsRelations = relations(
  projectUpdateComments,
  ({ one }) => ({
    update: one(projectUpdates, {
      fields: [projectUpdateComments.updateId],
      references: [projectUpdates.id],
    }),
    project: one(projects, {
      fields: [projectUpdateComments.projectId],
      references: [projects.id],
    }),
    user: one(profiles, {
      fields: [projectUpdateComments.userId],
      references: [profiles.id],
    }),
    deletedByProfile: one(profiles, {
      fields: [projectUpdateComments.deletedBy],
      references: [profiles.id],
      relationName: "project_update_comment_deleted_by",
    }),
  }),
);

/** The people on a team copy of an assignment (0244); the copy's assignee is the team lead. Server-only. */
export const taskTeamMembers = pgTable(
  "task_team_members",
  {
    taskId: uuid("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    isLead: boolean("is_lead").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.taskId, t.userId] }),
    userIdx: index("task_team_members_user_idx").on(t.userId),
  }),
);

/** Who opened which org doc, at which re-read version, for New and Required labels (0246). Server-only. */
export const docOpens = pgTable(
  "doc_opens",
  {
    docId: uuid("doc_id").notNull().references(() => projectDocs.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    version: integer("version").default(0).notNull(),
    openedAt: timestamp("opened_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.docId, t.userId] }),
    userIdx: index("doc_opens_user_idx").on(t.userId),
  }),
);

/** Org docs and files attached to a sprint (0243). Server-only. */
export const sprintMaterials = pgTable(
  "sprint_materials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sprintId: uuid("sprint_id").notNull().references(() => projectSprints.id, { onDelete: "cascade" }),
    nodeId: uuid("node_id").references(() => projectNodes.id, { onDelete: "cascade" }),
    docId: uuid("doc_id").references(() => projectDocs.id, { onDelete: "cascade" }),
    addedBy: uuid("added_by").references(() => profiles.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    oneTarget: check("sprint_materials_one_target", sql`(${t.nodeId} IS NULL) <> (${t.docId} IS NULL)`),
    nodeUnique: uniqueIndex("sprint_materials_node_unique").on(t.sprintId, t.nodeId).where(sql`${t.nodeId} IS NOT NULL`),
    docUnique: uniqueIndex("sprint_materials_doc_unique").on(t.sprintId, t.docId).where(sql`${t.docId} IS NOT NULL`),
    nodeIdx: index("sprint_materials_node_idx").on(t.nodeId).where(sql`${t.nodeId} IS NOT NULL`),
    docIdx: index("sprint_materials_doc_idx").on(t.docId).where(sql`${t.docId} IS NOT NULL`),
    sprintIdx: index("sprint_materials_sprint_idx").on(t.sprintId),
    addedByIdx: index("sprint_materials_added_by_idx").on(t.addedBy).where(sql`${t.addedBy} IS NOT NULL`),
  }),
);

export const projectSprintsRelations = relations(
  projectSprints,
  ({ one, many }) => ({
    project: one(projects, {
      fields: [projectSprints.projectId],
      references: [projects.id],
    }),
    tasks: many(tasks),
    creator: one(profiles, {
      fields: [projectSprints.creatorId],
      references: [profiles.id],
    }),
    lifecycleEvents: many(projectSprintEvents),
    taskMemberships: many(sprintTaskMemberships),
  }),
);

export const sprintTaskMembershipsRelations = relations(
  sprintTaskMemberships,
  ({ one }) => ({
    project: one(projects, {
      fields: [sprintTaskMemberships.projectId],
      references: [projects.id],
    }),
    sprint: one(projectSprints, {
      fields: [sprintTaskMemberships.sprintId],
      references: [projectSprints.id],
    }),
    task: one(tasks, {
      fields: [sprintTaskMemberships.taskId],
      references: [tasks.id],
    }),
    addedByProfile: one(profiles, {
      fields: [sprintTaskMemberships.addedBy],
      references: [profiles.id],
      relationName: "sprint_membership_added_by",
    }),
    removedByProfile: one(profiles, {
      fields: [sprintTaskMemberships.removedBy],
      references: [profiles.id],
      relationName: "sprint_membership_removed_by",
    }),
  }),
);

export const projectSprintEventsRelations = relations(
  projectSprintEvents,
  ({ one }) => ({
    project: one(projects, {
      fields: [projectSprintEvents.projectId],
      references: [projects.id],
    }),
    sprint: one(projectSprints, {
      fields: [projectSprintEvents.sprintId],
      references: [projectSprints.id],
    }),
    actor: one(profiles, {
      fields: [projectSprintEvents.actorId],
      references: [profiles.id],
    }),
  }),
);

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  project: one(projects, {
    fields: [tasks.projectId],
    references: [projects.id],
  }),
  sprint: one(projectSprints, {
    fields: [tasks.sprintId],
    references: [projectSprints.id],
  }),
  assignee: one(profiles, {
    fields: [tasks.assigneeId],
    references: [profiles.id],
    relationName: "assignee",
  }),
  creator: one(profiles, {
    fields: [tasks.creatorId],
    references: [profiles.id],
    relationName: "creator",
  }),
  workflowColumn: one(projectWorkflowColumns, {
    fields: [tasks.workflowColumnId],
    references: [projectWorkflowColumns.id],
  }),
  attachments: many(taskNodeLinks),
  subtasks: many(taskSubtasks),
  comments: many(taskComments),
  activityEvents: many(taskActivityEvents),
  sprintMemberships: many(sprintTaskMemberships),
}));

export const projectWorkflowColumnsRelations = relations(
  projectWorkflowColumns,
  ({ one, many }) => ({
    project: one(projects, {
      fields: [projectWorkflowColumns.projectId],
      references: [projects.id],
    }),
    tasks: many(tasks),
  }),
);

export const taskActivityEventsRelations = relations(
  taskActivityEvents,
  ({ one }) => ({
    task: one(tasks, {
      fields: [taskActivityEvents.taskId],
      references: [tasks.id],
    }),
    actor: one(profiles, {
      fields: [taskActivityEvents.actorId],
      references: [profiles.id],
    }),
  }),
);

export const taskCommentsRelations = relations(
  taskComments,
  ({ one, many }) => ({
    task: one(tasks, {
      fields: [taskComments.taskId],
      references: [tasks.id],
    }),
    user: one(profiles, {
      fields: [taskComments.userId],
      references: [profiles.id],
    }),
    parentComment: one(taskComments, {
      fields: [taskComments.parentCommentId],
      references: [taskComments.id],
      relationName: "task_comment_parent",
    }),
    deletedByProfile: one(profiles, {
      fields: [taskComments.deletedBy],
      references: [profiles.id],
      relationName: "task_comment_deleted_by",
    }),
    replies: many(taskComments, {
      relationName: "task_comment_parent",
    }),
    likes: many(taskCommentLikes),
  }),
);

export const taskCommentLikesRelations = relations(
  taskCommentLikes,
  ({ one }) => ({
    comment: one(taskComments, {
      fields: [taskCommentLikes.commentId],
      references: [taskComments.id],
    }),
    user: one(profiles, {
      fields: [taskCommentLikes.userId],
      references: [profiles.id],
    }),
  }),
);

export const taskReadReceiptsRelations = relations(
  taskReadReceipts,
  ({ one }) => ({
    task: one(tasks, {
      fields: [taskReadReceipts.taskId],
      references: [tasks.id],
    }),
    user: one(profiles, {
      fields: [taskReadReceipts.userId],
      references: [profiles.id],
    }),
  }),
);

export const taskSubtasksRelations = relations(taskSubtasks, ({ one }) => ({
  task: one(tasks, {
    fields: [taskSubtasks.taskId],
    references: [tasks.id],
  }),
}));

export const projectNodesRelations = relations(
  projectNodes,
  ({ one, many }) => ({
    project: one(projects, {
      fields: [projectNodes.projectId],
      references: [projects.id],
    }),
    parent: one(projectNodes, {
      fields: [projectNodes.parentId],
      references: [projectNodes.id],
      relationName: "children",
    }),
    children: many(projectNodes, {
      relationName: "children",
    }),
    creator: one(profiles, {
      fields: [projectNodes.createdBy],
      references: [profiles.id],
    }),
    deleter: one(profiles, {
      fields: [projectNodes.deletedBy],
      references: [profiles.id],
      relationName: "deleter",
    }),
    linkedTasks: many(taskNodeLinks),
    fileIndex: one(projectFileIndex),
    lock: one(projectNodeLocks),
    events: many(projectNodeEvents),
  }),
);

export const uploadIntentsRelations = relations(uploadIntents, ({ one }) => ({
  user: one(profiles, {
    fields: [uploadIntents.userId],
    references: [profiles.id],
  }),
  project: one(projects, {
    fields: [uploadIntents.projectId],
    references: [projects.id],
  }),
  asset: one(storageAssets, {
    fields: [uploadIntents.assetId],
    references: [storageAssets.id],
  }),
}));

export const storageAssetsRelations = relations(storageAssets, ({ one, many }) => ({
  owner: one(profiles, {
    fields: [storageAssets.ownerUserId],
    references: [profiles.id],
  }),
  project: one(projects, {
    fields: [storageAssets.projectId],
    references: [projects.id],
  }),
  source: one(storageAssets, {
    fields: [storageAssets.sourceAssetId],
    references: [storageAssets.id],
    relationName: "storage_asset_derivatives",
  }),
  derivatives: many(storageAssets, {
    relationName: "storage_asset_derivatives",
  }),
  operations: many(storageAssetOperations),
}));

export const storageAssetOperationsRelations = relations(storageAssetOperations, ({ one }) => ({
  asset: one(storageAssets, {
    fields: [storageAssetOperations.assetId],
    references: [storageAssets.id],
  }),
  owner: one(profiles, {
    fields: [storageAssetOperations.ownerUserId],
    references: [profiles.id],
  }),
}));

export const recoveryCodeRedemptionsRelations = relations(
  recoveryCodeRedemptions,
  ({ one }) => ({
    user: one(profiles, {
      fields: [recoveryCodeRedemptions.userId],
      references: [profiles.id],
    }),
  }),
);

export const taskNodeLinksRelations = relations(taskNodeLinks, ({ one }) => ({
  task: one(tasks, {
    fields: [taskNodeLinks.taskId],
    references: [tasks.id],
  }),
  node: one(projectNodes, {
    fields: [taskNodeLinks.nodeId],
    references: [projectNodes.id],
  }),
  creator: one(profiles, {
    fields: [taskNodeLinks.createdBy],
    references: [profiles.id],
  }),
}));

export const projectFileIndexRelations = relations(
  projectFileIndex,
  ({ one }) => ({
    project: one(projects, {
      fields: [projectFileIndex.projectId],
      references: [projects.id],
    }),
    node: one(projectNodes, {
      fields: [projectFileIndex.nodeId],
      references: [projectNodes.id],
    }),
  }),
);

export const projectNodeLocksRelations = relations(
  projectNodeLocks,
  ({ one }) => ({
    project: one(projects, {
      fields: [projectNodeLocks.projectId],
      references: [projects.id],
    }),
    node: one(projectNodes, {
      fields: [projectNodeLocks.nodeId],
      references: [projectNodes.id],
    }),
    user: one(profiles, {
      fields: [projectNodeLocks.lockedBy],
      references: [profiles.id],
    }),
  }),
);

export const projectNodeEventsRelations = relations(
  projectNodeEvents,
  ({ one }) => ({
    project: one(projects, {
      fields: [projectNodeEvents.projectId],
      references: [projects.id],
    }),
    node: one(projectNodes, {
      fields: [projectNodeEvents.nodeId],
      references: [projectNodes.id],
    }),
    actor: one(profiles, {
      fields: [projectNodeEvents.actorId],
      references: [profiles.id],
    }),
  }),
);

// Conversations table moved to top
// ============================================================================

export const userNotificationsRelations = relations(
  userNotifications,
  ({ one }) => ({
    user: one(profiles, {
      relationName: "notification_recipient",
      fields: [userNotifications.userId],
      references: [profiles.id],
    }),
    actor: one(profiles, {
      relationName: "notification_actor",
      fields: [userNotifications.actorUserId],
      references: [profiles.id],
    }),
  }),
);

// ============================================================================
// TYPE EXPORTS
// ============================================================================
export type Profile = typeof profiles.$inferSelect;
export type NewProfile = typeof profiles.$inferInsert;
export type ProfileSecurityState = typeof profileSecurityStates.$inferSelect;
export type NewProfileSecurityState = typeof profileSecurityStates.$inferInsert;
export type ReservedUsername = typeof reservedUsernames.$inferSelect;
export type NewReservedUsername = typeof reservedUsernames.$inferInsert;
export type UsernameAlias = typeof usernameAliases.$inferSelect;
export type NewUsernameAlias = typeof usernameAliases.$inferInsert;
export type ProfileAuditEvent = typeof profileAuditEvents.$inferSelect;
export type NewProfileAuditEvent = typeof profileAuditEvents.$inferInsert;
export type OnboardingDraft = typeof onboardingDrafts.$inferSelect;
export type NewOnboardingDraft = typeof onboardingDrafts.$inferInsert;
export type OnboardingEvent = typeof onboardingEvents.$inferSelect;
export type NewOnboardingEvent = typeof onboardingEvents.$inferInsert;
export type OnboardingSubmission = typeof onboardingSubmissions.$inferSelect;
export type NewOnboardingSubmission = typeof onboardingSubmissions.$inferInsert;
export type Connection = typeof connections.$inferSelect;
export type NewConnection = typeof connections.$inferInsert;
export type ConnectionSuggestionDismissal =
  typeof connectionSuggestionDismissals.$inferSelect;
export type NewConnectionSuggestionDismissal =
  typeof connectionSuggestionDismissals.$inferInsert;
export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type ProjectMember = typeof projectMembers.$inferSelect;
export type NewProjectMember = typeof projectMembers.$inferInsert;
export type ProjectFollow = typeof projectFollows.$inferSelect;
export type NewProjectFollow = typeof projectFollows.$inferInsert;
export type ProjectUpdate = typeof projectUpdates.$inferSelect;
export type NewProjectUpdate = typeof projectUpdates.$inferInsert;
export type ProjectUpdateLike = typeof projectUpdateLikes.$inferSelect;
export type NewProjectUpdateLike = typeof projectUpdateLikes.$inferInsert;
export type ProjectUpdateComment = typeof projectUpdateComments.$inferSelect;
export type NewProjectUpdateComment = typeof projectUpdateComments.$inferInsert;
// ============================================================================
// COLLECTIONS TABLE
// ============================================================================


// ============================================================================
// ACCOUNT DELETIONS TABLE (Immutable Audit Trail)
// Persists after the profile is hard-deleted. No FK to profiles intentionally.
// ============================================================================
export const accountDeletions = pgTable(
  "account_deletions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(), // NO FK — user record will be deleted
    email: text("email").notNull(),
    username: text("username"),
    reason: text("reason"), // Optional user-provided reason
    scheduledAt: timestamp("scheduled_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    hardDeleteAt: timestamp("hard_delete_at", { withTimezone: true }).notNull(),
    legalRetentionUntil: timestamp("legal_retention_until", { withTimezone: true }).notNull(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    // pending -> storage_running -> storage_scheduled -> db_deleted -> completed;
    // failed = storage registration blocker (retried). See src/lib/account/deletion.ts.
    cleanupStatus: text("cleanup_status", {
      enum: ["pending", "storage_running", "storage_scheduled", "db_deleted", "completed", "failed"],
    })
      .default("pending")
      .notNull(),
    cleanupDetails: jsonb("cleanup_details")
      .$type<Record<string, unknown>>()
      .default({}),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    userIdx: index("account_deletions_user_idx").on(t.userId),
    hardDeleteIdx: index("account_deletions_hard_delete_idx").on(
      t.hardDeleteAt,
      t.completedAt,
    ),
    legalRetentionIdx: index("account_deletions_legal_retention_idx").on(
      t.legalRetentionUntil,
      t.completedAt,
    ),
  }),
);

export type AccountDeletion = typeof accountDeletions.$inferSelect;
export type NewAccountDeletion = typeof accountDeletions.$inferInsert;

// ============================================================================
// LEGAL ACCEPTANCES
// Kept independently from profiles so contractual evidence can survive an
// account deletion for the limited legal retention period.
// ============================================================================
export const legalAcceptances = pgTable(
  "legal_acceptances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    termsVersion: text("terms_version").notNull(),
    eulaVersion: text("eula_version").notNull(),
    privacyNoticeVersion: text("privacy_notice_version").notNull(),
    context: text("context").notNull(),
    evidence: jsonb("evidence").$type<Record<string, unknown>>().default({}).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).defaultNow().notNull(),
    retentionExpiresAt: timestamp("retention_expires_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    versionAcceptanceUnique: unique("legal_acceptances_user_versions_unique").on(
      t.userId,
      t.termsVersion,
      t.eulaVersion,
      t.privacyNoticeVersion,
    ),
    userAcceptedIdx: index("legal_acceptances_user_accepted_idx").on(t.userId, t.acceptedAt),
    expiryIdx: index("legal_acceptances_expiry_idx").on(t.retentionExpiresAt),
  }),
);

export type LegalAcceptance = typeof legalAcceptances.$inferSelect;
export type NewLegalAcceptance = typeof legalAcceptances.$inferInsert;



export type TaskSubtask = typeof taskSubtasks.$inferSelect;
export type NewTaskSubtask = typeof taskSubtasks.$inferInsert;

export type ProjectNode = typeof projectNodes.$inferSelect;
export type NewProjectNode = typeof projectNodes.$inferInsert;
export type TaskNodeLink = typeof taskNodeLinks.$inferSelect;
export type NewTaskNodeLink = typeof taskNodeLinks.$inferInsert;
export type TaskComment = typeof taskComments.$inferSelect;
export type NewTaskComment = typeof taskComments.$inferInsert;
export type TaskCommentLike = typeof taskCommentLikes.$inferSelect;
export type NewTaskCommentLike = typeof taskCommentLikes.$inferInsert;
export type CommentMention = typeof commentMentions.$inferSelect;
export type NewCommentMention = typeof commentMentions.$inferInsert;
export type UserNotification = typeof userNotifications.$inferSelect;
export type NewUserNotification = typeof userNotifications.$inferInsert;
export type FileVersion = typeof fileVersions.$inferSelect;
export type NewFileVersion = typeof fileVersions.$inferInsert;

// ============================================================================
// NORMALIZATION: SKILLS, INTERESTS, TAGS
// ============================================================================

export const skillCategories = pgTable(
  "skill_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull().unique(),
    name: text("name").notNull(),
    description: text("description"),
    iconKey: text("icon_key").default("badge").notNull(),
    displayOrder: integer("display_order").default(0).notNull(),
    status: text("status", { enum: ["active", "hidden"] })
      .default("active")
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    orderIdx: index("skill_categories_order_idx").on(t.status, t.displayOrder),
  }),
);

export const skills = pgTable(
  "skills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull().unique(),
    slug: text("slug").notNull().unique(),
    canonicalKey: text("canonical_key").notNull().unique(),
    categoryId: uuid("category_id").references(() => skillCategories.id, {
      onDelete: "set null",
    }),
    kind: text("kind", {
      enum: [
        "language",
        "framework",
        "library",
        "database",
        "platform",
        "tool",
        "protocol",
        "methodology",
        "competency",
        "domain",
      ],
    })
      .default("competency")
      .notNull(),
    description: text("description"),
    iconSource: text("icon_source", {
      enum: [
        "simple-icons",
        "devicon",
        "skill-icons",
        "logos",
        "developer-icons",
        "lucide",
        "custom",
        "monogram",
      ],
    })
      .default("monogram")
      .notNull(),
    iconKey: text("icon_key").default("badge").notNull(),
    brandColor: text("brand_color"),
    marketTier: text("market_tier", { enum: ["core", "extended", "reference"] })
      .default("extended")
      .notNull(),
    status: text("status", {
      enum: ["active", "deprecated", "merged", "hidden", "pending"],
    })
      .default("active")
      .notNull(),
    selectable: boolean("selectable").default(true).notNull(),
    replacementSkillId: uuid("replacement_skill_id").references(
      (): AnyPgColumn => skills.id,
      { onDelete: "set null" },
    ),
    sourceMetadata: jsonb("source_metadata")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    catalogVersion: text("catalog_version").default("legacy").notNull(),
    lastReviewedAt: timestamp("last_reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    nameSearchIdx: index("skills_name_search_idx").using(
      "gin",
      sql`${t.name} gin_trgm_ops`,
    ),
    categoryKindStatusIdx: index("skills_category_kind_status_idx").on(
      t.categoryId,
      t.kind,
      t.status,
    ),
    tierStatusNameIdx: index("skills_tier_status_name_idx").on(
      t.marketTier,
      t.status,
      t.name,
    ),
    replacementSkillIdx: index("skills_replacement_skill_id_idx").on(
      t.replacementSkillId,
    ),
  }),
);

export const skillAliases = pgTable(
  "skill_aliases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    alias: text("alias").notNull(),
    normalizedAlias: text("normalized_alias").notNull(),
    locale: text("locale").default("en").notNull(),
    source: text("source").default("catalog").notNull(),
    isPreferred: boolean("is_preferred").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    normalizedLocaleUnique: uniqueIndex(
      "skill_aliases_normalized_locale_unique",
    ).on(t.normalizedAlias, t.locale),
    skillIdx: index("skill_aliases_skill_idx").on(t.skillId),
    searchIdx: index("skill_aliases_search_idx").using(
      "gin",
      sql`${t.normalizedAlias} gin_trgm_ops`,
    ),
  }),
);

export const skillIconAssets = pgTable("skill_icon_assets", {
  iconKey: text("icon_key").primaryKey(),
  source: text("source", {
    enum: [
      "simple-icons",
      "devicon",
      "skill-icons",
      "logos",
      "developer-icons",
      "lucide",
      "custom",
    ],
  }).notNull(),
  sourceSlug: text("source_slug"),
  sourceVersion: text("source_version").notNull(),
  assetPath: text("asset_path").notNull(),
  checksum: text("checksum").notNull(),
  brandColor: text("brand_color"),
  licenseType: text("license_type"),
  licenseUrl: text("license_url"),
  sourceUrl: text("source_url"),
  guidelinesUrl: text("guidelines_url"),
  approvalStatus: text("approval_status", {
    enum: ["catalog_approved", "blocked", "needs_review"],
  })
    .default("catalog_approved")
    .notNull(),
  lastReviewedAt: timestamp("last_reviewed_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const skillProposals = pgTable(
  "skill_proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    submittedBy: uuid("submitted_by")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    normalizedLabel: text("normalized_label").notNull(),
    context: text("context"),
    status: text("status", {
      enum: ["pending", "accepted", "merged", "rejected"],
    })
      .default("pending")
      .notNull(),
    resolvedSkillId: uuid("resolved_skill_id").references(() => skills.id, {
      onDelete: "set null",
    }),
    reviewedBy: uuid("reviewed_by").references(() => profiles.id, {
      onDelete: "set null",
    }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    userLabelUnique: uniqueIndex("skill_proposals_user_label_unique").on(
      t.submittedBy,
      t.normalizedLabel,
    ),
    statusCreatedIdx: index("skill_proposals_status_created_idx").on(
      t.status,
      t.createdAt,
    ),
    resolvedSkillIdx: index("skill_proposals_resolved_skill_id_idx").on(
      t.resolvedSkillId,
    ),
    reviewedByIdx: index("skill_proposals_reviewed_by_idx").on(t.reviewedBy),
  }),
);

export const profileSkills = pgTable(
  "profile_skills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    proficiency: text("proficiency", {
      enum: ["learning", "beginner", "intermediate", "advanced", "expert"],
    }),
    yearsExperience: integer("years_experience"),
    isPrimary: boolean("is_primary").default(false).notNull(),
    displayOrder: integer("display_order").default(0).notNull(),
    visibility: text("visibility", {
      enum: ["public", "connections", "private"],
    })
      .default("public")
      .notNull(),
    evidence: jsonb("evidence")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    uniqueProfileSkill: uniqueIndex("profile_skills_unique_idx").on(
      t.profileId,
      t.skillId,
    ),
    skillIdx: index("profile_skills_skill_idx").on(t.skillId),
    profileOrderIdx: index("profile_skills_profile_order_idx").on(
      t.profileId,
      t.displayOrder,
    ),
  }),
);

export const projectSkills = pgTable(
  "project_skills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    usageKind: text("usage_kind", { enum: ["used", "primary", "planned"] })
      .default("used")
      .notNull(),
    displayOrder: integer("display_order").default(0).notNull(),
    evidence: jsonb("evidence")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    uniqueProjectSkill: uniqueIndex("project_skills_unique_idx").on(
      t.projectId,
      t.skillId,
    ),
    skillIdx: index("project_skills_skill_idx").on(t.skillId),
    projectOrderIdx: index("project_skills_project_order_idx").on(
      t.projectId,
      t.displayOrder,
    ),
  }),
);

export const roleSkills = pgTable(
  "role_skills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roleId: uuid("role_id")
      .notNull()
      .references(() => projectOpenRoles.id, { onDelete: "cascade" }),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    requirement: text("requirement", { enum: ["required", "preferred"] })
      .default("required")
      .notNull(),
    minimumProficiency: text("minimum_proficiency", {
      enum: ["learning", "beginner", "intermediate", "advanced", "expert"],
    }),
    displayOrder: integer("display_order").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    uniqueRoleSkill: uniqueIndex("role_skills_unique").on(t.roleId, t.skillId),
    roleOrderIdx: index("role_skills_role_order_idx").on(
      t.roleId,
      t.displayOrder,
    ),
    skillIdx: index("role_skills_skill_idx").on(t.skillId),
  }),
);

export const profileContributionSkills = pgTable(
  "profile_contribution_skills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contributionId: uuid("contribution_id")
      .notNull()
      .references(() => profileProjectContributions.id, {
        onDelete: "cascade",
      }),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    evidence: jsonb("evidence")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    verifiedBy: uuid("verified_by").references(() => profiles.id, {
      onDelete: "set null",
    }),
    displayOrder: integer("display_order").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    uniqueContributionSkill: uniqueIndex(
      "profile_contribution_skills_unique",
    ).on(t.contributionId, t.skillId),
    contributionOrderIdx: index(
      "profile_contribution_skills_contribution_order_idx",
    ).on(t.contributionId, t.displayOrder),
    skillIdx: index("profile_contribution_skills_skill_idx").on(t.skillId),
    verifiedByIdx: index("profile_contribution_skills_verified_by_idx").on(
      t.verifiedBy,
    ),
  }),
);


export const tags = pgTable(
  "tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull().unique(),
    slug: text("slug").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    nameSearchIdx: index("tags_name_search_idx").using(
      "gin",
      sql`${t.name} gin_trgm_ops`,
    ),
  }),
);

export const projectTags = pgTable(
  "project_tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    uniqueProjectTag: uniqueIndex("project_tags_unique_idx").on(
      t.projectId,
      t.tagId,
    ),
    tagIdx: index("project_tags_tag_idx").on(t.tagId),
  }),
);

// Type Exports for new tables
export type UploadIntent = typeof uploadIntents.$inferSelect;
export type NewUploadIntent = typeof uploadIntents.$inferInsert;
export type RecoveryCodeRedemption =
  typeof recoveryCodeRedemptions.$inferSelect;
export type NewRecoveryCodeRedemption =
  typeof recoveryCodeRedemptions.$inferInsert;
export type PushSubscription = typeof pushSubscriptions.$inferSelect;
export type NewPushSubscription = typeof pushSubscriptions.$inferInsert;
export type ProfileProjectContribution =
  typeof profileProjectContributions.$inferSelect;
export type NewProfileProjectContribution =
  typeof profileProjectContributions.$inferInsert;
export type ProfileProjectContributionStage =
  typeof profileProjectContributionStages.$inferSelect;
export type NewProfileProjectContributionStage =
  typeof profileProjectContributionStages.$inferInsert;
export type ProfileCollaborationSummary =
  typeof profileCollaborationSummaries.$inferSelect;
export type NewProfileCollaborationSummary =
  typeof profileCollaborationSummaries.$inferInsert;

// ============================================================================
// EXTENSION DEVICE SESSIONS
// ============================================================================
export const extensionDeviceSessions = pgTable("extension_device_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").unique().notNull(),
  tokenPrefix: text("token_prefix").notNull(),
  deviceName: text("device_name").notNull(),
  clientVersion: text("client_version").notNull(),
  scopes: jsonb("scopes").default([]),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  editorHost: text("editor_host"),
  editorName: text("editor_name"),
  editorPlatform: text("editor_platform"),
  editorVersion: text("editor_version"),
  callbackUri: text("callback_uri"),
  revocationReason: text("revocation_reason"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
}, (t) => ({
  userLastSeenIdx: index("extension_device_sessions_user_last_seen_idx")
    .on(t.userId, t.lastSeenAt.desc(), t.id.desc())
    .where(sql`${t.revokedAt} IS NULL`),
}));

// ============================================================================
// EXTENSION DEVICE SESSION EVENTS
// ============================================================================
export const extensionDeviceSessionEvents = pgTable(
  "extension_device_session_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => extensionDeviceSessions.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    metadata: jsonb("metadata").default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    sessionIdx: index("extension_device_session_events_session_idx").on(
      t.sessionId,
    ),
    retentionIdx: index("extension_device_session_events_retention_idx").on(
      t.createdAt,
      t.id,
    ),
  }),
);

// ============================================================================
// EXTENSION RECOVERY SESSIONS
// Separates silent background safety copies from user-visible crash incidents.
// ============================================================================
export const extensionRecoverySessions = pgTable(
  "extension_recovery_sessions",
  {
    sessionId: text("session_id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    deviceId: text("device_id").notNull(),
    status: text("status", {
      enum: ["active", "clean", "interrupted", "resolved"],
    })
      .default("active")
      .notNull(),
    extensionVersion: text("extension_version"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    lastHeartbeatAt: timestamp("last_heartbeat_at", {
      withTimezone: true,
    }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    incidentDetectedAt: timestamp("incident_detected_at", {
      withTimezone: true,
    }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    ownerStatusHeartbeatIdx: index(
      "extension_recovery_sessions_owner_status_heartbeat_idx",
    ).on(t.userId, t.status, t.lastHeartbeatAt.desc()),
    ownerDeviceIdx: index("extension_recovery_sessions_owner_device_idx").on(
      t.userId,
      t.deviceId,
      t.startedAt.desc(),
    ),
    updatedIdx: index("extension_recovery_sessions_updated_idx").on(
      t.updatedAt,
    ),
  }),
);

// ============================================================================
// EXTENSION RECOVERY DRAFTS
// Immutable cloud generations for crash recovery. These records are never
// published as file versions automatically; publishing still goes through the
// explicit extension file revision APIs with base-version/hash validation.
// ============================================================================
export const extensionRecoveryDrafts = pgTable(
  "extension_recovery_drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    nodeId: uuid("node_id").references(() => projectNodes.id, {
      onDelete: "set null",
    }),
    deviceId: text("device_id").notNull(),
    sessionId: text("session_id").notNull(),
    filePath: text("file_path").notNull(),
    storageKey: text("storage_key").notNull().unique(),
    assetId: uuid("asset_id").references(() => storageAssets.id, {
      onDelete: "restrict",
    }),
    size: bigint("size", { mode: "number" }).notNull(),
    mimeType: text("mime_type").default("text/plain").notNull(),
    contentHash: text("content_hash").notNull(),
    baseVersion: integer("base_version"),
    baseHash: text("base_hash"),
    taskContext: jsonb("task_context")
      .$type<
        Array<{
          id: string;
          title?: string;
          taskNumber?: number | null;
        }>
      >()
      .default([])
      .notNull(),
    status: text("status", {
      enum: ["pending", "finalized", "failed", "expired"],
    })
      .default("pending")
      .notNull(),
    failureReason: text("failure_reason"),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    ownerUpdatedIdx: index("extension_recovery_drafts_owner_updated_idx").on(
      t.userId,
      t.updatedAt.desc(),
    ),
    projectPathIdx: index("extension_recovery_drafts_project_path_idx").on(
      t.projectId,
      t.filePath,
      t.updatedAt.desc(),
    ),
    deviceFileIdx: index("extension_recovery_drafts_device_file_idx").on(
      t.userId,
      t.deviceId,
      t.projectId,
      t.filePath,
      t.capturedAt.desc(),
    ),
    expiryIdx: index("extension_recovery_drafts_expiry_idx").on(
      t.status,
      t.expiresAt,
    ),
    nodeIdx: index("extension_recovery_drafts_node_idx").on(t.nodeId),
    assetUnique: uniqueIndex("extension_recovery_drafts_asset_unique")
      .on(t.assetId)
      .where(sql`${t.assetId} IS NOT NULL`),
  }),
);

// ============================================================================
// PROJECT GIT DELTAS
// ============================================================================
export const projectGitDeltas = pgTable(
  "project_git_deltas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").references(() => tasks.id, {
      onDelete: "set null",
    }),
    targetBranch: text("target_branch").notNull(),
    sequenceNumber: bigint("sequence_number", { mode: "number" }).notNull(),
    deltaOrder: integer("delta_order").notNull(),
    action: text("action").notNull(),
    nodeId: uuid("node_id").references(() => projectNodes.id, {
      onDelete: "set null",
    }),
    path: text("path").notNull(),
    oldPath: text("old_path"),
    gitBlobHash: text("git_blob_hash"),
    fileVersionId: uuid("file_version_id").references(() => fileVersions.id, {
      onDelete: "set null",
    }),
    s3Key: text("s3_key"),
    status: text("status").default("pending").notNull(),
    jobId: uuid("job_id"),
    processedCommitSha: text("processed_commit_sha"),
    processingError: text("processing_error"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    uniqueSeq: unique("project_git_deltas_seq_unique").on(
      t.projectId,
      t.targetBranch,
      t.sequenceNumber,
      t.deltaOrder,
    ),
    syncIdx: index("project_git_deltas_sync_idx").on(
      t.projectId,
      t.targetBranch,
      t.status,
      t.sequenceNumber,
      t.deltaOrder,
    ),
    taskIdx: index("project_git_deltas_task_idx").on(t.taskId),
    nodeIdx: index("project_git_deltas_node_idx").on(t.nodeId),
    fileVersionIdx: index("project_git_deltas_file_version_idx").on(
      t.fileVersionId,
    ),
  }),
);

// ============================================================================
// IMPORT JOBS
// ============================================================================
export const importJobs = pgTable(
  "import_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    status: text("status").default("pending").notNull(),
    totalFiles: integer("total_files").default(0).notNull(),
    processedFiles: integer("processed_files").default(0).notNull(),
    manifestS3Key: text("manifest_s3_key"),
    manifestAssetId: uuid("manifest_asset_id").references(() => storageAssets.id, {
      onDelete: "restrict",
    }),
    manifestUploadIntentId: uuid("manifest_upload_intent_id").references(
      () => uploadIntents.id,
      { onDelete: "set null" },
    ),
    manifestHash: text("manifest_hash"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    projectIdx: index("import_jobs_project_idx").on(t.projectId),
    manifestAssetUnique: uniqueIndex("import_jobs_manifest_asset_unique")
      .on(t.manifestAssetId)
      .where(sql`${t.manifestAssetId} IS NOT NULL`),
    manifestIntentIdx: index("import_jobs_manifest_intent_idx").on(
      t.manifestUploadIntentId,
    ),
  }),
);

// ============================================================================
// IMPORT JOB FILES
// ============================================================================
export const importJobFiles = pgTable(
  "import_job_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => importJobs.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    size: bigint("size", { mode: "number" }).notNull(),
    checksum: text("checksum").notNull(),
    status: text("status").default("pending").notNull(),
    uploadIntentId: uuid("upload_intent_id").references(
      () => uploadIntents.id,
      { onDelete: "set null" },
    ),
    s3Key: text("s3_key"),
    errorMessage: text("error_message"),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    statusIdx: index("import_job_files_status_idx").on(t.jobId, t.status),
    uploadIntentIdx: index("import_job_files_upload_intent_idx").on(
      t.uploadIntentId,
    ),
  }),
);

// ============================================================================
// PROJECT NODE CONFLICTS
// ============================================================================
export const projectNodeConflicts = pgTable(
  "project_node_conflicts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    nodeId: uuid("node_id")
      .notNull()
      .references(() => projectNodes.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "cascade" }),
    gitBranch: text("git_branch").notNull(),
    canonicalContent: text("canonical_content"),
    incomingContent: text("incoming_content"),
    mergedContent: text("merged_content"),
    conflictStatus: text("conflict_status").default("unresolved").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    nodeIdx: index("project_node_conflicts_node_idx").on(t.nodeId),
    projectIdx: index("project_node_conflicts_project_idx").on(t.projectId),
    taskIdx: index("project_node_conflicts_task_idx").on(t.taskId),
  }),
);

export type ExtensionDeviceSession =
  typeof extensionDeviceSessions.$inferSelect;
export type NewExtensionDeviceSession =
  typeof extensionDeviceSessions.$inferInsert;
export type ExtensionDeviceSessionEvent =
  typeof extensionDeviceSessionEvents.$inferSelect;
export type NewExtensionDeviceSessionEvent =
  typeof extensionDeviceSessionEvents.$inferInsert;
export type ExtensionRecoveryDraft =
  typeof extensionRecoveryDrafts.$inferSelect;
export type NewExtensionRecoveryDraft =
  typeof extensionRecoveryDrafts.$inferInsert;
export type ExtensionRecoverySession =
  typeof extensionRecoverySessions.$inferSelect;
export type NewExtensionRecoverySession =
  typeof extensionRecoverySessions.$inferInsert;
export type ProjectGitDelta = typeof projectGitDeltas.$inferSelect;
export type NewProjectGitDelta = typeof projectGitDeltas.$inferInsert;
export type ImportJob = typeof importJobs.$inferSelect;
export type NewImportJob = typeof importJobs.$inferInsert;
export type ImportJobFile = typeof importJobFiles.$inferSelect;
export type NewImportJobFile = typeof importJobFiles.$inferInsert;
export type ProjectNodeConflict = typeof projectNodeConflicts.$inferSelect;
export type NewProjectNodeConflict = typeof projectNodeConflicts.$inferInsert;

// ============================================================================
// TASK PUSHES
// ============================================================================
export const taskPushes = pgTable(
  "task_pushes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    message: text("message"),
    filesCount: integer("files_count").default(0).notNull(),
    pushedBy: uuid("pushed_by").references(() => profiles.id, {
      onDelete: "set null",
    }),
    pushedAt: timestamp("pushed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    filesJson: jsonb("files_json").default("[]").notNull(),
  },
  (t) => ({
    taskIdx: index("task_pushes_task_idx").on(t.taskId),
    taskPushedAtIdx: index("task_pushes_task_pushed_at_idx").on(
      t.taskId,
      t.pushedAt.desc(),
    ),
    projectIdx: index("task_pushes_project_idx").on(t.projectId),
    pushedByIdx: index("task_pushes_pushed_by_idx").on(t.pushedBy),
  }),
);

export type TaskPush = typeof taskPushes.$inferSelect;
export type NewTaskPush = typeof taskPushes.$inferInsert;
export type ProjectWorkflowColumn = typeof projectWorkflowColumns.$inferSelect;
export type NewProjectWorkflowColumn =
  typeof projectWorkflowColumns.$inferInsert;

// ============================================================================
// CHAT (Slack-style rebuild). Tables, partitions, constraints, indexes, RLS and
// functions are owned by drizzle/0180_chat_rebuild_additive.sql.
// ponytail: plain pgTable typings for queries only (L-20). ceiling:
// drizzle-kit cannot express PARTITION BY HASH, so never generate migrations
// from these definitions. upgrade: drop this note when drizzle supports
// partitioned tables.
// ============================================================================
export const chatChannels = pgTable("chat_channels", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind", { enum: ["public", "private", "dm"] }).notNull(),
  name: text("name"),
  topic: text("topic"),
  description: text("description"),
  projectId: uuid("project_id"),
  applicationId: uuid("application_id"),
  isDefault: boolean("is_default").default(false).notNull(),
  dmKey: text("dm_key"),
  createdBy: uuid("created_by"),
  lastSeq: bigint("last_seq", { mode: "number" }).default(0).notNull(),
  lastTopSeq: bigint("last_top_seq", { mode: "number" }).default(0).notNull(),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
  lastPreview: text("last_preview"),
  lastAuthorId: uuid("last_author_id"),
  memberCount: integer("member_count").default(0).notNull(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const chatChannelMembers = pgTable(
  "chat_channel_members",
  {
    channelId: uuid("channel_id").notNull(),
    userId: uuid("user_id").notNull(),
    role: text("role", { enum: ["owner", "admin", "member"] }).default("member").notNull(),
    lastReadSeq: bigint("last_read_seq", { mode: "number" }).default(0).notNull(),
    mentionCount: integer("mention_count").default(0).notNull(),
    notify: text("notify", { enum: ["all", "mentions", "mute"] }).default("all").notNull(),
    starred: boolean("starred").default(false).notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.channelId, t.userId] }) }),
);

export const chatMessages = pgTable(
  "chat_messages",
  {
    channelId: uuid("channel_id").notNull(),
    channelSeq: bigint("channel_seq", { mode: "number" }).notNull(),
    authorId: uuid("author_id"),
    kind: text("kind", { enum: ["user", "system"] }).default("user").notNull(),
    body: text("body").default("").notNull(),
    threadRootSeq: bigint("thread_root_seq", { mode: "number" }),
    replyCount: integer("reply_count").default(0).notNull(),
    lastReplySeq: bigint("last_reply_seq", { mode: "number" }),
    lastReplyAt: timestamp("last_reply_at", { withTimezone: true }),
    clientMessageId: text("client_message_id"),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.channelId, t.channelSeq] }) }),
);

export const chatMessageCards = pgTable(
  "chat_message_cards",
  {
    channelId: uuid("channel_id").notNull(),
    messageSeq: bigint("message_seq", { mode: "number" }).notNull(),
    kind: text("kind", { enum: ["application", "task", "invite"] }).notNull(),
    refId: uuid("ref_id").notNull(),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().default({}).notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.channelId, t.messageSeq] }) }),
);

export const chatAttachments = pgTable(
  "chat_attachments",
  {
    channelId: uuid("channel_id").notNull(),
    messageSeq: bigint("message_seq", { mode: "number" }).notNull(),
    idx: smallint("idx").notNull(),
    assetId: uuid("asset_id").notNull(),
    name: text("name").default("").notNull(),
    mime: text("mime").notNull(),
    size: bigint("size", { mode: "number" }).notNull(),
    width: integer("width"),
    height: integer("height"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.channelId, t.messageSeq, t.idx] }) }),
);

export const chatReactions = pgTable(
  "chat_reactions",
  {
    channelId: uuid("channel_id").notNull(),
    messageSeq: bigint("message_seq", { mode: "number" }).notNull(),
    userId: uuid("user_id").notNull(),
    emoji: text("emoji").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.channelId, t.messageSeq, t.userId, t.emoji] }) }),
);

export const chatMentions = pgTable(
  "chat_mentions",
  {
    userId: uuid("user_id").notNull(),
    channelId: uuid("channel_id").notNull(),
    messageSeq: bigint("message_seq", { mode: "number" }).notNull(),
    kind: text("kind", { enum: ["user", "channel", "here", "thread_reply"] }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.userId, t.channelId, t.messageSeq] }) }),
);

export const chatThreadFollows = pgTable(
  "chat_thread_follows",
  {
    userId: uuid("user_id").notNull(),
    channelId: uuid("channel_id").notNull(),
    rootSeq: bigint("root_seq", { mode: "number" }).notNull(),
    lastReadSeq: bigint("last_read_seq", { mode: "number" }).default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.userId, t.channelId, t.rootSeq] }) }),
);

export const chatPins = pgTable(
  "chat_pins",
  {
    channelId: uuid("channel_id").notNull(),
    messageSeq: bigint("message_seq", { mode: "number" }).notNull(),
    pinnedBy: uuid("pinned_by"),
    pinnedAt: timestamp("pinned_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.channelId, t.messageSeq] }) }),
);

export const chatCanvases = pgTable("chat_canvases", {
  channelId: uuid("channel_id").primaryKey(),
  title: text("title").default("").notNull(),
  body: text("body").default("").notNull(),
  assetIds: uuid("asset_ids").array().default(sql`'{}'::uuid[]`).notNull(),
  version: integer("version").default(1).notNull(),
  updatedBy: uuid("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const chatReports = pgTable("chat_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  channelId: uuid("channel_id").notNull(),
  messageSeq: bigint("message_seq", { mode: "number" }).notNull(),
  reporterId: uuid("reporter_id").notNull(),
  reason: text("reason").notNull(),
  status: text("status", { enum: ["open", "reviewed", "dismissed"] }).default("open").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type ChatChannel = typeof chatChannels.$inferSelect;
export type ChatChannelMember = typeof chatChannelMembers.$inferSelect;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type ChatMessageCard = typeof chatMessageCards.$inferSelect;
export type ChatAttachment = typeof chatAttachments.$inferSelect;

export const profileContributionDrafts = pgTable("profile_contribution_drafts", {
  contributionId: uuid("contribution_id").primaryKey().references(() => profileProjectContributions.id, {onDelete:"cascade"}),
  profileId: uuid("profile_id").notNull().references(() => profiles.id,{onDelete:"cascade"}),
  document: jsonb("document").$type<import("@/lib/profile/contribution-story").ContributionStory>().notNull(),
  updatedAt: timestamp("updated_at",{withTimezone:true}).defaultNow().notNull(),
},t=>({profileIdx:index("profile_contribution_drafts_profile_idx").on(t.profileId)}));
export const profileContributionMediaAssets = pgTable("profile_contribution_media_assets", {
  contributionId: uuid("contribution_id").notNull().references(() => profileProjectContributions.id,{onDelete:"cascade"}),
  assetId: uuid("asset_id").notNull().references(() => storageAssets.id),
},t=>({pk:primaryKey({columns:[t.contributionId,t.assetId]}),assetIdx:index("profile_contribution_media_assets_asset_idx").on(t.assetId)}));
