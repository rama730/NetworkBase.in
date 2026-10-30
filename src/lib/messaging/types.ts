// Shapes returned by the chat server actions and carried by Realtime events.
// Field names match the SQL (snake_case) so rows pass through unchanged.

export type ChatKind = "public" | "private" | "dm";
export type ChatNotify = "all" | "mentions" | "mute";
export type ChatRole = "owner" | "admin" | "member";

export type ChatPerson = {
  id: string;
  username: string | null;
  full_name: string | null;
  avatar_url: string | null;
  role?: string;
  can_dm?: boolean;
  /** Member lists: the viewer blocked this person (shown only to the viewer). */
  blocked_by_me?: boolean;
  project_membership_role?: string | null;
  project_role_title?: string | null;
  is_project_owner?: boolean | null;
  lead_focus?: string | null;
};

export type ChatChannelSummary = {
  id: string;
  kind: ChatKind;
  name: string | null;
  /** A group chat's display name (unnamed private channels outside projects). */
  title?: string | null;
  topic: string | null;
  project_id: string | null;
  application_id: string | null;
  /** Application threads only: where the application stands, for the row and the header. */
  application?: ChatApplicationMeta | null;
  is_default: boolean;
  last_seq: number;
  last_top_seq: number;
  last_read_seq: number;
  mention_count: number;
  notify: ChatNotify;
  starred: boolean;
  archived_at: string | null;
  channel_archived_at: string | null;
  last_message_at: string | null;
  last_preview: string | null;
  last_author_id: string | null;
  member_count: number;
  role: ChatRole;
  dm_user: ChatPerson | null;
  members_preview: ChatPerson[] | null;
  /** A DM (or a group down to two) across a block in either direction: no replies (Blocking B44). Never says which way. */
  reply_closed?: boolean;
  /** The viewer's own block on the other person, which only the viewer ever sees. */
  blocked_by_me?: boolean;
};

export type ChatWorkspaceSummary = {
  id: string;
  title: string;
  slug: string | null;
  cover_image: string | null;
  role: string;
  /** Org workspaces (0249): child projects live inside their org's workspace. */
  kind?: "workspace" | "organization";
  parent_id?: string | null;
  parent_title?: string | null;
};

export type ChatBootstrap = {
  server_time: string;
  activity_latest_at: string | null;
  /** Unread Inbox items (mentions and thread replies), the Inbox badge. */
  inbox_unread?: number;
  /** Unread mentions alone (the Mentions tab). */
  inbox_mentions?: number;
  /** Followed threads with new replies (the Threads tab). */
  threads_unread?: number;
  /** Saved items whose reminder time has come: the Saved row's badge. */
  saved_due?: number;
  channels: ChatChannelSummary[];
  projects: ChatWorkspaceSummary[] | null;
  /** People the viewer blocked: their messages fold away in shared channels, search and Saved (B23, B34). */
  blocked_ids?: string[];
};

export type ChatAttachmentView = {
  idx: number;
  asset_id: string;
  name: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  /** Client only: the on-device preview while a send is in flight (or failed). */
  local_url?: string;
};

export type ChatReactionView = { emoji: string; count: number; me: boolean };

export type ChatCardKind = "application" | "task" | "invite" | "announcement" | "assignment";
export type ChatCardRef = { kind: ChatCardKind; ref_id: string };

export type ChatMessageView = {
  channel_id: string;
  seq: number;
  author_id: string | null;
  author: ChatPerson | null;
  kind: "user" | "system";
  body: string;
  thread_root_seq: number | null;
  reply_count: number;
  last_reply_seq: number | null;
  last_reply_at: string | null;
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
  client_message_id: string | null;
  attachments: ChatAttachmentView[];
  reactions: ChatReactionView[];
  card: ChatCardRef | null;
  pinned: boolean;
  /** The author removed this message's link preview. */
  link_preview_hidden?: boolean;
  /** Client only: an optimistic send the server refused; the row offers Retry and Delete. */
  failed?: boolean;
};

export type ApplicationCardView = {
  kind: "application";
  id: string;
  status: string;
  message: string | null;
  created_at: string;
  decision_at: string | null;
  project_id: string;
  project_title: string;
  project_slug: string | null;
  role_title: string | null;
  role_id: string | null;
  /** The role was deleted after the application: Accept can't work, only Decline. */
  role_removed: boolean;
  details: { portfolioUrl?: string; availability?: string };
  decision_reason_code: string | null;
  decision_reason_text: string | null;
  decided_by: ChatPerson | null;
  /** The project's #general, once you are in it (after you are accepted). */
  project_chat_id: string | null;
  applicant: ChatPerson;
  applicant_headline: string | null;
  applicant_skills: string[];
  is_applicant: boolean;
  is_reviewer: boolean;
};

/** What a conversation list or header needs to know about an application thread, without loading its card. */
export type ChatApplicationMeta = {
  status: "pending" | "accepted" | "rejected" | "withdrawn" | "proposed";
  role_title: string | null;
  role_removed: boolean;
  project_title: string;
  project_slug: string | null;
  decision_at: string | null;
  created_at: string;
  is_applicant: boolean;
  applicant: ChatPerson;
  /** The project's lead (its owner): who the applicant is talking to. */
  lead: ChatPerson;
};

export type TaskCardView = {
  kind: "task";
  id: string;
  title: string;
  status: string;
  priority: string;
  due_date: string | null;
  task_number: number | null;
  project_id: string;
  project_key: string | null;
  project_slug: string | null;
  project_title: string;
  assignee: ChatPerson | null;
  deleted: boolean;
  /** May change the status (owner, or a member who isn't a viewer). */
  can_edit?: boolean;
};

export type InviteCardView = {
  kind: "invite";
  id: string;
  status: string;
  invite_kind: string;
  role_title: string | null;
  guidance_label: string | null;
  project_title: string;
  project_id: string;
  project_slug: string | null;
  note: string | null;
  expires_at: string;
  inviter: ChatPerson;
  is_candidate: boolean;
  can_cancel: boolean;
};

/** An org announcement shared in #general (report §25.5). */
export type AnnouncementCardView = {
  kind: "announcement";
  id: string;
  content: string;
  project_id: string;
  project_slug: string | null;
  project_title: string;
  created_at: string;
  deleted: boolean;
};

/** An assignment shared in #general: each viewer sees their own status; admins see counts (report §25.5). */
export type AssignmentCardView = {
  kind: "assignment";
  id: string;
  title: string;
  due_date: string | null;
  project_id: string;
  project_slug: string | null;
  project_title: string;
  deleted: boolean;
  own: { copy_id: string; state: string; late: boolean } | null;
  counts: { done: number; submitted: number; total: number } | null;
};

export type ChatCardView =
  | ApplicationCardView
  | TaskCardView
  | InviteCardView
  | AnnouncementCardView
  | AssignmentCardView
  | { kind: ChatCardKind; id: string; restricted: true };
