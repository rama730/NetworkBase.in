import type { FeedbackType } from './store';

/** Reviewed copy contracts. Runtime object names, counts, dates and limits stay at their call sites. */
export const FEEDBACK_COPY: Record<string, { title: string; description?: string; type?: FeedbackType }> = {
  "Couldn’t copy the hex dump": { "title": "Couldn’t copy the hex dump" },
  "Couldn’t copy the cell": { "title": "Couldn’t copy the cell" },
  "Couldn’t copy the table": { "title": "Couldn’t copy the table" },
  "Couldn’t copy the image": { "title": "Couldn’t copy the image" },
  "Couldn’t copy the SVG code": { "title": "Couldn’t copy the SVG code" },
  "Couldn’t update activity visibility": { "title": "Couldn’t update activity visibility", "description": "Try again." },
  "Couldn’t upload the photo": { "title": "Couldn’t upload the photo", "description": "Try again." },
  "Couldn’t save the file": { "title": "Couldn’t save the file", "description": "Your changes are kept. Try again." },
  "Couldn’t open that channel": { "title": "Couldn’t open that channel", "description": "Try again." },
  "Invalid move destination": { "title": "Invalid move destination", "description": "Choose a folder outside this item.", "type": "warning" },
  "Deletion wasn’t confirmed": {
    "title": "Deletion wasn’t confirmed"
  },
  "Changes saved": {
    "title": "Changes saved"
  },
  "Link copied": {
    "title": "Link copied",
    "description": "Access is still required."
  },
  "Couldn’t copy the link": {
    "title": "Couldn’t copy the link",
    "description": "Clipboard is blocked."
  },
  "Changes weren’t saved": {
    "title": "Changes not saved"
  },
  "You’re already up to date": {
    "title": "Already up to date"
  },
  "Nothing changed": {
    "title": "Nothing changed"
  },
  "Saving changes…": {
    "title": "Saving changes…"
  },
  "Some changes need attention": {
    "title": "Some changes need attention",
    "description": "Other changes saved.",
    "type": "warning"
  },
  "Uploading 8 files": {
    "title": "Uploading 8 files"
  },
  "8 files uploaded": {
    "title": "8 files uploaded"
  },
  "6 uploaded · 2 need attention": {
    "title": "6 uploaded · 2 failed",
    "description": "Uploads safe.",
    "type": "warning"
  },
  "Upload interrupted": {
    "title": "Upload interrupted",
    "description": "Completed files safe."
  },
  "This file is too large": {
    "title": "File too large",
    "type": "warning"
  },
  "Upload cancelled": {
    "title": "Upload cancelled",
    "description": "Completed files kept."
  },
  "No new files to upload": {
    "title": "No new files to upload",
    "description": "All files already exist."
  },
  "Folder created": {
    "title": "Folder created"
  },
  "File renamed": {
    "title": "File renamed"
  },
  "3 files moved": {
    "title": "3 files moved"
  },
  "3 files moved to Trash": {
    "title": "3 files moved to Trash"
  },
  "3 files restored": {
    "title": "3 files restored",
    "description": "Back in original folders."
  },
  "Trash emptied": {
    "title": "Trash emptied"
  },
  "Export started": {
    "title": "Export started"
  },
  "Download couldn’t start": {
    "title": "Download couldn’t start"
  },
  "Version 7 saved": {
    "title": "Version 7 saved"
  },
  "Active revision updated": {
    "title": "Active revision updated"
  },
  "Version 3 restored as version 8": {
    "title": "Version 3 restored"
  },
  "Version 3 deleted": {
    "title": "Version 3 deleted"
  },
  "Someone else updated this file": {
    "title": "File changed elsewhere",
    "description": "Text preserved.",
    "type": "warning"
  },
  "Editing access expired": {
    "title": "Editing access expired",
    "description": "Text preserved."
  },
  "Preview opened": {
    "title": "Preview opened",
    "description": "This format isn’t editable."
  },
  "File types don’t match": {
    "title": "File types don’t match",
    "description": "Choose another .md file.",
    "type": "warning"
  },
  "That name is already in use": {
    "title": "That name is already in use",
    "description": "Choose a different name.",
    "type": "warning"
  },
  "Select up to 200 items": {
    "title": "Select up to 200 items",
    "type": "warning"
  },
  "Files uploaded · 2 weren’t attached": {
    "title": "2 files weren’t attached",
    "description": "Already uploaded.",
    "type": "warning"
  },
  "File attached to task": {
    "title": "File attached to task"
  },
  "Published to Project Files": {
    "title": "Published to Project Files"
  },
  "Files saved · list is refreshing": {
    "title": "Saved · refreshing list",
    "description": "Files are safely saved.",
    "type": "warning"
  },
  "Creating your project": {
    "title": "Creating your project"
  },
  "Project created": {
    "title": "Project created"
  },
  "Project created · folder imported": {
    "title": "Project & files ready"
  },
  "Project created · image needs attention": {
    "title": "Project created",
    "description": "Image upload failed.",
    "type": "warning"
  },
  "Project created · permissions unchanged": {
    "title": "Project created",
    "description": "Docs stay leaders-only.",
    "type": "warning"
  },
  "Project created · 2 files need attention": {
    "title": "Project created",
    "type": "warning"
  },
  "Folder upload continues in the background": {
    "title": "Uploading in background"
  },
  "Project settings saved": {
    "title": "Project settings saved"
  },
  "Project image updated": {
    "title": "Project image updated"
  },
  "Project image removed": {
    "title": "Project image removed"
  },
  "Following Fieldnotes": {
    "title": "Following Fieldnotes"
  },
  "Project unfollowed": {
    "title": "Project unfollowed"
  },
  "Moved to Build": {
    "title": "Moved to Build"
  },
  "Stage updated elsewhere": {
    "title": "Stage updated elsewhere"
  },
  "Only the project owner can change stages": {
    "title": "Only owners can change stages",
    "description": "Ask the project owner.",
    "type": "warning"
  },
  "Project roles updated": {
    "title": "Project roles updated"
  },
  "Tab visibility updated": {
    "title": "Tab visibility updated"
  },
  "Upload permissions updated": {
    "title": "Upload permissions updated"
  },
  "Document permissions updated": {
    "title": "Doc permissions updated"
  },
  "Publishing permissions updated": {
    "title": "Publishing access saved"
  },
  "Lifecycle updated": {
    "title": "Lifecycle updated"
  },
  "Ownership transferred": {
    "title": "Ownership transferred"
  },
  "Project archived": {
    "title": "Project archived"
  },
  "Project deleted": {
    "title": "Project deleted"
  },
  "Project couldn’t be deleted": {
    "title": "Project wasn’t deleted"
  },
  "Complete the highlighted fields": {
    "title": "Check required fields",
    "description": "Draft kept.",
    "type": "warning"
  },
  "Choose a supported image": {
    "title": "Choose a supported image",
    "description": "JPG, PNG, WebP, GIF · <2 MB",
    "type": "warning"
  },
  "Draft restored": {
    "title": "Draft restored"
  },
  "Project draft cleared": {
    "title": "Project draft cleared"
  },
  "Draft wasn’t saved": {
    "title": "Draft wasn’t saved",
    "description": "Keep this page open."
  },
  "GitHub wasn’t connected": {
    "title": "GitHub wasn’t connected",
    "description": "Draft preserved.",
    "type": "warning"
  },
  "Sending connection request…": {
    "title": "Sending connection request…"
  },
  "Connection request sent": {
    "title": "Request sent"
  },
  "You’re connected": {
    "title": "You’re connected"
  },
  "Connection request cancelled": {
    "title": "Request cancelled"
  },
  "Connection request declined": {
    "title": "Request declined"
  },
  "Connection removed": {
    "title": "Connection removed"
  },
  "Account blocked": {
    "title": "Account blocked"
  },
  "Account unblocked": {
    "title": "Account unblocked"
  },
  "Invitation sent": {
    "title": "Invitation sent"
  },
  "Invitation sent · capacity is limited": {
    "title": "Sent · capacity warning",
    "type": "warning"
  },
  "Invitation accepted": {
    "title": "Invitation accepted"
  },
  "Invitation declined": {
    "title": "Invitation declined"
  },
  "Application submitted": {
    "title": "Application submitted"
  },
  "Application resubmitted": {
    "title": "Application resubmitted"
  },
  "Application accepted": {
    "title": "Application accepted"
  },
  "Application declined": {
    "title": "Application declined"
  },
  "Application reopened": {
    "title": "Application reopened"
  },
  "Application withdrawn": {
    "title": "Application withdrawn"
  },
  "7 applications accepted": {
    "title": "7 applications accepted"
  },
  "5 accepted · 2 need attention": {
    "title": "5 accepted · 2 failed",
    "description": "Accepted changes saved.",
    "type": "warning"
  },
  "You already have a pending application": {
    "title": "Application already pending",
    "type": "warning"
  },
  "You have 20 pending applications": {
    "title": "20 applications pending",
    "description": "Withdraw one to apply.",
    "type": "warning"
  },
  "You can apply again later": {
    "title": "You can apply again later",
    "description": "Check your application."
  },
  "Task created": {
    "title": "Task created"
  },
  "Task completed": {
    "title": "Task completed"
  },
  "Task submitted for review": {
    "title": "Task submitted for review"
  },
  "Review this task before moving it": {
    "title": "Task needs review",
    "type": "warning"
  },
  "Task couldn’t be moved": {
    "title": "Task couldn’t be moved",
    "description": "Previous position kept."
  },
  "4 subtasks updated · 2 need attention": {
    "title": "4 updated · 2 failed",
    "description": "Completed changes saved.",
    "type": "warning"
  },
  "Workflow saved": {
    "title": "Workflow saved"
  },
  "Section deleted": {
    "title": "Section deleted"
  },
  "Sprint created": {
    "title": "Sprint created"
  },
  "Sprint updated": {
    "title": "Sprint updated"
  },
  "Sprint deleted": {
    "title": "Sprint deleted"
  },
  "Task move in progress": {
    "title": "Task move in progress",
    "description": "Wait for this move."
  },
  "Message wasn’t sent": {
    "title": "Message wasn’t sent",
    "description": "Text kept in composer."
  },
  "Reply sent": {
    "title": "Reply sent"
  },
  "Message shared": {
    "title": "Message shared"
  },
  "Message scheduled": {
    "title": "Message scheduled"
  },
  "Message rescheduled": {
    "title": "Message rescheduled"
  },
  "Scheduled message cancelled": {
    "title": "Scheduled message cancelled"
  },
  "Draft discarded": {
    "title": "Draft discarded"
  },
  "Message deleted": {
    "title": "Message deleted"
  },
  "Message restored": {
    "title": "Message restored"
  },
  "Message deletion complete": {
    "title": "Message deletion complete"
  },
  "Reply sent · channel copy failed": {
    "title": "Sent · copy failed",
    "description": "Your thread reply is safe.",
    "type": "warning"
  },
  "Message pinned": {
    "title": "Message pinned"
  },
  "Message unpinned": {
    "title": "Message unpinned"
  },
  "Message saved": {
    "title": "Message saved"
  },
  "Removed from Saved": {
    "title": "Removed from Saved"
  },
  "Reminder set": {
    "title": "Reminder set"
  },
  "Reminder cleared": {
    "title": "Reminder cleared"
  },
  "Conversations marked as read": {
    "title": "Marked as read"
  },
  "Marked unread from here": {
    "title": "Marked unread from here"
  },
  "Following this thread": {
    "title": "Following this thread"
  },
  "Following · conversation is muted": {
    "title": "Following · muted",
    "description": "Unmute for notifications.",
    "type": "warning"
  },
  "Thread unfollowed": {
    "title": "Thread unfollowed"
  },
  "Channel created": {
    "title": "Channel created"
  },
  "Channel renamed": {
    "title": "Channel renamed"
  },
  "Channel is now private": {
    "title": "Channel is now private",
    "description": "Members only."
  },
  "Channel is now public": {
    "title": "Channel is now public",
    "description": "Project members can join."
  },
  "Channel archived": {
    "title": "Channel archived",
    "description": "Messages are kept."
  },
  "Channel unarchived": {
    "title": "Channel unarchived"
  },
  "Conversation closed": {
    "title": "Conversation closed"
  },
  "You left the channel": {
    "title": "You left the channel"
  },
  "Kavya Menon added": {
    "title": "Kavya Menon added"
  },
  "Kavya Menon removed": {
    "title": "Kavya Menon removed"
  },
  "Channel role updated": {
    "title": "Channel role updated"
  },
  "Bookmark added for everyone": {
    "title": "Bookmark added for everyone"
  },
  "Bookmark removed for everyone": {
    "title": "Shared bookmark removed"
  },
  "Canvas hidden for you": {
    "title": "Canvas hidden for you",
    "description": "Still visible to others."
  },
  "Template applied": {
    "title": "Template applied"
  },
  "Canvas updated by someone else": {
    "title": "Canvas changed elsewhere",
    "description": "Latest version is shown.",
    "type": "warning"
  },
  "Report submitted": {
    "title": "Report submitted"
  },
  "Group created · name wasn’t saved": {
    "title": "Created · name not saved",
    "description": "Your group is ready.",
    "type": "warning"
  },
  "An attachment needs attention": {
    "title": "An attachment needs attention",
    "description": "Retry or remove the file.",
    "type": "warning"
  },
  "Profile saved": {
    "title": "Profile saved"
  },
  "Avatar ready to save": {
    "title": "Avatar ready to save",
    "description": "Save profile to publish.",
    "type": "warning"
  },
  "Avatar removed from your draft": {
    "title": "Avatar removed from draft",
    "description": "Save profile to publish."
  },
  "Profile changed in another session": {
    "title": "Profile changed elsewhere",
    "description": "Draft preserved.",
    "type": "warning"
  },
  "Open to collaboration": {
    "title": "Open to collaboration"
  },
  "Collaboration turned off": {
    "title": "Collaboration turned off"
  },
  "Status updated": {
    "title": "Status updated"
  },
  "Status cleared": {
    "title": "Status cleared"
  },
  "Project status updated": {
    "title": "Project status updated"
  },
  "Project status cleared": {
    "title": "Project status cleared"
  },
  "This role is already on your profile": {
    "title": "Role already added"
  },
  "Choose when your status should clear": {
    "title": "Choose a status end time",
    "description": "Add an end time.",
    "type": "warning"
  },
  "Project update posted": {
    "title": "Project update posted"
  },
  "Update edited": {
    "title": "Update edited"
  },
  "Update removed": {
    "title": "Update removed"
  },
  "Comment wasn’t posted": {
    "title": "Comment wasn’t posted",
    "description": "Text kept in editor."
  },
  "Reaction wasn’t saved": {
    "title": "Reaction wasn’t saved"
  },
  "Added to Docs": {
    "title": "Added to Docs"
  },
  "Removed from Docs": {
    "title": "Removed from Docs",
    "description": "Original doc kept."
  },
  "Update hidden until reload": {
    "title": "Update hidden until reload"
  },
  "Kavya mentioned you": {
    "title": "Kavya mentioned you"
  },
  "4 new updates in Fieldnotes": {
    "title": "4 new updates in Fieldnotes"
  },
  "All notifications cleared": {
    "title": "All notifications cleared"
  },
  "Notification snoozed": {
    "title": "Notification snoozed"
  },
  "Notification settings saved": {
    "title": "Notification settings saved"
  },
  "Browser notifications are blocked": {
    "title": "Notifications blocked",
    "description": "Check browser settings.",
    "type": "warning"
  },
  "Push isn’t available in this browser": {
    "title": "Push unavailable here",
    "description": "In-app alerts still work."
  },
  "Push disabled · cleanup is pending": {
    "title": "Push off · cleanup pending",
    "description": "Push is off on this device.",
    "type": "warning"
  },
  "Password updated": {
    "title": "Password updated"
  },
  "Password added": {
    "title": "Password added"
  },
  "Authenticator enabled": {
    "title": "Authenticator enabled"
  },
  "Authenticator enabled · codes weren’t created": {
    "title": "Authenticator enabled",
    "description": "Recovery codes missing.",
    "type": "warning"
  },
  "Authenticator removed": {
    "title": "Authenticator removed",
    "description": "Review sign-in methods."
  },
  "Recovery codes regenerated": {
    "title": "Recovery codes regenerated",
    "description": "Previous codes invalid."
  },
  "Recovery codes copied": {
    "title": "Recovery codes copied",
    "description": "Keep codes private."
  },
  "Setup key copied": {
    "title": "Setup key copied",
    "description": "Keep this key private."
  },
  "Device verified": {
    "title": "Device verified"
  },
  "Other devices signed out": {
    "title": "Other devices signed out",
    "description": "This device stays signed in."
  },
  "Sign in to continue": {
    "title": "Sign in to continue",
    "description": "Session ended.",
    "type": "warning"
  },
  "Enter the 6-digit code": {
    "title": "Enter the 6-digit code",
    "description": "Use your authenticator.",
    "type": "warning"
  },
  "Passwords don’t match": {
    "title": "Passwords don’t match",
    "description": "Use the same password.",
    "type": "warning"
  },
  "Privacy settings saved": {
    "title": "Privacy settings saved"
  },
  "Application cache cleared": {
    "title": "Application cache cleared"
  },
  "Account deletion scheduled": {
    "title": "Account deletion scheduled",
    "type": "neutral"
  },
  "Account reactivated": {
    "title": "Account reactivated",
    "description": "Deletion cancelled."
  },
  "Legal acceptance recorded": {
    "title": "Legal acceptance recorded"
  },
  "GitHub connected": {
    "title": "GitHub connected"
  },
  "GitHub account replaced": {
    "title": "GitHub account replaced"
  },
  "GitHub is already connected": {
    "title": "GitHub is already connected"
  },
  "GitHub couldn’t connect": {
    "title": "GitHub couldn’t connect",
    "description": "Existing link unchanged."
  },
  "Add another sign-in method first": {
    "title": "Add a sign-in method first",
    "description": "Before replacing GitHub.",
    "type": "warning"
  },
  "Editor connected": {
    "title": "Editor connected"
  },
  "Editor session revoked": {
    "title": "Editor session revoked"
  },
  "Editor token wasn’t created": {
    "title": "Editor token wasn’t created"
  },
  "You’re offline": {
    "title": "You’re offline",
    "description": "Live updates paused.",
    "type": "warning"
  },
  "Reconnecting…": {
    "title": "Reconnecting…"
  },
  "You’re back online": {
    "title": "You’re back online",
    "description": "Live updates resumed."
  },
  "Live updates are unavailable": {
    "title": "Live updates are unavailable",
    "description": "Last loaded data kept."
  },
  "You no longer have access": {
    "title": "You no longer have access",
    "description": "Permissions changed.",
    "type": "warning"
  },
  "Please wait before trying again": {
    "title": "Please wait to try again",
    "type": "warning"
  },
  "This item is no longer available": {
    "title": "Item unavailable",
    "description": "Removed or access changed."
  },
  "That action couldn’t be completed": {
    "title": "Action couldn’t finish"
  },
  "Still working…": {
    "title": "Still working…"
  },
  "Couldn’t undo that change": {
    "title": "Couldn’t undo change",
    "description": "Change still applies."
  },
  "Change undone": {
    "title": "Change undone"
  },
  "Undo is no longer available": {
    "title": "Undo window closed"
  },
  "Sign in to continue.": {
    "title": "Sign in to continue",
    "description": "Session ended.",
    "type": "warning"
  },
  "Couldn’t reach the server": {
    "title": "Couldn’t reach the server",
    "description": "Message preserved."
  },
  "That didn't look right. Check it and try again.": {
    "title": "Check your entry",
    "description": "Correct the marked value.",
    "type": "warning"
  },
  "You're going a bit fast. Try again in a moment.": {
    "title": "Please wait to try again",
    "type": "warning"
  },
  "A channel with that name already exists.": {
    "title": "Channel name already used",
    "description": "Choose another name.",
    "type": "warning"
  },
  "You can't message this person.": {
    "title": "Can’t message this person",
    "type": "warning"
  },
  "This person only accepts messages from their connections.": {
    "title": "Connect before messaging",
    "description": "Connections only.",
    "type": "warning"
  },
  "This channel is archived.": {
    "title": "Channel archived",
    "description": "Messages are read-only.",
    "type": "warning"
  },
  "This channel is full (500 members).": {
    "title": "Channel full",
    "description": "500-member limit.",
    "type": "warning"
  },
  "This project has reached 200 channels.": {
    "title": "Project channel limit",
    "description": "200 channels maximum.",
    "type": "warning"
  },
  "You've reached the channel limit.": {
    "title": "Channel limit reached",
    "type": "warning"
  },
  "Use lowercase letters, numbers and hyphens.": {
    "title": "Check the channel name",
    "description": "Lowercase, numbers, hyphens.",
    "type": "warning"
  },
  "You're not a member of this conversation.": {
    "title": "Join the conversation first",
    "type": "warning"
  },
  "Only project members can do that.": {
    "title": "Project members only",
    "type": "warning"
  },
  "Only channel admins can do that.": {
    "title": "Channel admins only",
    "type": "warning"
  },
  "You can't leave the project's default channel.": {
    "title": "Default channel required",
    "description": "You can’t leave this channel.",
    "type": "warning"
  },
  "The default channel can't be archived.": {
    "title": "Can’t archive this channel",
    "description": "Default channel is required.",
    "type": "warning"
  },
  "This conversation can't switch between public and private.": {
    "title": "Privacy can’t change",
    "description": "This conversation is fixed.",
    "type": "warning"
  },
  "This channel can't be joined.": {
    "title": "Can’t join this channel",
    "type": "warning"
  },
  "@channel and @here work in channels of 100 or fewer.": {
    "title": "Broadcast mention unavailable",
    "description": "100 members maximum.",
    "type": "warning"
  },
  "Messages can be up to 4,000 characters.": {
    "title": "Message too long",
    "description": "4,000 characters maximum.",
    "type": "warning"
  },
  "Messages can be up to 4,000 characters, and need text or a file.": {
    "title": "Check your message",
    "description": "Text or file · max 4,000 chars",
    "type": "warning"
  },
  "Write a message first.": {
    "title": "Write a message first",
    "type": "warning"
  },
  "Add who it's for first.": {
    "title": "Add a recipient first",
    "type": "warning"
  },
  "Up to 10 attachments per message.": {
    "title": "Too many attachments",
    "description": "10 files per message.",
    "type": "warning"
  },
  "This message can't be edited.": {
    "title": "Message can’t be edited",
    "type": "warning"
  },
  "This message can't be deleted.": {
    "title": "Message can’t be deleted",
    "type": "warning"
  },
  "Only members can pin here.": {
    "title": "Only members can pin",
    "type": "warning"
  },
  "That message isn't available anymore.": {
    "title": "Message unavailable",
    "type": "warning"
  },
  "That role isn't available.": {
    "title": "Role unavailable",
    "description": "Choose another role.",
    "type": "warning"
  },
  "That person isn't in this channel.": {
    "title": "Person isn’t in this channel",
    "type": "warning"
  },
  "Pick a time in the future.": {
    "title": "Choose a future time",
    "type": "warning"
  },
  "Type at least 2 characters to search.": {
    "title": "Keep typing to search",
    "description": "At least 2 characters.",
    "type": "warning"
  },
  "That search is too broad. Narrow it with In, From or dates.": {
    "title": "Narrow your search",
    "description": "Use In, From, or dates.",
    "type": "warning"
  },
  "Tasks can only be created in project channels.": {
    "title": "Project channel required",
    "description": "Create tasks in a project.",
    "type": "warning"
  },
  "The task couldn't be created.": {
    "title": "Task wasn’t created"
  },
  "That task is still being created. Try again in a moment.": {
    "title": "Task is being created",
    "description": "Please wait to try again.",
    "type": "warning"
  },
  "An attachment is still uploading.": {
    "title": "Attachment still uploading",
    "description": "Wait before sending.",
    "type": "warning"
  },
  "Group chats have up to 9 people.": {
    "title": "Group chat is full",
    "description": "9 people maximum.",
    "type": "warning"
  },
  "Messages in an application conversation are private and can't be shared.": {
    "title": "Private conversation",
    "description": "Messages can’t be shared.",
    "type": "warning"
  },
  "People in an application conversation are fixed: the applicant and the project's reviewers.": {
    "title": "Members can’t change",
    "description": "Applicant and reviewers only.",
    "type": "warning"
  },
  "Canvas is unavailable": {
    "title": "Canvas unavailable",
    "description": "Ask your administrator.",
    "type": "warning"
  },
  "Only channel admins can delete a canvas that has content.": {
    "title": "Canvas has content",
    "description": "Only admins can delete it.",
    "type": "warning"
  },
  "Someone else just edited this canvas. Showing the latest version.": {
    "title": "Canvas changed elsewhere",
    "description": "Latest version is shown.",
    "type": "warning"
  },
  "Enter the 6-digit code from your authenticator app": {
    "title": "Enter the 6-digit code",
    "description": "Use your authenticator.",
    "type": "warning"
  },
  "Authenticator app enabled": {
    "title": "Authenticator enabled"
  },
  "Authenticator app removed": {
    "title": "Authenticator removed",
    "description": "Review sign-in methods."
  },
  "Secret copied": {
    "title": "Setup key copied",
    "description": "Keep this key private."
  },
  "Could not copy the secret on this device": {
    "title": "Could not copy the secret on this device"
  },
  "Could not copy the recovery codes on this device": {
    "title": "Could not copy the recovery codes on this device"
  },
  "Add files once the conversation has started.": {
    "title": "Add files once the conversation has started."
  },
  "A file didn't upload. Retry it or remove it, then send.": {
    "title": "Attachment needs attention",
    "description": "Retry or remove the file.",
    "type": "warning"
  },
  "Usage: /poll Question | Option 1 | Option 2": {
    "title": "Usage: /poll Question | Option 1 | Option 2"
  },
  "Could not load the latest replies. Your draft is still here.": {
    "title": "Could not load the latest replies. Your draft is still here."
  },
  "Unpinned": {
    "title": "Unpinned"
  },
  "Canvas tab hidden for you": {
    "title": "Canvas tab hidden for you"
  },
  "Conversation marked as read": {
    "title": "Conversation marked as read"
  },
  "Already deleted": {
    "title": "Already deleted"
  },
  "Pinned to the conversation": {
    "title": "Pinned to the conversation"
  },
  "You're no longer in that project.": {
    "title": "You're no longer in that project."
  },
  "Unfollowed": {
    "title": "Unfollowed"
  },
  "Added below your existing draft": {
    "title": "Added below your existing draft"
  },
  "Kept as a draft": {
    "title": "Kept as a draft"
  },
  "Sent": {
    "title": "Sent"
  },
  "Group created; its name wasn't saved.": {
    "title": "Group created; its name wasn't saved."
  },
  "Could not load the latest replies. Try again.": {
    "title": "Could not load the latest replies. Try again."
  },
  "That day is further back. Showing the earliest messages loaded so far.": {
    "title": "Earlier history not loaded",
    "description": "Showing loaded messages."
  },
  "Report submitted. We'll review it shortly.": {
    "title": "Report submitted. We'll review it shortly."
  },
  "Saved": {
    "title": "Saved"
  },
  "Decline undone": {
    "title": "Decline undone"
  },
  "Could not undo": {
    "title": "Could not undo"
  },
  "Please log in to connect": {
    "title": "Please log in to connect"
  },
  "Add an emoji or some text.": {
    "title": "Add an emoji or some text."
  },
  "Couldn't clear the project status.": {
    "title": "Couldn't clear the project status."
  },
  "Choose when the status should clear.": {
    "title": "Choose when the status should clear.",
    "type": "warning"
  },
  "Couldn't save your status. Check the end time and try again.": {
    "title": "Couldn't save your status. Check the end time and try again."
  },
  "Couldn't clear your status.": {
    "title": "Couldn't clear your status."
  },
  "Fix the highlighted project contribution before saving.": {
    "title": "Fix the highlighted project contribution before saving.",
    "type": "warning"
  },
  "Profile updated successfully": {
    "title": "Profile updated"
  },
  "Latest saved changes loaded. Your draft edits are kept; review and save again.": {
    "title": "Latest version loaded",
    "description": "Draft edits kept."
  },
  "Image must be 2MB or smaller": {
    "title": "Image must be 2MB or smaller",
    "type": "warning"
  },
  "Avatar removed": {
    "title": "Avatar removed",
    "type": "warning"
  },
  "You have 20 pending applications. Withdraw one to apply.": {
    "title": "You have 20 pending applications. Withdraw one to apply."
  },
  "Project updated successfully": {
    "title": "Project updated"
  },
  "Failed to update project": {
    "title": "Couldn’t update project"
  },
  "GitHub authorization was not completed. Your draft was preserved.": {
    "title": "GitHub authorization was not completed. Your draft was preserved."
  },
  "Please complete required fields before creating": {
    "title": "Please complete required fields before creating",
    "type": "warning"
  },
  "Choose a PNG, JPG, WebP, or GIF image.": {
    "title": "Choose a PNG, JPG, WebP, or GIF image.",
    "type": "warning"
  },
  "Choose an image under 2 MB.": {
    "title": "Choose an image under 2 MB.",
    "type": "warning"
  },
  "Draft erased completely": {
    "title": "Draft erased completely"
  },
  "Draft could not be saved. Please try again.": {
    "title": "Draft could not be saved. Please try again."
  },
  "Please paste a GitHub repository link.": {
    "title": "Please paste a GitHub repository link."
  },
  "Run GitHub import checks before continuing.": {
    "title": "Run GitHub import checks before continuing."
  },
  "Continuing without full preview. Import checks passed.": {
    "title": "Continuing without full preview. Import checks passed."
  },
  "Please select a folder first.": {
    "title": "Please select a folder first.",
    "type": "warning"
  },
  "Finish adding the project link or clear the URL before continuing.": {
    "title": "Finish the project link",
    "description": "Or clear it to continue.",
    "type": "warning"
  },
  "Project created, but the picture didn’t upload. Add it from Project settings.": {
    "title": "Project created",
    "description": "Image upload failed.",
    "type": "warning"
  },
  "Project created, but doc editing is still leaders only. Change it from Project settings.": {
    "title": "Project created",
    "description": "Docs stay leaders-only.",
    "type": "warning"
  },
  "Uploading your folder in the background…": {
    "title": "Uploading your folder in the background…"
  },
  "Project created and folder imported.": {
    "title": "Project created and folder imported."
  },
  "Project created.": {
    "title": "Project created."
  },
  "That project tab is not visible for your current access.": {
    "title": "That project tab is not visible for your current access."
  },
  "Project members cannot apply for an additional role": {
    "title": "Project members cannot apply for an additional role"
  },
  "You have an invitation to this project. Accept or decline it first.": {
    "title": "Project invitation pending",
    "description": "Accept or decline it first.",
    "type": "warning"
  },
  "Stage updated from another session. Synced latest stage.": {
    "title": "Stage updated from another session. Synced latest stage."
  },
  "Stage update is in progress": {
    "title": "Stage update is in progress"
  },
  "Project is already at the starting stage": {
    "title": "Project is already at the starting stage"
  },
  "Project is already at the final stage": {
    "title": "Project is already at the final stage"
  },
  "Project links saved": {
    "title": "Project links saved"
  },
  "Failed to add doc": {
    "title": "Couldn’t add doc"
  },
  "Project name cannot be empty.": {
    "title": "Project name cannot be empty.",
    "type": "warning"
  },
  "Add a custom category or choose one from the dropdown.": {
    "title": "Add a custom category or choose one from the dropdown."
  },
  "Failed to update project identity.": {
    "title": "Couldn’t update project identity."
  },
  "General settings updated.": {
    "title": "General settings updated."
  },
  "Unsupported image type. Use JPG, PNG, WebP, or GIF.": {
    "title": "Unsupported image type. Use JPG, PNG, WebP, or GIF."
  },
  "Failed to read selected image.": {
    "title": "Couldn’t read selected image."
  },
  "Project avatar removed.": {
    "title": "Project avatar removed."
  },
  "You must have at least one stage": {
    "title": "You must have at least one stage",
    "type": "warning"
  },
  "Failed to copy slug.": {
    "title": "Couldn’t copy slug."
  },
  "Failed to load danger-zone checks.": {
    "title": "Couldn’t load danger-zone checks."
  },
  "Failed to load collaborators.": {
    "title": "Couldn’t load collaborators."
  },
  "Failed to load project notification settings.": {
    "title": "Couldn’t load project notification settings."
  },
  "Failed to load document settings.": {
    "title": "Couldn’t load document settings."
  },
  "Failed to update project roles.": {
    "title": "Couldn’t update project roles."
  },
  "Project roles updated.": {
    "title": "Project roles updated."
  },
  "Fix role fields before saving.": {
    "title": "Fix role fields before saving.",
    "type": "warning"
  },
  "Failed to update tab visibility.": {
    "title": "Couldn’t update tab visibility."
  },
  "Failed to prepare access transition.": {
    "title": "Couldn’t prepare access transition."
  },
  "Failed to update file upload permission.": {
    "title": "Couldn’t update file upload permission."
  },
  "Failed to update file upload defaults.": {
    "title": "Couldn’t update file upload defaults."
  },
  "Failed to save project notification settings.": {
    "title": "Couldn’t save project notification settings."
  },
  "Document setting updated.": {
    "title": "Document setting updated."
  },
  "Failed to save document setting.": {
    "title": "Couldn’t save document setting."
  },
  "Failed to reset project notification settings.": {
    "title": "Couldn’t reset project notification settings."
  },
  "Failed to load member notification settings.": {
    "title": "Couldn’t load member notification settings."
  },
  "Failed to save member notification settings.": {
    "title": "Couldn’t save member notification settings."
  },
  "Failed to reset member notification settings.": {
    "title": "Couldn’t reset member notification settings."
  },
  "Failed to update member publishing permissions.": {
    "title": "Couldn’t update member publishing permissions."
  },
  "Member publishing permissions updated.": {
    "title": "Member publishing permissions updated."
  },
  "Failed to update the upload default for new members.": {
    "title": "Couldn’t update the upload default for new members."
  },
  "Upload default for new members updated.": {
    "title": "Upload default for new members updated."
  },
  "Action failed. Please try again.": {
    "title": "Action failed. Please try again."
  },
  "Failed to archive project.": {
    "title": "Couldn’t archive project."
  },
  "Project ownership transferred successfully.": {
    "title": "Project ownership transferred"
  },
  "Failed to transfer ownership.": {
    "title": "Couldn’t transfer ownership."
  },
  "Run danger-zone preflight before archiving.": {
    "title": "Run danger-zone preflight before archiving."
  },
  "Project is already archived.": {
    "title": "Project is already archived."
  },
  "Choose a member before transferring ownership.": {
    "title": "Choose a member before transferring ownership.",
    "type": "warning"
  },
  "Failed to load removal impact.": {
    "title": "Couldn’t load removal impact."
  },
  "Failed to delete project.": {
    "title": "Couldn’t delete project."
  },
  "Run danger-zone preflight before deleting.": {
    "title": "Run danger-zone preflight before deleting."
  },
  "Project cannot be deleted.": {
    "title": "Project cannot be deleted."
  },
  "Lifecycle updated.": {
    "title": "Lifecycle updated."
  },
  "Failed to update lifecycle.": {
    "title": "Couldn’t update lifecycle."
  },
  "Hidden until you reload": {
    "title": "Hidden until you reload"
  },
  "Use a valid http or https link.": {
    "title": "Use a valid http or https link."
  },
  "Use JPG, PNG, WebP, or GIF images.": {
    "title": "Use JPG, PNG, WebP, or GIF images."
  },
  "Please log in to like updates": {
    "title": "Please log in to like updates"
  },
  "Please log in to comment": {
    "title": "Please log in to comment"
  },
  "This item is not available or you do not have access.": {
    "title": "This item is not available or you do not have access."
  },
  "Undoing change…": {
    "title": "Undoing change…"
  },
  "The requested file is not available or you do not have access.": {
    "title": "The requested file is not available or you do not have access."
  },
  "Deep link target not found.": {
    "title": "Deep link target not found."
  },
  "Create a task first to attach files to tasks.": {
    "title": "Create a task first to attach files to tasks."
  },
  "Task link copied to clipboard": {
    "title": "Task link copied to clipboard"
  },
  "File removed from this task. The original file is unchanged.": {
    "title": "File removed from this task. The original file is unchanged."
  },
  "Restored to its original location": {
    "title": "Restored to its original location"
  },
  "Deletion is pending storage cleanup. It remains in Trash and will be retried automatically; you can also retry from its menu.": {
    "title": "Cleanup pending",
    "description": "Item kept in Trash. Retry there.",
    "type": "warning"
  },
  "Permanently deleted. This cannot be undone.": {
    "title": "Permanently deleted. This cannot be undone."
  },
  "File link copied. Recipients still need access.": {
    "title": "File link copied. Recipients still need access."
  },
  "Could not copy the link. Check browser clipboard permissions.": {
    "title": "Could not copy the link. Check browser clipboard permissions."
  },
  "Save or cancel your edits before uploading a revision.": {
    "title": "Save or cancel your edits before uploading a revision."
  },
  "Only single-file drops accepted": {
    "title": "Only single-file drops accepted"
  },
  "New revision committed successfully": {
    "title": "New revision committed"
  },
  "Active revision updated successfully": {
    "title": "Active revision updated"
  },
  "Could not prepare raw file": {
    "title": "Could not prepare raw file"
  },
  "This file type is not editable in place": {
    "title": "This file type is not editable in place"
  },
  "Editing lease was lost. Your text is preserved; reacquire the file before saving.": {
    "title": "Editing access expired",
    "description": "Text preserved.",
    "type": "warning"
  },
  "Cannot save: file has no storage key.": {
    "title": "Cannot save: file has no storage key."
  },
  "Select up to 200 items per operation.": {
    "title": "Select up to 200 items per operation.",
    "type": "info"
  },
  "Failed to save revision": {
    "title": "Couldn’t save revision"
  },
  "File link copied": {
    "title": "File link copied"
  },
  "Could not copy the link": {
    "title": "Could not copy the link"
  },
  "This file format cannot be edited inline. Previewing file instead.": {
    "title": "Preview opened",
    "description": "This format isn’t editable."
  },
  "Select up to 200 files at a time.": {
    "title": "Select up to 200 files at a time.",
    "type": "info"
  },
  "Invalid file name": {
    "title": "Invalid file name"
  },
  "File name is too long (maximum 255 characters)": {
    "title": "File name is too long (maximum 255 characters)"
  },
  "File name cannot contain slashes": {
    "title": "File name cannot contain slashes",
    "type": "warning"
  },
  "Wait for the current task move to finish.": {
    "title": "Wait for the current task move to finish."
  },
  "This spot is too crowded to place a card. Drop it one card higher or lower.": {
    "title": "Choose another position",
    "description": "Drop one card above or below.",
    "type": "warning"
  },
  "Open the task and use Approve or Request changes to resolve its review.": {
    "title": "Task needs review",
    "description": "Approve or request changes.",
    "type": "warning"
  },
  "Failed to save new version": {
    "title": "Couldn’t save new version"
  },
  "Failed to upload files": {
    "title": "Couldn’t upload files"
  },
  "A new version must use the same file type.": {
    "title": "A new version must use the same file type.",
    "type": "warning"
  },
  "Account scheduled for deletion": {
    "title": "Account deletion scheduled",
    "type": "neutral"
  },
  "Could not clear the application cache": {
    "title": "Could not clear the application cache"
  },
  "GitHub account linked": {
    "title": "GitHub account linked"
  },
  "This GitHub account is already linked.": {
    "title": "This GitHub account is already linked."
  },
  "Editor connected successfully!": {
    "title": "Editor connected"
  },
  "Failed to generate token": {
    "title": "Couldn’t generate token"
  },
  "Add a password or authenticator in Security before replacing GitHub": {
    "title": "Add a sign-in method first",
    "description": "Before replacing GitHub.",
    "type": "warning"
  },
  "Could not revoke editor session": {
    "title": "Could not revoke editor session"
  },
  "Copied to clipboard": {
    "title": "Copied to clipboard"
  },
  "Your legal acceptance was recorded": {
    "title": "Your legal acceptance was recorded"
  },
  "Failed to save preferences": {
    "title": "Couldn’t save preferences"
  },
  "Couldn't resume notifications.": {
    "title": "Couldn't resume notifications."
  },
  "This browser doesn't support web push.": {
    "title": "This browser doesn't support web push."
  },
  "Push was disabled here, but server cleanup did not finish.": {
    "title": "Push was disabled here, but server cleanup did not finish."
  },
  "Couldn't change push notifications.": {
    "title": "Couldn't change push notifications."
  },
  "Passwords do not match": {
    "title": "Passwords don’t match",
    "description": "Use the same password.",
    "type": "warning"
  },
  "Account reactivated successfully!": {
    "title": "Account reactivated",
    "description": "Deletion cancelled."
  },
  "Failed to cancel deletion": {
    "title": "Couldn’t cancel deletion"
  },
  "This device is verified for security changes": {
    "title": "This device is verified for security changes"
  },
  "Other devices were signed out": {
    "title": "Other devices were signed out"
  },
  "Declined": {
    "title": "Declined"
  },
  "Invite accepted": {
    "title": "Invite accepted"
  },
  "Invite rejected": {
    "title": "Invite rejected"
  },
  "Connection request accepted": {
    "title": "Connection request accepted"
  },
  "Connection request rejected": {
    "title": "Connection request rejected"
  },
  "Task link copied": {
    "title": "Task link copied"
  },
  "Failed to cancel sent requests": {
    "title": "Couldn’t cancel sent requests"
  },
  "Snoozed — we'll bring it back": {
    "title": "Snoozed — we'll bring it back"
  },
  "Couldn't copy. Your browser blocked the clipboard.": {
    "title": "Couldn’t copy",
    "description": "Clipboard is blocked."
  },
  "Failed to load more files": {
    "title": "Couldn’t load more files"
  },
  "Change saved. Folder refresh failed; the list will retry automatically.": {
    "title": "Saved · refreshing list",
    "description": "Changes are safely saved.",
    "type": "warning"
  },
  "Files uploaded. Folder refresh failed; the list will retry automatically.": {
    "title": "Saved · refreshing list",
    "description": "Files are safely saved.",
    "type": "warning"
  },
  "Name is required": {
    "title": "Name is required",
    "type": "warning"
  },
  "A file/folder with that name already exists here.": {
    "title": "A file/folder with that name already exists here."
  },
  "Secure folder export started": {
    "title": "Secure folder export started"
  },
  "All selected files already exist and were skipped": {
    "title": "All selected files already exist and were skipped"
  },
  "No new files to upload; existing files were kept": {
    "title": "No new files to upload; existing files were kept"
  },
  "File exceeds maximum upload size limit": {
    "title": "File too large",
    "type": "warning"
  },
  "Failed to start authenticator setup": {
    "title": "Couldn’t start authenticator setup"
  },
  "Authenticator app enabled, but recovery code generation failed. Generate them from Security settings.": {
    "title": "Authenticator enabled",
    "description": "Recovery codes missing.",
    "type": "warning"
  },
  "Failed to complete this security action": {
    "title": "Couldn’t complete this security action"
  },
  "Failed to generate recovery codes": {
    "title": "Couldn’t generate recovery codes"
  },
  "chat_body_too_long": {
    "title": "chat_body_too_long"
  },
  "an admin": {
    "title": "an admin"
  },
  "a member": {
    "title": "a member"
  },
  "Group renamed": {
    "title": "Group renamed"
  },
  "private": {
    "title": "private"
  },
  "The channel is public now": {
    "title": "The channel is public now"
  },
  "The channel is private now": {
    "title": "The channel is private now"
  },
  "Could not update the link preview.": {
    "title": "Could not update the link preview."
  },
  "threads": {
    "title": "threads"
  },
  "Threads marked as read": {
    "title": "Threads marked as read"
  },
  "mentions": {
    "title": "mentions"
  },
  "Mentions marked as read": {
    "title": "Mentions marked as read"
  },
  "Inbox marked as read": {
    "title": "Inbox marked as read"
  },
  "chat_dm_not_allowed": {
    "title": "chat_dm_not_allowed"
  },
  "Following. This conversation is muted, so new replies won't notify you or show as new. Unmute it to hear about them.": {
    "title": "Following · muted",
    "description": "Unmute for notifications.",
    "type": "info"
  },
  "You'll be notified about new replies": {
    "title": "You'll be notified about new replies"
  },
  "You won't be notified about this thread": {
    "title": "You won't be notified about this thread"
  },
  "That didn't work. Try again.": {
    "title": "That didn't work. Try again."
  },
  "the conversation": {
    "title": "the conversation"
  },
  "Could not reopen the application": {
    "title": "Could not reopen the application"
  },
  "forbidden": {
    "title": "forbidden"
  },
  "Only owners and admins can set the project status.": {
    "title": "Only owners and admins can set the project status."
  },
  "Couldn't set the project status. Check the end time.": {
    "title": "Couldn't set the project status. Check the end time."
  },
  "Could not update availability": {
    "title": "Could not update availability"
  },
  "Failed to update block state": {
    "title": "Couldn’t update block state"
  },
  "Unknown error": {
    "title": "Unknown error"
  },
  "Resolve blocked files before continuing.": {
    "title": "Resolve blocked files before continuing."
  },
  "Failed to create project": {
    "title": "Couldn’t create project"
  },
  "Invitation sent. This person is nearing their Guide capacity.": {
    "title": "Invitation sent",
    "description": "Guide capacity nearly full.",
    "type": "warning"
  },
  "Invitation sent successfully": {
    "title": "Invitation sent"
  },
  "accept": {
    "title": "accept"
  },
  "Invitation accepted successfully!": {
    "title": "Invitation accepted"
  },
  "Invitation declined.": {
    "title": "Invitation declined."
  },
  "Failed to accept invitation": {
    "title": "Couldn’t accept invitation"
  },
  "Failed to decline invitation": {
    "title": "Couldn’t decline invitation"
  },
  "Following project": {
    "title": "Following project"
  },
  "Unfollowed project": {
    "title": "Unfollowed project"
  },
  "Could not check your application. Try again.": {
    "title": "Could not check your application. Try again."
  },
  "Checking your application…": {
    "title": "Checking your application…"
  },
  "Failed to update stage after sync": {
    "title": "Couldn’t update stage after sync"
  },
  "Failed to update stage": {
    "title": "Couldn’t update stage"
  },
  "Failed to update project stage": {
    "title": "Couldn’t update project stage"
  },
  "Only the project owner can advance the stage": {
    "title": "Only the project owner can advance the stage"
  },
  "Only the project owner can revert the stage": {
    "title": "Only the project owner can revert the stage"
  },
  "Failed to save general settings.": {
    "title": "Couldn’t save general settings."
  },
  "Project avatar optimized and updated.": {
    "title": "Project avatar optimized and updated."
  },
  "Project avatar updated.": {
    "title": "Project avatar updated."
  },
  "Failed to upload project avatar.": {
    "title": "Couldn’t upload project avatar."
  },
  "Failed to remove project avatar.": {
    "title": "Couldn’t remove project avatar."
  },
  "Task completion now requires review": {
    "title": "Task completion now requires review"
  },
  "Tasks can now be completed directly": {
    "title": "Tasks can now be completed directly"
  },
  "Unable to save completion settings": {
    "title": "Unable to save completion settings"
  },
  "Project notification settings updated.": {
    "title": "Project notification settings updated."
  },
  "Failed to update document setting.": {
    "title": "Couldn’t update document setting."
  },
  "Project notification settings reset.": {
    "title": "Project notification settings reset."
  },
  "Member notification preferences updated.": {
    "title": "Member notification preferences updated."
  },
  "Member notification preferences reset.": {
    "title": "Member notification preferences reset."
  },
  "Failed to save updates settings.": {
    "title": "Couldn’t save updates settings."
  },
  "This member role cannot be changed.": {
    "title": "This member role cannot be changed."
  },
  "This member cannot be removed.": {
    "title": "This member cannot be removed."
  },
  "Failed to post update": {
    "title": "Couldn’t post update"
  },
  "images": {
    "title": "images"
  },
  "Failed to update like": {
    "title": "Couldn’t update like"
  },
  "Failed to edit update": {
    "title": "Couldn’t edit update"
  },
  "Failed to delete update": {
    "title": "Couldn’t delete update"
  },
  "Failed to update pin": {
    "title": "Couldn’t update pin"
  },
  "Failed to post comment": {
    "title": "Couldn’t post comment"
  },
  "Failed to delete comment": {
    "title": "Couldn’t delete comment"
  },
  "Failed to save workflow": {
    "title": "Couldn’t save workflow"
  },
  "Failed to delete section": {
    "title": "Couldn’t delete section"
  },
  "Try again": {
    "title": "Try again"
  },
  "The requested file is not available.": {
    "title": "The requested file is not available."
  },
  "Failed to upload file to task": {
    "title": "Couldn’t upload file to task"
  },
  "Label updated": {
    "title": "Label updated"
  },
  "Label removed": {
    "title": "Label removed"
  },
  "Failed to update label": {
    "title": "Couldn’t update label"
  },
  "Could not remove this task link": {
    "title": "Could not remove this task link"
  },
  "Could not restore file": {
    "title": "Could not restore file"
  },
  "Batch restoration failed": {
    "title": "Batch restoration failed"
  },
  "Could not review deletion": {
    "title": "Could not review deletion"
  },
  "Deletion failed": {
    "title": "Deletion failed"
  },
  "deliverable": {
    "title": "deliverable"
  },
  "File attached as a deliverable": {
    "title": "File attached as a deliverable"
  },
  "working": {
    "title": "working"
  },
  "File attached as a working file": {
    "title": "File attached as a working file"
  },
  "File attached as a reference": {
    "title": "File attached as a reference"
  },
  "Failed to remove from Docs": {
    "title": "Couldn’t remove from Docs"
  },
  "commit": {
    "title": "commit"
  },
  "Could not download file": {
    "title": "Could not download file"
  },
  "Restore failed": {
    "title": "Restore failed"
  },
  "Delete failed": {
    "title": "Delete failed"
  },
  "Failed to commit revision": {
    "title": "Couldn’t commit revision"
  },
  "Could not load more files": {
    "title": "Could not load more files"
  },
  "Could not read dropped folder": {
    "title": "Could not read dropped folder"
  },
  "Download failed": {
    "title": "Download failed"
  },
  "Failed to move task: ": {
    "title": "Couldn’t move task: "
  },
  "Failed to move task": {
    "title": "Couldn’t move task"
  },
  "Could not read the dropped files": {
    "title": "Could not read the dropped files"
  },
  "Failed to load older versions": {
    "title": "Couldn’t load older versions"
  },
  "publish": {
    "title": "publish"
  },
  "Moved in Project Files": {
    "title": "Moved in Project Files"
  },
  "Account scheduled for deletion in 30 days.": {
    "title": "Account scheduled for deletion in 30 days."
  },
  "Failed to delete account": {
    "title": "Couldn’t delete account"
  },
  "Could not link GitHub account. Please try again.": {
    "title": "Could not link GitHub account. Please try again."
  },
  "Could not start account replacement": {
    "title": "Could not start account replacement"
  },
  "Could not replace GitHub account": {
    "title": "Could not replace GitHub account"
  },
  "Could not save acceptance": {
    "title": "Could not save acceptance"
  },
  "denied": {
    "title": "denied"
  },
  "Browser notifications are blocked in browser settings.": {
    "title": "Browser notifications are blocked in browser settings."
  },
  "Browser notifications are unavailable here.": {
    "title": "Browser notifications are unavailable here."
  },
  "Couldn't enable push notifications.": {
    "title": "Couldn't enable push notifications."
  },
  "Failed to update password": {
    "title": "Couldn’t update password"
  },
  "Password updated successfully": {
    "title": "Password updated"
  },
  "Password added successfully": {
    "title": "Password added"
  },
  "Password does not meet security requirements": {
    "title": "Password does not meet security requirements"
  },
  "Failed to update privacy settings": {
    "title": "Couldn’t update privacy settings"
  },
  "Failed to unblock account": {
    "title": "Couldn’t unblock account"
  },
  "Failed to load more blocked accounts": {
    "title": "Couldn’t load more blocked accounts"
  },
  "Failed to verify this device": {
    "title": "Couldn’t verify this device"
  },
  "Failed to sign out other devices": {
    "title": "Couldn’t sign out other devices"
  },
  "No application could be accepted": {
    "title": "No application could be accepted"
  },
  "No sent requests to cancel": {
    "title": "No sent requests to cancel"
  },
  "Failed to mark notification read": {
    "title": "Couldn’t mark notification read"
  },
  "Failed to update notification state": {
    "title": "Couldn’t update notification state"
  },
  "Failed to mark notification unread": {
    "title": "Couldn’t mark notification unread"
  },
  "Failed to dismiss notification": {
    "title": "Couldn’t dismiss notification"
  },
  "Failed to clear notifications": {
    "title": "Couldn’t clear notifications"
  },
  "Failed to turn off notifications": {
    "title": "Couldn’t turn off notifications"
  },
  "Failed to snooze notification": {
    "title": "Couldn’t snooze notification"
  },
  "Invalid file selection": {
    "title": "Invalid file selection"
  },
  "Invalid folder selection": {
    "title": "Invalid folder selection"
  },
  "Code couldn’t be verified": {
    "title": "Code couldn’t be verified"
  },
  "Check password requirements": {
    "title": "Check password requirements",
    "type": "warning"
  },
  "Failed to send request": {
    "title": "Request wasn’t sent"
  },
  "Failed to block": {
    "title": "Person wasn’t blocked"
  },
  "Check the file requirements": {
    "title": "Check file requirements",
    "type": "warning"
  }
};
