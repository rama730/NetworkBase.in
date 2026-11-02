# Step 4 — Overview

**Goal:** master plan step 4 (report §7.2, §16.6, §17.2, §26.7, §27.5, §29.2, §31.8, §32.4, §33.1–33.8; decisions 7, 49, 54, 70, 76, 79, 80, 81; DB4).
**Tests first:** `tests/unit/organization-overview-rules.test.ts` (pure rules), `tests/db/organizations-overview.test.ts`.
**Migration 0050:** `workspace_members.welcome_dismissed_at`; existing members are marked dismissed, so they never see it (26.7).

| Item | Rule | Where |
|---|---|---|
| Get started (7.2, decision 7) | Shows to admins only while nothing real exists (second member, sprint, task, workspace, announcement, document, uploaded file); three action cards, no checklist | `getStartedCards` in `dashboard-rules.ts` |
| Today (33.5, decision 80) | Admins: deadlines today with handed-in counts, sprints ending within 2 days with how many are behind, the Education term-end prompt from 14 days before, then the existing attention rows. Members: their own rows. At most 5, then "Show N more"; "You’re all caught up" when empty | `todayRows` |
| How the class is doing (81) | Admins: on track, behind, inactive (inactive counted from joining, 14 days), each opening Members filtered; the type's word | `classStanding` |
| This week (80, parity bug 7) | Calendar days in the organization's zone, grouped Today, Tomorrow, This week | `weekGroup` |
| Week line (33.5) | "Week 6 of 16" from the term; nothing without one | `weekLine` |
| Welcome panel (26.7, 49, DB4) | Once, after joining: the welcome note, up to 3 Start here rows, Add to your profile; × hides it for good | dashboard read + `dismissWelcomeAction` |
| Restricted notice (29.2) | "This organization is restricted for now." on Overview for everyone inside | `OrgStatusBanner` |
| ✓ on the header (31.8, 70) | Verified organizations show ✓ beside the name | `WorkspaceLayout` title slot |
| Live (32.4, 76) | Overview reloads its own data when the organization's live events arrive, at most every 2 seconds | `OrgDashboard` |

**Moved, my call:** the Close-out list and Term summary (33.8 "High") sit with Archive in step 9; Use again and Export progress with Tasks in step 13.
