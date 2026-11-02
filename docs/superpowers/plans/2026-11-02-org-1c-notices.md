# Deploy 1c — Notices

**Goal:** the 1c items from the master plan (`2026-11-02-organization-end-to-end-implementation.md`, step 1c).
**Tests:** `tests/db/organizations-1c-notices.test.ts` (one per item, written first), `tests/unit/organization-notify-rules.test.ts`.
**DB:** none. Event keys live in code only (`workspace-policy.ts` registry), so `assignments.reminded`, `org.team_changed` and `org.member_deleted` need no migration (41.2 "to confirm": confirmed).

| # | Item | Change | Test |
|---|---|---|---|
| 1 | Two new event types (66) | `assignments.reminded` for every Remind (copies, members, leads); `org.team_changed` for team and group moves | Remind and a team move write their own keys |
| 2 | Remind counts (60, 28.8) | Skip anyone reminded about the same thing in the last 12 hours, read from their tray rows; return `{ reminded, skipped }`; toasts say "Sent to 9. 3 were reminded recently." | Second Remind skips; 13 hours later it sends |
| 3 | Wrong day (74, 32.5) | `formatDueDay(date, zone)`; notices with a date go out once per time zone, using the person's zone, else the organization's | Same Remind reads Sat in India, Fri in UTC |
| 4 | Smaller bug 2 | Reminders Off also stops overdue notices and emails | No overdue notice when Off |
| 5 | Archive notice (93) | An admin archiving a workspace tells its team and lead; every archive gets its own event id | Lead and member told; told again after unarchive |
| 6 | Role wording (39.5) | "Your role in CSE 3B is now TA" | Exact title |
| 7 | Move-in Approve and Decline (57) | Requests list on the Workspaces tab (move in and leave), a Needs your attention row, Decline with optional reason tells the lead | Row shows; decline tells the lead and clears it |
| 8 | Problem 27, and 32's notice | Deleting a main assignment or a copy tells the people who had it, "Lab 3 was removed" | Each person told |
| 9 | Deleted account (174) | Hard delete counts the submissions it removes per organization; each organization's admins get one notice | Admins told with the count, no name |
| 10 | No catch-up (117) | Nothing new fires for old data: overdue still only looks back one day | Old overdue work sends nothing |

**Moved, my call:** 174's roster half ("Deleted user" under Former) needs the Former list, which is built in step 11 (36.4). It goes there.
