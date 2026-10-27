import type { ProjectUpdateType } from "@/lib/projects/updates";
// Hub Types - Adapted to work with existing Drizzle schema
import type { SocialLinkStorage } from "@/lib/profile/normalization";

export interface User {
  id: string;
  email?: string;
  username?: string;
  fullName?: string;
  avatarUrl?: string;
  user_metadata?: Record<string, unknown>;
}

export interface OpenRole {
  id: string;
  projectId: string;
  role: string;
  title?: string | null;
  description?: string | null;
  count: number;
  filled: number;
  skills?: string[] | null;
}

export interface ProjectProfile {
  id: string;
  username: string | null;
  fullName: string | null;
  avatarUrl: string | null;
  displayName?: string;
  isMasked?: boolean;
  canOpenProfile?: boolean;
  badgeText?: string | null;
}

export interface ProjectCollaborator {
  userId: string;
  membershipRole: "owner" | "admin" | "member" | "viewer";
  user: ProjectProfile | null;
}

export interface ProjectFollower {
  userId: string;
}

export interface ProjectConnectedFriend {
  name: string;
  role: string;
}

// Main Project type - adapted to match schema + extended fields for UI
export interface Project {
  id: string;
  key?: string | null;
  title: string;
  description?: string | null;
  shortDescription?: string | null;
  slug?: string | undefined;
  status: "draft" | "active" | "completed" | "archived";
  syncStatus?: "pending" | "cloning" | "indexing" | "ready" | "failed";
  importSource?: any | null;
  githubRepoUrl?: string | null;
  githubDefaultBranch?: string | null;
  githubSyncConnection?: {
    repository: string;
    branch: string;
  } | null;
  externalLinks?: SocialLinkStorage;
  externalLinkMetadata?: Record<
    string,
    {
      health: "unknown" | "active" | "unavailable";
      checkedAt?: string;
      nameSource?: "provider" | "open_graph" | "html_title" | "url" | "manual";
      fetchedAt?: string;
      resolvedHost?: string;
      contentType?: string;
    }
  >;
  category?: string | null;
  coverImage?: string | null;
  tags?: string[];
  skills?: string[];
  visibility?: string;
  publicTabVisibility?: {
    dashboard: boolean;
    readme: boolean;
    updates: boolean;
    files: boolean;
    sprints: boolean;
    tasks: boolean;
  };
  hasPublishedReadme?: boolean;
  readmeExcerpt?: string | null;
  readmeUpdatedAt?: string | null;
  readmeVersionNumber?: number | null;
  viewCount?: number;
  followersCount?: number;
  savesCount?: number;
  rankingReasons?: string[];
  connectedFriends?: ProjectConnectedFriend[];
  additionalConnectedFriendsCount?: number;

  // Relations
  ownerId?: string;
  owner?: ProjectProfile | null;
  collaborators?: ProjectCollaborator[];
  openRoles?: OpenRole[];
  /** Open seats across the project's roles (feeds send this instead of the roles). */
  openRolesCount?: number;
  /** Team size, including members not shown to this viewer (feeds send at most a few members). */
  collaboratorsCount?: number;
  followers?: ProjectFollower[];

  // Timestamps
  createdAt?: string;
  updatedAt?: string | null;

  /** Organizations only: header, About and Settings data (null or absent for other projects). */
  organization?: import("@/lib/organizations/detail").OrgDetail | null;
  /** Child projects only: the parent org as this viewer may see it. */
  parentOrg?: import("@/lib/organizations/detail").ParentOrgLink | null;
  /** The lead's pending request to move this project into an org, and the orgs they could move it into. */
  pendingMoveIn?: { orgId: string; orgTitle: string } | null;
  moveTargets?: Array<{ id: string; title: string }>;
}

// Filter types
export interface DiscoverFilters {
  status: string;
  type: string;
  tech: string[];
  sort: string;
  search?: string;
}

/** Everything the browser gets about an author. A masked author (private, deleted) carries no identity at all. */
export interface DiscoverUpdateAuthor {
  id: string;
  fullName: string | null;
  username: string | null;
  avatarUrl: string | null;
  roleLabel: string | null;
  masked: boolean;
}

/** An attachment as the card shows it. The storage bucket, key and asset id stay on the server. */
export interface DiscoverUpdateMedia {
  type: "image" | "file" | "link";
  url: string | null;
  label: string | null;
  altText: string | null;
  mimeType: string | null;
  size: number | null;
  width: number | null;
  height: number | null;
}

/**
 * A project update as the Discover feed sends it. Deliberately smaller than the project page's view: no
 * metadata, no linked task/sprint/file ids, no constants.
 */
export interface DiscoverUpdateView {
  id: string;
  projectId: string;
  projectName: string;
  projectSlug: string | null;
  projectCoverImage: string | null;
  author: DiscoverUpdateAuthor | null;
  content: string;
  updateType: ProjectUpdateType | null;
  media: DiscoverUpdateMedia[];
  isPinned: boolean;
  likeCount: number;
  commentCount: number;
  likedByViewer: boolean;
  replyPolicy: "logged_in" | "members";
  canComment: boolean;
  canEdit: boolean;
  canDelete: boolean;
  editedAt: string | null;
  createdAt: string;
}

export interface DiscoverUpdatesPage {
  updates: DiscoverUpdateView[];
  /** Pass back to read the next page; null when there is no more. */
  nextCursor: string | null;
}

export type DiscoverFeedItem =
  | { kind: "project"; data: Project }
  | { kind: "update"; data: DiscoverUpdateView };

export type DiscoverProjectUpdate = DiscoverUpdateView;
