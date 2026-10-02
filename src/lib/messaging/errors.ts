// User-facing copy for the chat_* error codes raised by the SQL functions.
const MESSAGES: Record<string, string> = {
  chat_unauthorized: "Sign in to continue.",
  chat_invalid_input: "That didn't look right. Check it and try again.",
  chat_rate_limited: "You're going a bit fast. Try again in a moment.",
  chat_duplicate: "A channel with that name already exists.",
  chat_blocked: "You can't message this person.",
  chat_dm_not_allowed: "This person only accepts messages from their connections.",
  chat_channel_archived: "This channel is archived.",
  chat_channel_member_limit: "This channel is full (500 members).",
  chat_project_channel_limit: "This project has reached 200 channels.",
  chat_user_channel_limit: "You've reached the channel limit.",
  chat_invalid_channel_name: "Use lowercase letters, numbers and hyphens.",
  chat_not_member: "You're not a member of this conversation.",
  chat_not_project_member: "Only project members can do that.",
  chat_not_channel_admin: "Only channel admins can do that.",
  chat_channel_not_leavable: "You can't leave the project's default channel.",
  chat_channel_not_archivable: "The default channel can't be archived.",
  chat_channel_not_joinable: "This channel can't be joined.",
  chat_broadcast_mention_too_large: "@channel and @here work in channels of 100 or fewer.",
  chat_body_too_long: "Messages can be up to 4,000 characters.",
  chat_empty_message: "Write a message first.",
  chat_too_many_attachments: "Up to 10 attachments per message.",
  chat_not_editable: "This message can't be edited.",
  chat_not_deletable: "This message can't be deleted.",
  chat_not_allowed_to_pin: "Only channel admins can pin here.",
  chat_group_size: "Group chats have up to 9 people.",
};

export function chatErrorMessage(code: string | undefined) {
  return (code && MESSAGES[code]) || "Something went wrong. Try again.";
}
