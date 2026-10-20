# Project role applications

How a person applies for a role, how the reviewers see it, and how it shows in Messages. Statuses are in
[status-glossary.md](./status-glossary.md).

## Rules

- **One application per person per project** (`role_applications` is unique on `(project_id, applicant_id)` and
  `(role_id, applicant_id)`). Applying again after a withdrawal, a decline (once the 24 h cooldown has passed, or
  straight away when the project closed it or the role filled) or an ended membership revives the same row to
  `pending` with the new role and text.
- **At most 20 pending applications per person.** Checked under an advisory lock together with the write. The profile
  apply picker says so up front.
- **Edit window:** 10 minutes after submitting, the applicant can change the text, details and role.
- **Reopen window:** 10 minutes after a decline, a reviewer can reopen it. Not when the role has no spot left or was
  removed, and not when the project closed it (`project_closed`, `role_removed`).
- The apply form's **portfolio link and availability** are stored in `role_applications.details` (only `http(s)` links
  are ever rendered as links); `message` is the cover letter, kept verbatim (2000 characters). A decision note is
  limited to 500.
- A project that is archived, completed or deleted takes no applications. A block between the applicant and the
  project's lead, or between the applicant and the deciding reviewer, refuses applying and every decision.
- **An invitation to the same project is the answer to wait for:** applying is refused while one is pending, and joining
  the project another way (an invitation, being added) closes the pending application as accepted.

## What closes an application besides a reviewer

When the project or a role changes, its pending applications are closed with a system reason, a line in the thread and
a notification (`src/lib/applications/closing.ts`, `notifications.ts`): the project is archived or completed
(`project_closed`), a role is removed (`role_removed`), a role fills, including by lowering its count to what is
filled (`role_filled`). Deleting a project tells its applicants first. Account deletion withdraws the user's pending
applications. Candidates whose invitation expired when a role filled are told too. Closed applications leave the
20-pending cap.

## Who reviews

Reviewers are derived from project membership: the owner and admins of a live project
(`canReviewProjectSql`, `src/lib/applications/reviewers.ts`). `role_applications.creator_id` is history only (nullable,
`ON DELETE SET NULL`). One count, `countReviewableApplications`, feeds the Network badge and tab and the Workspace
drawer; it skips deleted and blocked applicants, like the lists do. If two reviewers decide at once, the second is told
"Already declined by ‹name›" and their reason is not recorded.

## The thread

Each application has one private channel (`chat_channels.application_id`, created by
`chat_ensure_application_channel`) whose first message carries a live **card** and is the cover letter (it follows the
application when it is edited or reapplied: `chat_sync_application_letter`). Its cast is fixed: the applicant, the owner
and the admins (kept in step by `chat_reconcile_application_members`); nobody is added, removed or promoted by hand.
The card message cannot be edited or deleted, gets no link preview, and nothing in the thread can be shared out of it.
No tasks, bookmarks, files tab or canvases.

Every status change posts a line saying who did what ("declined this application: …"), publishes it live, and counts as
unread; the sidebar preview names who did it. Replies notify the other side like a direct message. A block between two
people in the thread stops posting for both. A closed (hidden) thread comes back when a message or status line lands.
Decided threads can be closed from either side.

The status bar under the header holds the controls (Accept with an optional welcome, Decline with a reason and note and
an Undo, a timed Reopen, Withdraw); the card is the record (who, role, details, timeline). After an accept both link to
the project and its chat.

## Messages sidebar

One **Applications** section right after Drafts & scheduled lists every application thread, sent or received, whatever
project is open; decided ones fold into "Decided". Rows show the person on the other side (the applicant to reviewers,
the project's lead to the applicant), the same avatar in the header, switcher and share list. Application threads
don't count in project badges.

## Notifications

In-app only. Each application event (`application_events.id`) is its own notification source, so a reapply or a second
decline after a reopen notifies again ("applied again"). Links open the thread; a decline carries the reason and the
reviewer's note, an accept its welcome note. Notices caused by the project (role filled, role removed, project closed)
come from the project, not from a reviewer.

## Where it shows

- Project page → **Open roles** card (re-read on focus and the moment a reviewer decides; stays while you have an
  application even with no spots left): loading / error / pending (Edit while the window lasts, Withdraw, View
  conversation) / declined with reason / withdrawn / accepted ("You joined as …", project chat) / ended membership /
  closed project. Owners and admins see "N pending applications · Review". On a phone the header link reads your own
  application's state.
- **Network → Invitations**: "Project applications" (pending, review dialog with cover letter, location, skills fit,
  then Accept / Decline in the same dialog), "Your applications" (sent: pending, accepted, declined, withdrawn, "Role
  filled" / "Closed"), and the **Decided applications** filter (last 30 days).
- **Workspace → Requests**: compact queue; Accept opens the welcome-note dialog, Decline asks for a reason, "Accept these
  N" confirms and reports each application.
- **Settings → Roles** shows pending counts and asks before removing a role people applied to.

## Database notes

Migrations 0226–0232 and 0234 (thread rules, lifecycle constraints, thread messaging, dropped proposal columns, one-call status
lines, message-length validation, thread guards and the cover-letter sync, application closures).
`chat_get_or_create_dm` still has an unreachable `'application'` reason from 0180 (applied migrations are immutable).
`role_applications.status` still has the unused `proposed` enum value.
