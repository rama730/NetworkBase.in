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
};

export type ChatProjectSummary = {
  id: string;
  title: string;
  slug: string | null;
  cover_image: string | null;
  role: string;
};

export type ChatBootstrap = {
  server_time: string;
  activity_latest_at: string | null;
  /** Unread Inbox items (mentions and thread replies), the Inbox badge. */
  inbox_unread?: number;
  /** Saved items whose reminder time has come: the Saved row's badge. */
  saved_due?: number;
  channels: ChatChannelSummary[];
  projects: ChatProjectSummary[] | null;
};

export type ChatAttachmentView = {
  idx: number;
  asset_id: string;
  name: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
};

export type ChatReactionView = { emoji: string; count: number; me: boolean };

export type ChatCardKind = "application" | "task" | "invite";
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
  applicant: ChatPerson;
  is_applicant: boolean;
  is_reviewer: boolean;
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

export type ChatCardView =
  | ApplicationCardView
  | TaskCardView
  | InviteCardView
  | { kind: ChatCardKind; id: string; restricted: true };
