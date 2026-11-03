# Step 12 — Sprints

Report: 7.6, 16.2, 17.3, 18.1, 18.2, 28.2, 33.4, 37.2, 42.5, 42.6, 42.18. Decisions 9, 24, 59, 99, 122, 123, 131, 132, 137. Problem 3; smaller bugs 7, 14.
Built in two commits. Every organization rule stays scoped to organizations and their workspaces; shared changes get a normal-workspace test.

## 12a — Server
- `buildSprintSeries`: each sprint ends the day before the next starts (123). `seriesPreview` flags overlaps (blocking, with a Start after fix) and the term end (warning). Numbering continues from the last sprint. Up to 52.
- `planSprintSeriesAction` works in any workspace; the create form calls it when Repeat is on (9).
- Handover (122, problem 3): in the hourly job, an organization sprint due to start completes the ended active one, nothing moved, then starts; admins get the summary. A normal workspace still waits for Complete.
- Sprint summary on complete (33.4): admins hear done of total and missing.
- Edit a running sprint (37.2): name, goal, description and end date; the start stays.
- Move later sprints too (59): later Planning sprints shift by the same days, all or nothing; a clash is named.
- Plan your sprint brings group work (131): the workspace's group copies in its backlog join the new linked sprint.
- Linked sprint dates: the errors name the organization sprint's date ("CO1 ends 15 Nov. Pick an earlier date."). Fix dates pulls a sprint back inside.
- Material search marks Admins-only files (137). Workspaces panel lists unlinked workspaces; Remind leads with the 12-hour rule and an honest count.
- Normal workspace sprints get a database test: create, start, complete with each choice, cancel (42.18 #4).
- Sprint materials on Duplicate (132) were built in step 9c; a test confirms.

## 12b — Screens
- One form: Repeat with How many and a live preview; `Create 5 sprints`; Plan a series button goes. Name suggestion follows the type (bug 14).
- Workspaces in an organization: `Inside CO1 · 1–15 Nov · Change` with a switch, dates inside it, inline errors, Bring group work. Create linked sprint goes (24).
- Empty states with one main button, worded by situation (17.3, 18.2).
- Header by stage: Planning Start now; Running and ended Complete; Edit for running; Archive when completed (37.2).
- Material picker warning; Fix dates; Workspaces panel with Remind.
