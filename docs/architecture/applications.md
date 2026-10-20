# Project role applications

How a person applies for a role, how the reviewers see it, and how it shows in Messages. Statuses are in
[status-glossary.md](./status-glossary.md).

## Rules

- **One application per person per project** (`role_applications` is unique on `(project_id, applicant_id)` and
  `(role_id, applicant_id)`). Applying again after a withdrawal, a decline (once the 24 h cooldown has passed, or
  straight away for a role that was filled) or an ended membership revives the same row to `pending` with the new
  role and text. A decline that closed a *filled* role carries no cooldown.
- **At most 20 pending applications per person.** Checked under an advisory lock together with the write.
- **Edit window:** 10 minutes after submitting, the applicant can change the text, details and role.
- **Reopen window:** 10 minutes after a decline, a reviewer can reopen it (never for a filled or removed role).
- The apply form's **portfolio link and availability** are stored in `role_applications.details`; `message` is the
  cover letter, kept verbatim (2000 characters).
- A project that is archived, completed or deleted takes no applications; blocks between the two people refuse them.

## Who reviews

Reviewers are derived from project membership: the owner and admins of a live project
(`canReviewProjectSql`, `src/lib/applications/reviewers.ts`). `role_applications.creator_id` is history only, so an
ownership transfer or an admin change moves the queue and the thread membership with it.

## The thread

Each application has one private channel (`chat_channels.application_id`, created by
`chat_ensure_application_channel`) whose first message carries a live **card**. Its cast is fixed: the applicant,
the owner and the admins (kept in step by `chat_reconcile_application_members` when project roles change); nobody is
added or removed by hand. The card message cannot be deleted. Every status change posts a line saying who did what
("declined this application: …") and publishes it live; decision lines count as unread. Replies notify the other
side like a direct message, and a block between two people in the thread stops posting for both.

The card and the status bar under the thread header read the same live card (`hydrateCards`) and offer the same
controls: Accept (optional welcome), Decline (reason + note, with Undo), Reopen (timed), Withdraw.

## Notifications

In-app only. Each application event (`application_events.id`) is its own notification source, so a reapply or a
second decline after a reopen notifies again. Links open the thread; a decline carries the reason.

## Where it shows

- Project page → **Open roles** card (re-read on focus and the moment a reviewer decides): loading / error / pending (Edit, Withdraw, View conversation) / declined with
  reason / withdrawn / ended membership / closed project.
- **Network → Invitations**: "Project applications" (pending, with a review dialog), "Your applications" (sent),
  and the **Decided applications** filter (last 30 days).
- **Workspace → Requests**: compact queue; Accept all confirms and reports each application.
- **Settings → Roles** shows pending counts and asks before removing a role people applied to.
- Messages: application threads sit under their project (reviewers) or "My applications" (applicants); decided
  threads fold into a "Decided" group.

## Database notes

Migrations 0226–0230 (thread rules, lifecycle constraints, thread messaging, dropped proposal columns, one-call status lines and the prefix-duplicate index drops).
`role_applications_message_length_check` was added `NOT VALID`; validate it after a read-only check of the live data.
`chat_get_or_create_dm` still has an unreachable `'application'` reason from 0180 (applied migrations are immutable).
