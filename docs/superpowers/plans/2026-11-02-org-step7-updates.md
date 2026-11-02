# Step 7 — Updates

Report: 7.5, 16.3, 17.7, 18.4, 28.3, 30.5, 37.3, 42.15 (S21), 29.2. Decisions 5, 8, 19, 20, 23, 27, 58, 67, 100, 152. DB6.
Problems 40–49 and S20/S22 shipped in 1a/1b/1d; this step builds the screen and the rest.

**Cut:** `OrgUpdateOptions` (the box outside the composer), the composer's own Public/Members toggle when an org is in play, `window.prompt` for the removal reason.

## Server (tests first: `tests/db/organizations-updates-step7.test.ts`)

1. **Email limit (S21, 28.3, decision 67).** `orgEmailsSentToday(orgId)` in `notify.ts`: posts with `notify_level = 'email'`, not deleted, created since midnight in the org's time zone. When the limit stops an email, the post is set back to `in_app` (so it isn't counted) and create returns `emailStopped: true`.
2. **Feed payload for the composer:** `org.emailsLeft`, `org.pins` (live org pins: id + excerpt), `org.roleNames`, `org.workspaces` (admins: every child; others: their own), `org.childIsPublic`, `org.replyDefault`, `org.memberPostsOn`.
3. **Child audience (17.7, 18.4):** a child workspace that isn't public never posts Public, whatever the client sends.
4. **Replies:** members choose Comments off on their own posts too.
5. **Seen count (28.3, decision 58):** announcements carry `seen: { seen, total }` for org admins (audience people, not the author, whose `last_seen_updates_at` is at or after the post). `readUnseenPeopleAction(orgId, updateId)` lists who hasn't; `remindUnseenAction` uses the 12-hour rule with an honest count.
6. **Hide from the organization (37.3, decision 100, DB6):** migration 0051 adds `hidden_from_org_at`, `hidden_from_org_by` on `workspace_updates`. `hideSharedFromOrgAction(orgId, updateId)`: org admins only; drops it from the org feed and its pins; the workspace lead is told. The post stays in the workspace.
7. **Change audience later (37.3):** `setOrgUpdateAudienceAction(orgId, updateId, {audience, visibility}, confirmedWider)`; widening needs `confirmedWider`, narrowing applies at once. `audienceChange(prev, next)` in `update-rules.ts`.

## Screen

- Composer takes an `orgControls` slot: type switch and audience chip at the top, Pin, Also email (`3 of 5 left today` / at limit off with "5 emails sent today. Resets tomorrow."), #general and a `⋯` Comments menu in the toolbar; the button names the reach ("Post to 40 people"); zero people disables it and says why. Discard asks first when there's text.
- Child workspace: one **Who sees this** choice (Team, Everyone in CSE 3B, Public only when the workspace is public); button "Post to your team" / "Post to CSE 3B".
- Card: audience label (`Members`, `Admins`, role name, `Team Falcon +2`, `Public`), `Seen by 32 of 40` with the unseen list and Remind, Hide from CSE 3B on shared posts, Change audience, removal reason in a dialog, Report for everyone but the author, "Comments are off" line.
- Wording: org header "Announcements and discussions for CSE 3B"; child "Updates for your team"; empty states by role and filter (Clear filter); who posts here when a member can't; Recent activity empty line fits organizations.
