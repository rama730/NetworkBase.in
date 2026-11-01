# Reporting, moderation and appeals (v2, locked 2026-10-29)

Version 1 (T1–T15) was locked on 2026-10-29. Version 2 keeps every v1 decision and designs the parts v1 left thin, end to end: what the **reported person** sees, the **emails** they get, how the **appeal** works in every case, and how the **NetworkBase team monitors** all of it. New decisions T16–T25 are marked "new in v2"; all 25 are locked. Part B covers the organization background jobs.

**Contents**
1. Words used in this document
2. What exists and what's set up in production
3. Principles
4. The whole journey at a glance
5. The reporter
6. Cases: how a report becomes work for the team
7. Decisions: what the team can do
8. The reported person, end to end
9. Emails to the reported person
10. Appeals, end to end
11. How the NetworkBase team monitors everything
12. Every scenario and edge case
13. Notices and emails: the full list
14. Data
15. Background jobs for reporting
16. Decisions (T1–T25)
17. The staff console: full design
18. App-wide report UI: audit and fixes
19. Final audit: gaps, conflicts and improvements
20. Build order
- Part B. The organization background jobs

---

## 1. Words used in this document

| Word | Meaning |
|---|---|
| **Report** | One person telling us about one thing (a post, a person, a message and so on) |
| **Case** | Everything about one reported thing: all its reports, the evidence and the decision. Five reports on one post are one case |
| **Case number** | A short reference shown on every notice and email, for example **NB-4821** |
| **Staff** | The NetworkBase team: accounts with the `admin` or `moderator` role in Supabase. Today that's you |
| **Org moderators** | An organization's owner and admins, for content inside their own org |
| **Action** | What staff or org moderators decided: hide, remove, warn, limit and so on |
| **Strike** | A mark on a person's record each time staff take action against them or their content. Expires after 180 days |
| **Restriction** | An account action that's in force: a limit, suspension or ban |
| **Appeal** | The reported person asking us to look again at one action |

---

## 2. What exists and what's set up in production

**Built (P15):**
- Reporting for 5 things: workspace or org, post, post comment, doc, task comment.
- 6 reasons.
- `/admin/reports` with Dismiss, Hide from Discover, Remove content and Suspend org, plus Verified badge requests.

**Production, set up on 2026-10-29:**
- **Staff access:** your account has the `admin` role, and `/admin/reports` opens for you.
- **`EMAIL_LINK_SECRET`** is set on both services.
- **Background jobs:** the worker is synced with Inngest.

**Missing today:**
- Reporting people, messages and 10 more places.
- Evidence snapshots.
- Account actions and strikes.
- Notices to the reported person beyond "removed".
- Appeals.
- Alerts to staff.
- Monitoring.
- An audit log.

---

## 3. Principles

1. **Report from where you see it.** Every piece of someone else's content has Report in its "⋯" menu.
2. **Reports are private both ways.** The reported person never learns who reported them. The reporter never learns what happened to the other person beyond "action taken" or "no rule broken".
3. **You're told only when something changes for you** (new in v2). Being reported changes nothing, so the reported person hears nothing until there's a decision against them. A dismissed report is never mentioned to them.
4. **Every action is explained:** what, which rule, what happens next, and how to appeal.
5. **Every action can be appealed in the app**, once, within a window. The only exception is child-safety removals.
6. **Act on the thing before the person.** Remove a post first; restrict an account only along the ladder.
7. **Evidence is frozen at report time.**
8. **Block is instant, Report is reviewed.**
9. **Everything staff do is logged and measurable.**

---

## 4. The whole journey at a glance

```
REPORTER                     NETWORKBASE TEAM                      REPORTED PERSON
────────                     ────────────────                      ───────────────
Report (+ Also block)  ──►   Case NB-4821 opens
"Thanks, we'll review         (severity, deadline, evidence)        Sees nothing
 within 24 hours"             Urgent → email to staff at once        (unless an Urgent auto-hide:
                              Others → morning summary               "Hidden while we review")
                                      │
                              Staff (or org moderators) decide
                                      │
             ┌────────────────────────┴───────────────────────────┐
         No rule broken                                       Action taken
             │                                                     │
"We reviewed your report:                                 Notice in the app + email,
 no rule broken"                                          the content shows it, banner
                              Reported person:            for account actions,
                              hears nothing               Account standing updated
                                                                   │
                                                          Appeal (within 30 days)
                                                                   │
                              Appeal reviewed within 72 hours ◄────┘
                                      │
                       Upheld · Reduced · Reversed  ──►  Notice + email with the outcome
                                                          (Reversed: everything restored,
                                                           strike removed)
```

---

## 5. The reporter

### 5.1 Where Report appears (T1)

| # | Thing | Where |
|---|---|---|
| 1 | Person | Profile "⋯", people cards (Network, Discover, member drawer, hover card), DM header |
| 2 | Workspace | Workspace header "⋯", workspace card, share preview page |
| 3 | Organization | Org header "⋯", org card, join preview (`/join/<code>`) |
| 4 | Post or announcement | Update card "⋯", Discover update card |
| 5 | Post comment | Comment "⋯" |
| 6 | Doc | Doc tab "⋯" |
| 7 | Task | Task detail "⋯" |
| 8 | Task comment | Comment "⋯" |
| 9 | File | File row and preview "⋯" |
| 10 | Chat message | Message hover "⋯" (DMs, group DMs, channels, threads) |
| 11 | Channel or canvas | Channel details "⋯" |
| 12 | Open role post | Role card "⋯" |
| 13 | Application or join-request note | Applications and Requests rows "⋯" |
| 14 | Connection request or invitation note | Network → Invitations "⋯" |
| 15 | Profile contribution story | Contribution "⋯" |

**Not reportable:**
- Your own things: you can edit or delete them.
- System messages and notifications.

**Outside the app:** someone who isn't signed in sees "Sign in to report". Copyright and legal requests go to **support@networkbase.in** (staff turn these into cases by hand; 11.7).

### 5.2 Reasons (T2)

| Reason | Severity | Decide within |
|---|---|---|
| Threat or self-harm | Urgent | 1 hour |
| Sexual content involving a minor | Urgent | 1 hour |
| Sharing private information | Urgent | 1 hour |
| Harassment or bullying | High | 24 hours |
| Hate speech | High | 24 hours |
| Impersonation (person, workspace, org) | High | 24 hours |
| Scam or fraud (person, message, role post, workspace) | High | 24 hours |
| Inappropriate content | Normal | 72 hours |
| Spam | Normal | 72 hours |
| Other | Normal | 72 hours |

### 5.3 The dialog and after

1. **Report <name / this post>:** reasons with a one-line hint each, plus Details (optional, 2,000 characters).
2. **Person or message:** "Also block <name>". It's ticked by default for Harassment, Threat and Private information (T3).
3. **Message:** "We'll include this message and the 5 before it." This is only ever the reporter's own conversation (T4).
4. **Urgent reasons:** "If someone is in immediate danger, contact local emergency services (112 in India)."
5. **Sent:** "Thanks. We'll review this within <1 hour / 24 hours / 72 hours, by the reason> and let you know. Case NB-4821." If they also blocked: "You've also blocked <name>."
6. **Outcome notice** (tray only, T5): "We reviewed your report about a post in CSE-3A and took action" or "…and didn't find a rule break. You can block or mute them."
7. **Settings → Privacy → Your reports:** the last 90 days, each with its case number and status: In review · Action taken · No rule broken.

**Reporter scenarios:**
- **Same thing again while it's open:** "You've already reported this. Case NB-4821 is in review."
- **Something already decided:** a new report opens a new case, marked "reported again after a decision".
- **The thing disappears before review:** the case continues on the snapshot.
- **Reporting someone who blocked you:** you can't see their content, so there's nothing to report from. Use what you can still see (your messages history).
- **20 reports an hour:** "Too many reports. Try again later."

---

## 6. Cases: how a report becomes work for the team

1. **Grouping:** every report on the same thing joins one case. The case shows how many people reported it and which reasons.
2. **Severity:** the highest reason in the case. A case's severity only goes up.
3. **Deadline:** from the first report: 1 h, 24 h or 72 h by severity.
4. **Routing (T6):**

| What was reported | Goes to |
|---|---|
| Posts, comments, docs, tasks, files or channel messages inside an organization | **Org moderators** first; staff see it too |
| Anything about the org's own owner or admins | Staff only |
| Direct messages, people, workspaces, orgs, role posts, invitations, notes | Staff only |
| Content in workspaces outside any org | Staff only |
| Urgent reasons | **Staff only, always** (org moderators are told nothing) |

5. **Hand-off:** an org case that's still open at its deadline moves to staff, and the org moderators see "Passed to NetworkBase".
6. **Auto-hide (T10):** only for Urgent reports on a message or comment, after 2 independent reporters. Independent means not connected to each other and with accounts older than 7 days. The content shows "Hidden while we review" until staff decide.
7. **Pile-on flag:** 5 or more reports within an hour, mostly from new or connected accounts, adds "Possible pile-on".
8. **Claim:** a staff member clicks **I'm reviewing**, so two people don't act on the same case.

**Case states:** `Open` → `In review` (claimed) → `Decided` (No rule broken / Action taken) → `Appealed` → `Final`.

---

## 7. Decisions: what the team can do

**Every decision needs:**
- the rule broken, as a guideline section (e.g. "§2 Harassment");
- a message to the person, from a ready-made text for the rule that staff can edit.

**Every decision except No rule broken:**
- adds a strike (except org-moderator actions; see 7.4);
- opens the 30-day appeal window.

### 7.1 Content (post, comment, doc, task, file, message, channel, role post, note, story)

| Action | Author sees | Others see | Reversible |
|---|---|---|---|
| No rule broken | Nothing | Nothing | — |
| **Hide** | The content in place with "Hidden by NetworkBase · §2 Harassment · Appeal" | "This post was hidden" | Yes |
| **Remove** | A grey row: "Your post was removed · §2 Harassment · Appeal" | Nothing | Yes, within 30 days (kept in the background for the appeal window, then deleted) |

### 7.2 Workspaces and organizations

| Action | Owner sees | Members see | Visitors see |
|---|---|---|---|
| **Hide from Discover** | Banner: "Hidden from Discover · §4 Spam · Appeal" | Nothing | Not in Discover or search; links still work |
| **Restrict** | Banner: "Restricted: private only, no new invites · Appeal" | "This workspace is restricted for now" | Not visible |
| **Suspend** | Banner: "Suspended: read-only · reason · Appeal" | "This workspace is suspended. Everything is read-only." **No reason** (the reason is the owner's) | Not visible |
| **Remove** | Banner: "Will be deleted on Dec 1 · reason · Appeal" | "This workspace will be deleted on Dec 1" | Not visible |

### 7.3 People: the ladder (T9, staff only)

| Step | What changes | Length |
|---|---|---|
| **Warning** | Nothing is blocked; it's on the record | — |
| **Limit** | Can't message people they aren't connected to, post or comment outside their own workspaces, invite, apply, or create workspaces or orgs. Everything else works | 7 or 30 days |
| **Suspension** | Can sign in only to see the reason, appeal and download their data. Profile: "This account is suspended" | 30 days, or until reviewed |
| **Ban** | Same as suspension, but permanent. Profile hidden; their posts and comments show "Removed user"; owned workspaces and orgs pass on by the succession rules | Permanent |

**How the ladder is used:**
- **Suggested step:** 1 strike → Warning, 2 → 7-day Limit, 3 → 30-day Limit, 4 → Suspension. The reviewer decides.
- **Skipping steps:** Urgent reasons can skip to Suspension, and child safety to Ban.

### 7.4 Org moderators' actions (new in v2)

- Org moderators can **Hide or Remove content** and **Warn the author** inside their org. They **can't** restrict accounts.
- Their actions **don't add NetworkBase strikes**, because org rules differ from platform rules.
- **Repeats:** 3 org removals for the same person within 30 days automatically open a staff case, "Repeated removals in CSE-3A".
- The author can appeal an org removal **to NetworkBase**.
- **If staff reverse an org removal:** the content comes back, and the org moderators are told "NetworkBase restored a post you removed (NB-4821)".

---

## 8. The reported person, end to end

### 8.1 While the report is open

- **Normally: nothing.** They don't know they were reported, and nothing changes. This avoids retaliation and anxiety over reports that come to nothing (T16, new in v2).
- **Exception, Urgent auto-hide:** their message or comment shows "Hidden while we review · We'll decide within 1 hour." There's no Appeal yet, because no decision exists. A tray notice says the same.

### 8.2 If no rule was broken

- **Nothing**, ever. If an auto-hide happened, the content comes back with the tray notice "Your comment is visible again; we found no rule break."

### 8.3 If action was taken: the 6 places they find out

| # | Where | What it shows | For |
|---|---|---|---|
| 1 | **Tray notice** | "We removed your post in CSE-3A · §2 Harassment · NB-4821 · Appeal" | Every action |
| 2 | **Email** from notifications@ | Section 9 | Every staff action; org-moderator actions only in the tray |
| 3 | **On the content itself** | The hidden or removed row with Appeal | Content actions |
| 4 | **Banner at the top of every page** | Section 8.4 | Limits, suspensions, bans, and the owner of a restricted, suspended or removed workspace or org |
| 5 | **Sign-in screen** | Section 8.6 | Suspension and ban |
| 6 | **Settings → Account → Standing** | Section 8.5 | Everything, always |

### 8.4 The banner (account and workspace actions)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ⚠ Your account is limited until 12 Nov: you can't message people you        │
│   aren't connected to or post outside your workspaces.  Why? · Appeal  · ✕ │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **Why?** opens Account standing at that action.
- **✕** hides the banner for the day; it comes back the next day until the restriction ends.
- **Appeal sent:** the banner reads "Appeal sent · We'll decide by 4 Nov".
- **Blocked actions:** when a limited person tries something blocked, the button itself explains: "You can't message people you aren't connected to until 12 Nov. Why?"

### 8.5 Settings → Account → Standing (a subsection, C18)

```
Account standing
────────────────
Your account is in good standing.                 ← or: "Limited until 12 Nov"

Active
  Limit · until 12 Nov · §2 Harassment · NB-4821              [Appeal]

Strikes (2 active)
  §2 Harassment · removed post in CSE-3A · 30 Oct · expires 28 Apr     NB-4821
  §4 Spam · hidden comment · 2 Sep · expires 1 Mar                       NB-4410

Appeals
  NB-4410 · Reversed on 5 Sep · comment restored, strike removed

History
  Everything above, plus expired strikes and ended limits (24 months)

Questions? Read the Community guidelines · Email support@networkbase.in (mention the case number)
```

- **Appeal button states:**
  - **[Appeal]:** the window is open.
  - **Appeal sent · decision by 4 Nov:** pending.
  - **Appeal closed:** after 30 days, with "Questions? support@".
  - **Can't be appealed:** child safety.
- **Good standing:** with nothing active, the page says "Your account is in good standing" and lists only past history.

### 8.6 Suspended or banned: signing in

```
Your account is suspended until 29 Nov          (or: "Your account is banned")
Reason: §2 Harassment · NB-4821
We sent the details to n***@gmail.com.

[ Appeal ]   [ Download your data ]   [ Sign out ]
```

- Nothing else in the app opens.
- **Pending appeal:** "Appeal sent · decision by 2 Nov".
- **Banned, no appeal left:** only Download your data and Sign out.

### 8.7 Workspace and org members (not the owner)

- **Suspended or removed:** members see the read-only notice from 7.2, without the reason.
- **Hidden or restricted:** members see nothing, or "restricted for now".
- Members get no email; the owner handles it.
- **Removed workspace:** members get the existing deletion notice (E14) with the date.

---

## 9. Emails to the reported person (new in v2)

### 9.1 Rules for every email

| Rule | Detail |
|---|---|
| **From** | `NetworkBase <notifications@networkbase.in>`, the same sender as every app email |
| **Reply-To** | `support@networkbase.in`. A reply reaches the team with the case number in the subject |
| **Always sent** | Account actions and their outcomes ignore email preferences and org mutes, like other access emails |
| **Subject** | Plain and calm, with the case number: "Your post was removed [NB-4821]" |
| **Never contains** | Who reported, how many people reported, reviewer names, or the reported content itself (it may be harmful). It names the thing and links to it |
| **Always contains** | What happened, the rule with a link to the guideline, what changes and until when, what happens next time, the **Appeal** button (or why there's none), and the appeal deadline |
| **Appeal button** | Opens the appeal form directly after sign-in. A suspended or banned person gets the limited sign-in screen (8.6) with the form |
| **Look** | The shared email shell that today's Welcome and Task emails use |

### 9.2 The emails

| # | When | Subject |
|---|---|---|
| M1 | Staff hid or removed your content | Your post was removed [NB-4821] |
| M2 | Warning | A warning about your account [NB-4821] |
| M3 | Limit starts | Your account is limited until 12 Nov [NB-4821] |
| M4 | Limit or suspension ends tomorrow | Your account restriction ends tomorrow |
| M5 | Limit or suspension ended | Your account is back to normal |
| M6 | Suspension | Your account is suspended [NB-4821] |
| M7 | Ban | Your account has been banned [NB-4821] |
| M8 | Workspace or org hidden, restricted, suspended or removed (to the owner) | CSE-3A is suspended [NB-4821] |
| M9 | Appeal received | We got your appeal [NB-4821] |
| M10 | Appeal decided: Upheld | Your appeal was reviewed [NB-4821] |
| M11 | Appeal decided: Reduced or Reversed | Good news about your appeal [NB-4821] |

**Not emailed** (tray only):
- org-moderator actions;
- the Urgent auto-hide and its release.

### 9.3 Example: M3, limit

```
Subject: Your account is limited until 12 Nov [NB-4821]

Hi Asha,

We reviewed a report about a comment you posted in Team Falcon on 29 Oct and found it
broke our Community guidelines, §2 Harassment.

What changes until 12 Nov:
  • You can't message people you aren't connected to
  • You can't post or comment outside your own workspaces
  • You can still use your workspaces, finish your work and talk to your connections

This is your second strike in 6 months. Another one may lead to a longer limit.

[ Appeal this decision ]        You can appeal until 28 Nov.

Read §2 Harassment · See your account standing
Reply to this email if you have a question. Mention NB-4821.
```

### 9.4 Example: M11, appeal reversed

```
Subject: Good news about your appeal [NB-4821]

Hi Asha,

We looked again at the limit on your account and reversed it. Your comment is visible
again, the strike is removed and your account is back to normal. We're sorry for the trouble.

See your account standing
```

### 9.5 When the person replies to an email

- The reply lands in the **support@** inbox, with `[NB-4821]` in the subject.
- Staff type NB-4821 in the console search to open the case and its history.
- **To appeal:** staff answer with the appeal link. Appeals happen only in the app, so every one has a record and a deadline.
- **To report something new:** staff open a manual case (11.7).

---

## 10. Appeals, end to end

### 10.1 What can be appealed

| Action | Can appeal? | Window |
|---|---|---|
| Hide, Remove (staff) | Yes | 30 days |
| Hide, Remove, Warn (org moderators) | Yes, **to NetworkBase** | 30 days |
| Warning | Yes, to remove the strike | 30 days |
| Limit | Yes, even after it ended (removes the strike from the record) | 30 days |
| Suspension | Yes | 30 days |
| Ban | Yes, once | 60 days |
| Workspace or org action (owner only) | Yes | 30 days (Remove: until the deletion date) |
| Child-safety removal or ban | **No.** Shown as "This decision can't be appealed" | — |
| "No rule broken" (the reporter disagrees) | No appeal; they can report again with new details | — |

### 10.2 Where the Appeal button appears

| # | Place | Who |
|---|---|---|
| 1 | The tray notice | Everyone with an action |
| 2 | The email (M1–M8) | Staff actions |
| 3 | On the hidden or removed content | The author |
| 4 | The banner | Account restrictions, and owners of affected workspaces and orgs |
| 5 | Settings → Account → Standing, on each action | Always |
| 6 | The suspended or banned sign-in screen | Suspended and banned people |
| 7 | The workspace or org settings page ("Standing" row) | Owners of an affected workspace or org |

All seven open the same form.

### 10.3 The form

```
Appeal NB-4821
──────────────
What happened:  Limit until 12 Nov · §2 Harassment · a comment in Team Falcon on 29 Oct

Why should we look again?  (required, up to 1,000 characters)
┌────────────────────────────────────────────────────────────┐
│                                                            │
└────────────────────────────────────────────────────────────┘
☐ I've changed or removed the content          (workspace and org actions only)

You get one appeal for this decision. We'll reply by 2 Nov.
Your restriction stays in place while we review.

                                          [ Cancel ]  [ Send appeal ]
```

- **After Send:** "Appeal sent. We'll decide by 2 Nov and email you." Email M9 follows.
- **Withdraw:** possible from Account standing until a reviewer claims the appeal.

### 10.4 While the appeal is pending

- **Restrictions stay**, and hidden or removed content stays hidden.
- **Exception:** a workspace or org scheduled for **removal** never gets deleted while its appeal is open. The deletion date waits for the decision.
- The banner, Account standing and sign-in screen show "Appeal sent · decision by <date>".

### 10.5 Who decides and how

1. **Queue:** the appeal enters the console's **Appeals** tab with a 72-hour deadline.
2. **Reviewer:** someone other than the person who made the decision (T11).
   - **While you are the only staff member** (T22, new in v2), you can review your own decision. The console shows "You made this decision" and requires a fresh note explaining the second look.
3. **What the reviewer sees:** the original case, the evidence, the appeal text and the person's history.
4. **Outcomes:**

| Outcome | What happens | The person gets |
|---|---|---|
| **Upheld** | Nothing changes | M10 with a short reason; "This was your one appeal for NB-4821" |
| **Reduced** (new in v2) | A lighter action replaces it: ban → suspension, 30-day → 7-day limit, remove → hide. The strike stays | M11 with what changed |
| **Reversed** | Everything is undone: content restored, strike removed, restriction lifted, workspace or org restored, attribution back after a ban | M11 and a tray notice |

### 10.6 After the appeal

- **No second appeal.** Account standing shows "Appeal decided" plus "Questions? support@ (NB-4821)".
- **Staff can still reverse any action themselves at any time**, for example after a support email with new facts. That's logged as a reversal, not an appeal.
- **The reporter isn't told** about appeals. Their "Your reports" status stays as it was.
- **Org moderators** are told when NetworkBase reverses their removal (7.4).

### 10.7 Appeal scenarios

| Scenario | What happens |
|---|---|
| The appeal window closes | Appeal buttons become "Appeal closed" |
| The person deletes their account during an appeal | The appeal closes as Withdrawn |
| The restriction ends before the decision | Still decided; Reversed removes the strike |
| Two actions from one case (removed post and a limit) | One appeal covers both; outcomes can differ per action |
| Several cases at once | One appeal per case |
| Abusive or spam appeal text | Closed as Upheld with "We couldn't consider this appeal"; that counts as the one appeal |
| Appeal about an org-moderator removal | Staff decide. Reversed restores the content and tells the org moderators. Upheld: nothing changes |
| Appeal by a workspace owner who has fixed the problem (ticked the box) | The reviewer checks the fix; usually Reduced or Reversed |

---

## 11. How the NetworkBase team monitors everything

### 11.1 Where staff look

| Channel | What arrives | When |
|---|---|---|
| **Urgent email** | "Urgent report: Threat · message · NB-4821 · Review now", to every staff account | At once |
| **Second urgent email** | "Still unclaimed after 30 minutes" | 30 minutes later, if nobody clicked I'm reviewing |
| **Morning summary email** | New, open and overdue cases by severity, pending appeals, and the 5 oldest items, each linked | 8 am IST daily |
| **Weekly health email** | The health numbers in 11.4 | Monday 8 am IST |
| **The console `/admin/trust`** | Where all work happens | Any time |
| **support@ inbox** | Replies to M-emails and outside requests | As they come |

Staff accounts get these by having the role. There's nothing to configure (T15).

### 11.2 The console

| Tab | What staff do there |
|---|---|
| **Queue** | Cases sorted by severity, then deadline. Filters: severity, kind, org, Overdue, Pile-on, Unclaimed. **I'm reviewing** claims a case |
| **Case view** | Live content and the snapshot side by side; every report (reporters visible to staff only); the author's strikes and history; other open cases on the same person; the suggested ladder step; the decision form (action, rule, editable message); internal notes |
| **Appeals** | Pending appeals by deadline, with the case attached. Upheld / Reduced / Reversed with a required note |
| **People** | Search by name, @handle, email or case number: standing, strikes, actions, appeals, reports they made and their accuracy. Act on the account directly (manual Warning, Limit and so on) |
| **Health** | 11.4 |
| **Verification** | Verified badge requests (moved from today's page) |
| **Audit log** | Every action, reversal, claim and note by every staff member: who, when, what, rule, note. Filter and export |

### 11.3 Deadlines and escalation

| Situation | What happens |
|---|---|
| Urgent case unclaimed for 30 minutes | Second email to all staff |
| Any case past its deadline | Red "Overdue" in the queue; listed first in the morning summary |
| Org case past its deadline | Passes to staff (6.5) |
| Appeal past 72 hours | Red in the Appeals tab; in the morning summary |
| Appeal still pending 7 days after its deadline | The restriction is **paused** until decided. A person isn't held for our delay |

### 11.4 Health numbers

| Number | Why it matters |
|---|---|
| Open cases by severity, and overdue cases | Are we keeping up? |
| Median time to decision, by severity | Are we meeting 1 h / 24 h / 72 h? |
| Actions by type this week | What's happening on the platform |
| Top reasons, top reported workspaces and orgs | Where problems cluster |
| **Appeal rate** and **reversal rate** | If many decisions are reversed, decisions are too harsh or unclear |
| People with 3+ active strikes | Repeat offenders to watch |
| Pile-on flags | Possible abuse of reporting |
| Reports with no rule broken, by reporter | False or careless reporters |

### 11.5 Quality

- **Second staff member:** once there is one, 5% of decisions are sampled into a "Second look" list each week.
- **Fixing a mistake:** staff reverse it themselves, and the person gets M11 with an apology line.

### 11.6 Org moderators' side

- **Members tab → Reports:** org cases, with Dismiss / Hide / Remove / Warn author.
- **Needs you row:** "2 reports to review".
- **Daily digest:** org cases appear in the admin digest email (E9).
- **They never see:** reporters' names, Urgent cases, DMs, or cases about themselves.
- **Hand-off:** at the deadline, an open case passes to staff.

### 11.7 Manual cases (new in v2)

- Staff can open a case by hand from **People** or **Queue → New case**, for:
  - emails to support@, including copyright and legal requests;
  - things staff notice themselves;
  - requests from the authorities.
- The source is recorded as "Email", "Staff" or "Legal".
- **Legal hold:** a case can be marked Legal hold. Its evidence is kept until the hold is released, and it's never deleted by retention.

---

## 12. Every scenario and edge case

| # | Scenario | What happens |
|---|---|---|
| 1 | The reported person deletes the content before review | The case continues on the snapshot. An action still adds a strike; the notice says "a post you deleted" |
| 2 | The reported person deletes their account | The case closes as "Account deleted"; evidence follows retention |
| 3 | The reporter deletes their account | The report stays without a name; the case continues |
| 4 | The reported person is staff | The case goes to another staff member. If none exists, it's marked "About staff" and listed in the weekly health email |
| 5 | The reported person is the owner or an admin of the org where it happened | Staff only, never the org's own moderators |
| 6 | The content is in a private workspace the reporter belongs to | Normal; staff can see it for the case |
| 7 | A DM is reported | Staff see only the snapshot (the message and 5 before it). They can't browse the rest of the conversation |
| 8 | Many reports on one thing | One case with a count; the severity is the highest reason |
| 9 | A pile-on | Flagged; no auto-hide; the reviewer judges the content itself |
| 10 | Content already hidden is reported again | It joins the decided case's history; no new case unless 30+ days have passed |
| 11 | A limited person tries something blocked | The control explains why and until when (8.4) |
| 12 | A limited person's own workspace | Works normally; the limit is about reaching others |
| 13 | A suspended person owns workspaces | Members keep working; the owner is read-only. After 30 days of suspension, staff can hand ownership on by the succession rules |
| 14 | A banned person owns workspaces or orgs | Ownership passes on by the succession rules at the ban |
| 15 | A ban is reversed | Profile and attribution come back. Ownership doesn't automatically return; the new owner can hand it back |
| 16 | A Remove (workspace or org) is appealed | Deletion waits until the decision |
| 17 | The same person is reported from many places | Each thing is its own case. The People tab shows them together, and the suggested step counts all active strikes |
| 18 | Strikes expire | They leave Active and stay in History (24 months), and no longer count toward the ladder |
| 19 | Someone reports staff decisions as unfair | That's what appeals are for. Reports about reviewers go to support@ |
| 20 | False reports | "Reports with no rule broken" in Health; staff can warn or limit the reporter, which counts as a Spam strike |
| 21 | Retaliation (the reported person reports their reporter) | Allowed, since they don't know who reported them. Each report is judged on its own |
| 22 | The person is under 18 or vulnerable | Urgent self-harm cases show staff a helpline list. The person gets a supportive message, not a penalty, unless they harmed others |
| 23 | An email bounces | The tray, banner and Account standing still carry everything; staff see "email bounced" on the case |
| 24 | Staff act on something org moderators already decided | The staff decision wins, and the org moderators are told |
| 25 | An org is suspended by staff | The existing suspension rules apply; the owner gets M8 and the members' read-only notice |
| 26 | A report concerns content that broke the law (child safety) | Removed at once, evidence on Legal hold, no appeal, reported to the authorities as the law requires; staff use Legal hold (11.7) |

---

## 13. Notices and emails: the full list

| Event | Who | Tray | Email | Banner / screen |
|---|---|---|---|---|
| Report sent | Reporter | Confirmation on screen | — | — |
| Report decided | Reporter | Yes | — | — |
| Urgent auto-hide, and its release | Author | Yes | — | On the content |
| Content hidden or removed by staff | Author | Yes | M1 | On the content |
| Content hidden, removed or warned by org moderators | Author | Yes | — | On the content |
| Warning | Person | Yes | M2 | — |
| Limit, suspension, ban | Person | Yes | M3 / M6 / M7 (always sent) | Banner / sign-in screen |
| Restriction ends tomorrow | Person | Yes | M4 | — |
| Restriction ended | Person | Yes | M5 | Banner goes away |
| Workspace or org action | Owner | Yes | M8 | Owner banner; members' read-only notice |
| Appeal received | Person | Yes | M9 | "Appeal sent" everywhere |
| Appeal decided | Person | Yes | M10 / M11 | Updated everywhere |
| Staff reversed an org moderator's removal | Org moderators | Yes | — | — |
| Urgent report | Staff | — | At once, plus a 30-minute reminder | — |
| Daily summary | Staff | — | 8 am IST | — |
| Weekly health | Staff | — | Monday 8 am IST | — |
| Org case waiting | Org moderators | Needs you | In the E9 digest | — |

---

## 14. Data

| Table | Purpose |
|---|---|
| `content_reports` (extend) | New target kinds and reasons, `severity`, `snapshot`, `case_id` |
| **`moderation_cases`** | Case number, target, org id, severity, source (Report / Email / Staff / Legal), state, assignee, deadline, decision, Legal hold |
| **`moderation_actions`** | The audit log: case, actor, kind (content / workspace / org / account), action, rule, message, strike yes/no, `appeal_until`, reversed when and by whom |
| **`account_restrictions`** | Person, kind (warning / limit / suspension / ban), starts, ends, paused, action id. Checked in every write path and by the database guards |
| **`moderation_appeals`** | Action(s), person, text, fixed-it box, state (pending / claimed / upheld / reduced / reversed / withdrawn), reviewer, note, decided at |

- All five tables are server-only, with no browser access.
- The reported person's own view (Account standing) is read through server code, never directly from the tables.

---

## 15. Background jobs for reporting

| Job | When | Does |
|---|---|---|
| `trust-urgent-alert` | On every Urgent report | Emails all staff; sends the 30-minute reminder if unclaimed |
| `trust-deadlines` | Every 15 minutes | Hands overdue org cases to staff; marks cases and appeals overdue; pauses restrictions whose appeal is 7 days overdue |
| `trust-restrictions` | Hourly | Sends M4 a day before a restriction ends; ends restrictions on time and sends M5 |
| `trust-daily-summary` | Hourly, sends at 8 am IST | The morning email to staff |
| `trust-weekly-health` | Mondays 8 am IST | The health email |
| `trust-strikes-expire` | Daily | Moves strikes older than 180 days to History |
| `trust-retention` | Daily | Deletes dismissed reports and snapshots after 90 days and actioned ones after 2 years, except Legal hold; deletes removed content once its appeal window has closed |

After deploy, the worker needs one Inngest re-sync so these jobs are registered (Part B).

---

## 16. Decisions (T1–T25)

All 25 decisions are locked (T1–T15 and T16–T25, both on 2026-10-29).

| # | Topic | Decision |
|---|---|---|
| T1 | What can be reported | The 15 things in 5.1 |
| T2 | Reasons | The 10 in 5.2, with deadlines of 1 h / 24 h / 72 h |
| T3 | Block with report | "Also block" for people and messages, ticked by default for Harassment, Threat and Private information |
| T4 | Evidence | Snapshot at report time; messages include the 5 before them |
| T5 | Reporter feedback | Tray outcome plus "Your reports"; never details about the other person |
| T6 | Org moderation | Org moderators handle content inside their org; staff take over when overdue, Urgent, DMs, people, or about the org's admins |
| T7 | Content actions | Hide, Remove |
| T8 | Workspace and org actions | Hide from Discover, Restrict, Suspend, Remove with 30-day grace |
| T9 | Account ladder | Warning → Limit (7 / 30 days) → Suspension → Ban; strikes last 180 days; suggested, not automatic |
| T10 | Auto-hide | Only Urgent message and comment reports, after 2 independent reporters |
| T11 | Appeals | One per action, by someone other than the decider, within 72 hours; none for child safety |
| T12 | Console | `/admin/trust` with a `moderator` role |
| T13 | Guidelines | A numbered Community guidelines page |
| T14 | Retention | Dismissed 90 days; actioned 2 years; Legal hold until released |
| T15 | Staff and alerts | Staff are `admin` and `moderator` accounts; urgent emails at once plus a morning summary |
| **T16** | Telling the reported person | **Only when a decision affects them.** Dismissed reports are never mentioned; the Urgent auto-hide is the one exception (8.1) |
| **T17** | Case number and replies | Every notice and email carries a case number (NB-4821); emails come from notifications@ with **Reply-To support@** (9.1, 9.5) |
| **T18** | Content emails | Staff content actions email the author (M1); org-moderator actions are tray-only |
| **T19** | Org-moderator actions and strikes | No NetworkBase strike; 3 org removals in 30 days open a staff case; authors appeal them to NetworkBase (7.4) |
| **T20** | Account standing and banner | A Standing subsection under Settings → Account (C18) with Active, Strikes, Appeals and History; a dismissible-for-a-day banner while a restriction lasts; a limited sign-in screen for suspended and banned people (8.4–8.6) |
| **T21** | Appeal windows and placement | 30 days (ban 60, workspace removal until the deletion date); the Appeal button in the 7 places of 10.2; deletion waits during an appeal |
| **T22** | Appeal outcomes | Upheld, **Reduced** or Reversed; restrictions stay while pending, but **pause if the appeal is 7 days overdue**; self-review allowed with a note while you're the only staff member |
| **T23** | Emails | The 11 emails in 9.2, always sent for account actions, never naming reporters or showing the content |
| **T24** | Monitoring | The 30-minute urgent reminder, the weekly health email and the Health tab (11.1–11.4) |
| **T25** | Manual cases and Legal hold | Staff can open cases from support@ emails and their own findings; Legal hold keeps evidence past retention (11.7) |

---

## 17. The staff console: full design (C1–C14, locked 2026-10-29)

`/admin/reports` today is a single 896px column outside the app shell. It has 3 plain lists, outlined buttons only, a browser `prompt()` for the suspension reason, and a generic "Done." message. This section replaces it with the console the decisions above need, built only from the design specification's existing parts: tokens, type roles, buttons, badges, tabs, tables, dialogs, the empty-state panel and the state matrix. Nothing in it is a new visual language.

### 17.1 Where it lives and how staff get there

| Item | Design |
|---|---|
| **Address** | `/admin/trust`, with deep links: `/admin/trust/cases/NB-4821`, `/admin/trust/appeals/NB-4821`, `/admin/trust/people/@handle`. `/admin/reports` redirects to `/admin/trust` |
| **Shell** | Inside the normal app shell (sidebar and top bar), like every other page. Today's page has no shell and no way back |
| **Entry point** | For staff only: **Trust & safety** in the avatar menu above Settings, with a mono count of open Urgent and overdue items (e.g. `2`). Also ⌘K "Trust & safety" and "Case NB-…". Ordinary users never see an entry (spec §26) |
| **Who sees it** | `admin` and `moderator` roles. Anyone else gets the standard 404, as today |
| **Moderators** | See everything. Actions only admins can take (Ban, Remove workspace or org) show disabled with the reason "Admins only" |

### 17.2 Page frame

```
┌ App sidebar ┐┌──────────────────────────────────────────────────────────────────────────┐
│             ││ Trust & safety                                         [ New case ]       │  ← page title 30px; secondary button
│             ││ 3 open · 1 urgent · 0 overdue · 2 appeals · Updated 2 min ago             │  ← mono metadata line
│             ││ ──────────────────────────────────────────────────────────────────────── │
│             ││ Queue 3   Appeals 2   Active 4   People   Verification 1   Health   Audit log │  ← underlined tabs, mono counts
│             ││ ──────────────────────────────────────────────────────────────────────── │
│             ││  (tab content)                                                            │
└─────────────┘└──────────────────────────────────────────────────────────────────────────┘
```

- **Tabs:** the standard tab bar: 13px labels, 12px mono counts, 2px clay underline, arrow-key navigation. Each tab has its own URL (`?tab=appeals`). It opens on **Queue**.
- **Freshness:** the line updates every minute without announcing ("Updated just now"). A new Urgent case adds an ink toast: "New urgent case NB-4830 · Open".
- **Width:** tables and the queue use the full content width (wide-workspace rule). Forms inside a case cap at 64ch.

### 17.3 Queue tab

**Layout:**
- **Wide screens (≥1280px):** a split view, like Messages. The case list on the left (440px), the open case on the right.
- **Narrow screens:** the list, and a case opens as its own page with Back.

**Toolbar** (34px controls):
- **Search:** "Search case number, name or @handle".
- **Views:** a segmented row: **Needs action** (default: open and in review) · **Mine** · **Org cases** · **Decided**.
- **Filters** (tags, ink-filled when selected): Severity · Kind · Source (Report / Email / Staff / Legal) · Org · **Overdue** · **Pile-on** · **Unclaimed**.
- **Sort:** Deadline (default) · Newest · Most reported.
- **Selected filters** show as a summary with **Clear filters**.

**Case row** (64px identity row, hairline separators, no card around each row):
```
[URGENT]  NB-4821 · Threat or self-harm · 2 reports                     due in 42m
          Message from Asha Rao in a DM                         ◉ Rao reviewing
```
| Part | Rule |
|---|---|
| Severity badge | Badge role: **URGENT** red-soft, **HIGH** amber-soft, **NORMAL** neutral. Never the only signal; the reason is written out |
| Case number | JetBrains Mono 12px |
| Title | "<Kind> by/from <name> in <place>", 13px medium, one line, full text in the title attribute |
| Deadline | Mono, right-aligned. "due in 42m", then amber below 25% of the time left, then red "overdue 3h" with the word, not just the color |
| Claim | A 20px avatar and "Rao reviewing", or nothing |
| Pile-on | An amber dot badge "PILE-ON" in the second line |
| Selected row | Paper well plus `aria-current`; no colored left border (spec §5) |

**Empty states** (the dashed blueprint panel):
- **No open cases:** "No open cases" · "New reports appear here. Urgent ones also email you." No button.
- **Nothing matches the filters:** "No cases match these filters" plus **Clear filters**.

### 17.4 The case view

```
NB-4821  [URGENT] [IN REVIEW]                         [ I'm reviewing ]  ⋯
Message from Asha Rao in a DM with Kiran                       ← section title 20px
Opened 31 Oct, 10:02 IST · due 11:02 IST · 2 reports · Source: Report
──────────────────────────────────────────────────────────────────────────────────────────────────
┌ Main (flexible) ───────────────────────────────────────┐ ┌ Rail 320px ───────────────────────┐
│ EVIDENCE        As reported · Live now (Deleted)        │ │ PERSON                             │
│ ┌ sunken well ───────────────────────────────────────┐ │ │ [48] Asha Rao  @asha               │
│ │ 09:58  Kiran: …                                     │ │ │ Joined Mar 2026 · 2 active strikes │
│ │ 09:59  Asha:  (reported message, clay left mark)    │ │ │ [LIMITED] until 12 Nov             │
│ │ ⚠ Sensitive content hidden · Show                   │ │ │ Open in People →                   │
│ └────────────────────────────────────────────────────┘ │ ├───────────────────────────────────┤
│ REPORTS (2)                                             │ │ OTHER OPEN CASES ON ASHA (1)       │
│  Threat or self-harm · Kiran · 10:02                    │ │ NB-4810 · Spam · post · due 2d     │
│  "She said she would…"                                  │ ├───────────────────────────────────┤
│  Reporter accuracy 7 of 8 actioned                      │ │ WHERE                              │
│ DECISION                                                │ │ DM · no workspace                  │
│  (decision form, 17.5)                                  │ ├───────────────────────────────────┤
│ INTERNAL NOTES                                          │ │ CASE HISTORY                       │
│  Add a note visible to staff only                       │ │ 10:02 opened · 10:05 Rao claimed   │
└────────────────────────────────────────────────────────┘ └───────────────────────────────────┘
```

**Evidence:**
- **Two views:** "As reported" (the snapshot) and "Live now", with a badge: Unchanged · **Edited** · **Deleted**.
- **Message context:** shown in a sunken well; the reported message carries a clay mark and the label "Reported".
- **Staff wellbeing:** images, files and text flagged sexual, violent or self-harm are blurred behind "Sensitive content hidden · **Show**". Each Show is logged.
- **Files:** name, type, size (mono) and **Open preview**. A file is never auto-downloaded.

**Reports:** each report is a row: reason, details as a quote, the reporter (visible to staff only, with **Reporter accuracy** in mono), and the time. A **Pile-on** case gets an amber notice above the list explaining why it was flagged.

**Rail:** the person card uses the shared person-card anatomy, compact. Below it: other open cases on the same person, Where (workspace or org mini-card, or "DM"), and case history (opened, claimed, decided, appealed, reversed, each with time and staff name).

**Header actions:**
- **I'm reviewing:** the primary button while the case is unclaimed.
- **"⋯" menu:** Release claim · Copy case link · Add to Legal hold · Change severity (with a reason).
- **Claimed by someone else:** the header shows "Rao is reviewing" and the decision form is read-only, with **Take over** in the menu (logged).

### 17.5 The decision form

One form, inside the case. It's the only place decisions are made.

```
DECISION
( ) No rule broken
(•) Take action

Content       [x] Remove message          [ ] Hide instead
Account       ( ) None  ( ) Warning  (•) Limit 7 days  ( ) Limit 30 days  ( ) Suspend  ( ) Ban
              Suggested: Limit 7 days · 2 active strikes
Rule          [ §2 Harassment ▾ ]
Message to Asha   (pre-filled for the rule; editable)        Preview email
┌──────────────────────────────────────────────────────────────┐
│ We removed a message you sent on 31 Oct because it broke …   │
└──────────────────────────────────────────────────────────────┘
Internal note (staff only)  [                                   ]

Asha gets a notice and email M3 · Strike 3 · Can appeal until 30 Nov · Reporter told "action taken"
                                                         [ Cancel ]   [ Send decision ]
```

| Rule | Design |
|---|---|
| **Options shown** | Only the actions that fit the thing. A comment never offers "Hide from Discover", which today's page wrongly offers for every report. Workspace and org cases show Hide from Discover · Restrict · Suspend · Remove |
| **Suggested step** | Shown as a quiet label from the ladder; never pre-selected beyond Warning |
| **Rule** | Required for Take action; a select of the numbered guideline sections |
| **Message** | Pre-filled for the rule; 4-line textarea. **Preview email** opens the exact M-email in a dialog |
| **Consequences line** | Always visible above the buttons. It spells out who is told what, the strike number, the appeal date and what the reporter hears |
| **Send decision** | The one primary action; busy text "Sending…" with stable width |
| **Confirmation** | Only for **Ban** and **Remove workspace/org**: a dialog repeating the consequences, with a red **Ban Asha Rao** / **Remove CSE-3A** button |
| **Undo** | After sending: a toast "Decision sent · NB-4821" with **Undo** for 10 seconds. Notices and emails wait 10 seconds before they go, so Undo is real. After that, changes are reversals and are logged |
| **Self-review warning** | In Appeals, when you made the original decision: an amber notice "You made this decision. Add a note explaining the second look." |
| **Conflict** | If someone else decides first: an amber notice "Rao decided this a minute ago" with **View decision**. Nothing is overwritten |

### 17.6 Appeals tab

- **List rows:** `NB-4821` · person · action appealed ("Limit 7 days") · submitted (relative time) · **decide by** (mono, amber or red as in the queue) · "Self-review" amber badge when it applies.
- **Detail**, same frame as the case view:
  - Main: the original decision (actions, rule, the message that was sent), the evidence link, and the appeal text in a sunken well, with "I've changed or removed the content" if ticked.
  - Rail: the person card and history.
- **Outcome form:** Upheld · Reduced · Reversed.
  - **Reduced** shows the lighter options only.
  - A required reply (pre-filled) and an internal note.
  - The consequences line, as in 17.5.
  - **Send outcome**.
- **Empty state:** "No appeals waiting".

### 17.7 Active tab (replaces today's "Suspended organizations")

Everything currently in force, in one table (40px rows):

| Column | Example |
|---|---|
| What | Account · Asha Rao / Workspace · Team Falcon / Org · CSE-3A |
| Action | [LIMITED] · [SUSPENDED] · [BANNED] · [RESTRICTED] · [HIDDEN] · [REMOVAL 1 DEC] |
| Since → until | mono dates; "Permanent" for bans |
| Case | NB-4821 link |
| Appeal | Pending / Decided / Closed |
| Action | **Lift** (secondary). Opens a short dialog with a required reason; the person gets M5 or M11 |

Filters: kind and action. The empty state is "Nothing is in force".

### 17.8 People tab

- **Search** by name, @handle, email or case number. Results are person rows (56px) with a standing badge.
- **Person page** `/admin/trust/people/@asha`:
  - **Header:** a 48px squared avatar, name, @handle and account age, the standing badge (GOOD STANDING / LIMITED until 12 Nov / SUSPENDED / BANNED), and **Act on account** (secondary). That opens the decision form as a new manual case with source "Staff".
  - **Sections:** Active restrictions · Strikes (with expiry) · Cases about them · Appeals · **Reports they made** (count, accuracy, last 10) · Linked workspaces and orgs they own.
- **Email addresses** appear only here, for staff, with a Copy button.

### 17.9 Verification tab

- **Rows:** the org mini-card, website links, the owner's email domain (mono) with **Match / No match**, and the requested date.
- **Actions:** **Verify organization** (primary) and **Decline** (secondary, with an optional note to the owner).
- **Empty state:** "No verification requests".

### 17.10 Health tab

Follows spec §26 (quiet data presentation):
- **Controls:** range 7 days · 30 days · 90 days (radio tags), and "Updated 5 min ago".
- **Metric strip** (white 8px cards, 11px labels, 24px mono values, a 13px context line):

| Metric | Context line |
|---|---|
| Open cases | by severity |
| Overdue | — |
| Median time to decision | Urgent / High / Normal vs the 1 h / 24 h / 72 h targets |
| Appeals pending | — |
| Reversal rate | of decided appeals |
| Repeat offenders | 3+ active strikes |

- **Panels:**
  - New cases per day, stacked by severity (clay / amber / neutral, direct labels, with an equivalent data table).
  - Actions by type.
  - Top reasons.
  - Most reported workspaces and orgs.
  - Reporters with low accuracy.
- **Missing data** shows as "—", never 0.

### 17.11 Audit log tab

- **Table** (40px rows): time (mono, with time zone on hover) · staff · action · target (case link) · rule · note (one line, expandable).
- **Filters:** staff, action, date range.
- **Export CSV:** a secondary button; the export is logged.
- The log is append-only: there's no edit or delete anywhere.

### 17.12 New case dialog

- Standard dialog (460px, paper footer).
- **What:** paste a link to a profile, post, workspace or org, or an @handle; it resolves to a preview.
- **Fields:** Source (Email / Staff / Legal) · Reason · Severity (defaults from the reason) · Details · Email reference (optional, e.g. the support@ subject) · **Legal hold** checkbox.
- **Button:** **Open case**. It lands on the new case.

### 17.13 States, keyboard and accessibility

| Area | Design |
|---|---|
| Loading | Layout-matched skeletons per tab (rows, case panes, metric cards), one polite announcement |
| Partial failure | The failed panel shows a red-soft inline notice with **Retry**; the rest stays |
| Background refresh | The list updates in place; selection, scroll and an open form are kept. A case changed by someone else shows "Updated by Rao · Refresh" instead of jumping |
| Permission | Non-staff: 404. Moderator: admin-only actions are disabled with the reason |
| Keyboard | `j`/`k` next and previous case · `c` claim · `d` jump to the decision form · `/` search · `?` shortcuts dialog. All are disabled while typing in a field |
| Focus | Opening a case moves focus to its title; after Send decision, focus goes to the next case in the list |
| Screen readers | Badges have text; deadlines read as "due in 42 minutes"; the countdown isn't announced as it ticks |
| Dark mode and density | Tokens only (today's notifications admin page uses raw zinc colors; 18.2 fixes that) |
| Phones | Single column. Case view stacks rail under main. The decision form opens as a bottom sheet with its buttons fixed above the safe area |

### 17.14 Copy rules for the console

- **Sentence case; actions name verb and object:**
  - Send decision · Send outcome · Lift limit · Restore post · Verify organization · Open case.
  - Never "Submit" or "OK".
- **Past-tense toasts:**
  - "Decision sent · NB-4821".
  - "Limit lifted for Asha Rao".
  - "Organization verified".
  - Never "Done."
- **Errors say what to do:** "Couldn't send the decision. Check your connection and try again." The form stays filled.
- No exclamation marks; dates are relative under a week, then short absolute, with IST on hover.

---

## 18. App-wide report UI: audit and fixes (C15–C20, locked 2026-10-29)

### 18.1 What's inconsistent today

| # | Where | Today | Problem |
|---|---|---|---|
| 1 | Comments (posts and tasks) | A bare flag icon is always visible on every comment | Inconsistent; visual noise; easy to tap by mistake |
| 2 | Doc tab | A standalone "Report" text button above the doc | Doesn't match the "⋯" pattern used elsewhere |
| 3 | Cards, org header, update card | In the "⋯" menu | Correct pattern |
| 4 | Report dialog | Reasons without hints; no case number; no "Also block"; toast-only errors; "Report submitted" | Misses T2–T5; failures disappear; copy isn't the spec's past tense |
| 5 | Your own content | Report can appear for your own items in some places | Should never appear |
| 6 | Signed out | Report fails with a toast | Should go to sign-in and return |
| 7 | Already reported | Report again shows a silent no-op | Should say it's in review |
| 8 | Staff console | Outside the app shell, no entry point, `prompt()`, "Done." | Section 18 |
| 9 | Notifications ops page (`/admin/notifications`) | Raw zinc colors and its own table styles | Not on tokens; doesn't follow §26 |
| 10 | Settings | No place for "Your reports" or Account standing | T5 and T20 need homes |

### 18.2 The fixes

| # | Decision | Design |
|---|---|---|
| **C15** | One placement rule | **Report is always the last item of the "⋯" overflow menu**, after a divider, as "Report <noun>" with the Flag icon. Never a standalone visible button. Comments get a "⋯" button that appears on hover or focus (always visible on touch) holding Edit, Delete, Copy link and Report |
| **C16** | Visibility of the item | Hidden on your own things. Signed out: the item opens sign-in and returns to the same place. Already reported: the item reads "Reported · in review" (disabled, with the case number in its description) |
| **C17** | The dialog | Spec dialog (460px, paper footer):<br>- reasons as radio rows with a one-line hint, filtered by kind (5.2);<br>- the Urgent note when picked;<br>- Details as a 4-line textarea;<br>- "Also block <name>" for people and messages;<br>- **Send report** disabled until a reason is picked;<br>- failures as an inline red-soft notice with the text kept;<br>- success shows a confirmation panel inside the dialog ("Report sent · NB-4821 · We'll review within 24 hours") with **Done**, not a disappearing toast |
| **C18** | Settings homes | Within the existing section names (spec §29), so no new sections:<br>- **Privacy → Your reports** (`#settings-privacy-reports`);<br>- **Account → Standing** (`#settings-account-standing`), with a one-line status row at the top of Account ("Good standing" or "Limited until 12 Nov");<br>- **Notifications:** a row "Safety notices are always sent" with no switch, like security emails |
| **C19** | The tray and banner | Tray notices about reports and decisions use one "Safety" group and the Flag icon. The restriction banner (8.4) uses the amber notice strip from the state matrix, not a new colour |
| **C20** | Notifications ops page | Brought onto tokens and the §26 table style, with the same shell and staff menu entry. Linked from the console as **Notifications ops** in the "⋯" by the page title |

### 18.3 Decisions (C1–C20, locked 2026-10-29)

| # | Topic | Decision |
|---|---|---|
| C1 | Address and shell | `/admin/trust` inside the app shell; `/admin/reports` redirects; deep links per case, appeal and person |
| C2 | Entry | Staff-only **Trust & safety** in the avatar menu with a count, plus ⌘K |
| C3 | Tabs | Queue · Appeals · Active · People · Verification · Health · Audit log; opens on Queue |
| C4 | Queue | Split view on wide screens; views Needs action / Mine / Org cases / Decided; filters; 64px case rows with severity badge, case number, deadline and claim |
| C5 | Case view | Evidence (As reported / Live now), Reports, Decision, Internal notes; a rail with Person, Other cases, Where and History |
| C6 | Sensitive content | Blurred behind Show for staff, each Show logged |
| C7 | Decision form | One form; only fitting actions; suggested step as a label; required rule; editable message with Preview email; consequences line; a confirm dialog only for Ban and removals |
| C8 | Undo | A 10-second Undo after Send decision (notices wait 10 seconds) |
| C9 | Claim and conflicts | I'm reviewing, Release and Take over (logged); conflicts never overwrite |
| C10 | Appeals tab | Same frame; Upheld / Reduced / Reversed; self-review warning |
| C11 | Active tab | Everything in force, with Lift and a required reason |
| C12 | People, Verification, Health, Audit log | As in 17.8–17.11 |
| C13 | New case | Dialog with link-or-handle lookup, source, severity, email reference and Legal hold |
| C14 | States, keyboard, phones | As in 17.13–17.14 |
| C15 | Report placement | Always last in "⋯"; comments get a "⋯" menu |
| C16 | Report item visibility | Hidden on your own things; sign-in when signed out; "Reported · in review" |
| C17 | Report dialog | Hints, Urgent note, Also block, inline errors, an in-dialog confirmation with the case number |
| C18 | Settings homes | Privacy → Your reports; Account → Standing; a "Safety notices are always sent" row |
| C19 | Tray and banner | A Safety group and the amber notice strip |
| C20 | Notifications ops | Onto tokens and §26, linked from the console |

---

## 19. Final audit (2026-10-29): gaps, conflicts and improvements (F1–F24, locked 2026-10-29)

This audit read the whole concept against the code, the live legal pages and the design spec. Four wording slips were fixed directly:
- T20 now points to Account → Standing.
- The self-review rule points to T22.
- The reporter's confirmation uses the deadline for the reason.
- M4's subject covers suspensions.

Everything below changes or adds behaviour. All of it was locked on 2026-10-29, and where an F decision differs from an earlier T or C decision, the F decision wins.

### 19.1 Conflicts inside the locked decisions

| # | Conflict | Proposal |
|---|---|---|
| **F1** | T11 says "one appeal **per action**"; 10.7 says one appeal **per case** covers all its actions | **One appeal per case.** It covers every action in that case, and the reviewer can decide each action separately (e.g. keep the removal, lift the limit) |
| **F2** | The ladder says "1 strike → Warning", but the decision itself adds the strike, so it's unclear whether the current one counts | Count only **earlier active strikes**: 0 → Warning · 1 → 7-day limit · 2 → 30-day limit · 3+ → suspension |
| **F3** | T13 plans a new `/legal/guidelines` page, but the app already has **Acceptable Use** (`/acceptable-use`, with "§6 Reports and enforcement"), **Copyright** and **Grievance redressal** pages | **Don't add a page.** Rewrite Acceptable Use as the numbered rules every reason links to (19.4), and link Grievances and Copyright from the report dialog, emails and console |
| **F4** | Every decision "adds a strike", including Hide from Discover on a workspace or an org | Strikes go to **a person**. Workspace and org actions add a strike to the owner only for Suspend and Remove; Hide from Discover and Restrict don't |
| **F5** | Org case hand-off at the org's deadline leaves staff a case that's already overdue | Org moderators get **half** the deadline (12 h for High, 36 h for Normal); staff get the other half |
| **F6** | "Suspension: 30 days, or until reviewed" is vague | Choose **14 days**, **30 days**, or **Pending investigation** (at most 14 days, then it must be decided) |

### 19.2 Gaps: things the concept doesn't cover yet

| # | Gap | Proposal |
|---|---|---|
| **F7** | **Indian law.** The live Grievances page names a generic "Grievance Officer, NetworkBase", and the grievance email falls back to privacy@. Rules for platforms in India (IT Rules 2021) expect a named grievance officer, acknowledgement within 24 hours, resolution within 15 days, and removal of intimate images shared without consent within 24 hours | Set the real name in `LEGAL_GRIEVANCE_OFFICER_NAME` (a Railway variable, no code). The report flow already acknowledges at once with a case number, and our deadlines are inside 15 days. Add the reason in F8 with Urgent handling. **Have a lawyer confirm this list; this isn't legal advice** |
| **F8** | Missing reasons; one reason mixes two different needs | Split "Threat or self-harm" into **Threat of violence** (Urgent) and **Self-harm or suicide** (Urgent, support-first, F9). Add **Intimate images shared without consent** (Urgent; hidden on the first report). Reasons go from 10 to 12 |
| **F9** | Self-harm is handled like a violation | A self-harm report sends the person a gentle notice at once, with helplines (Tele-MANAS 14416, KIRAN 1800-599-0019), and **no penalty or strike** unless others were harmed. It's the second exception to "told only on a decision" |
| **F10** | Auto-hide needs 2 reporters, but with one staff member an urgent case at 3 am waits hours | **Hide on the first report** for child sexual content and intimate images (the harm of leaving them up is too high). Threats keep the 2-reporter rule |
| **F11** | What staff get as **evidence for each kind** isn't defined (person, workspace, org, file) | Person: name, @handle, headline, bio, photo. Workspace or org: title, tagline, description, cover, links. File: name, type, size, plus a pin from deletion. Messages and posts as today |
| **F12** | **Impersonation and profile content** have no fitting action | New actions: **Reset profile fields** (photo, name, headline, bio) and **Hold @handle** (rename it and keep the old handle unavailable). For orgs, **Remove Verified badge** |
| **F13** | What a restriction does to **everything else** isn't defined | Table in 19.3 |
| **F14** | **Restrictions must apply at once.** The app reads roles from the sign-in token, which can be up to an hour old | Restrictions are checked from the database on every write. A suspension or ban also signs the person out everywhere and revokes editor and API tokens |
| **F15** | **Ban evasion**: a banned person can sign up again | On a ban, block the email address and the Google or GitHub identity from signing up, stored as a hash. The People tab shows "Possible repeat account" when a new sign-up matches |
| **F16** | **Staff security** | Staff must have an authenticator to open the console. Ban, Release legal hold, Export audit log and adding or removing staff ask for a fresh verification (the spec's rule for irreversible actions). Viewing a DM snapshot, sensitive content or an email address is logged |
| **F17** | **Adding or removing staff** happens only by SQL | A **Staff** list (admins only) in the People tab: add by email as admin or moderator, remove, with each change logged. SQL stays as a backup |
| **F18** | **Org moderators' Reports list** has no screen design | Members tab → Reports uses the console's case view with fewer actions (Dismiss · Hide · Remove · Warn author). It shows no reporter names, no DMs, nothing Urgent and nothing about the org's own admins, with "Passed to NetworkBase" once the hand-off happens |
| **F19** | **Spam waves**: one spammer can create 30 cases | **Bulk decisions** in the Queue (select cases, one decision, one notice per person), plus **Merge into NB-…** and **Close as duplicate** |
| **F20** | **Claims can stall** | A claim is released after 2 hours untouched (15 minutes for Urgent), and the case goes back to Unclaimed |
| **F21** | **Report from emails**: org invites and connection requests from strangers arrive by email | Invitation emails (E2, E3 and connection requests) get a quiet **Report this invite** link that opens the dialog after sign-in |
| **F22** | **Privacy wording**: today's dialog says reports are "anonymous to the people involved". In a 1-to-1 DM that's not entirely true, and org moderators can read the details text | Dialog copy: "We never tell them who reported. In an organization, its admins may see what you wrote here, but not your name." The Privacy Policy also needs a section on moderation records and how long they're kept (section 14) |
| **F23** | **Your data and deletion** were in v1 and lost in v2 | Restore it. A person's export includes their reports (without others' names) and the actions taken on them. Deleting an account doesn't erase evidence under Legal hold, or the ban block in F15 |
| **F24** | **Jobs failing silently** would stop urgent alerts | Turn on Inngest failure alerts to staff email. The morning summary ends with "Background checks: all ran" or names any job that failed |

### 19.3 What a restriction does to everything else (F13)

| Thing | Limit | Suspension | Ban |
|---|---|---|---|
| Profile for others | Normal; no public label | "This account is suspended" | Hidden |
| Their posts, comments, messages | Stay | Stay, under their name | Stay as "Removed user"; their DMs show "Removed user" |
| Search, Discover, people suggestions | Stay | Removed | Removed |
| Pending invitations they **sent** | Stay | Cancelled | Cancelled |
| Pending applications and join requests they made | Stay | Paused (hidden from reviewers) | Withdrawn |
| Tasks assigned to them | Stay | Stay; owners see "suspended" next to the name | Unassigned, and owners are told |
| Workspaces and orgs they own | Normal | Read-only for them; members keep working | Pass on by the succession rules |
| GitHub sync, IDE and API tokens | Work | Stopped (tokens revoked) | Revoked |
| Emails we send them | Normal | Only account, safety and security emails | Only the ban and appeal emails |
| Presence | Normal | Shown offline | Not shown |

### 19.4 The numbered rules (F3)

Acceptable Use becomes the rule list that every reason, decision, notice and email links to:

| § | Rule | Reasons that use it |
|---|---|---|
| 1 | Threats and violence | Threat of violence |
| 2 | Harassment and bullying | Harassment or bullying |
| 3 | Hate | Hate speech |
| 4 | Spam and manipulation | Spam |
| 5 | Impersonation | Impersonation |
| 6 | Scams and fraud | Scam or fraud |
| 7 | Private information | Sharing private information |
| 8 | Intimate images without consent | Intimate images shared without consent |
| 9 | Sexual and graphic content | Inappropriate content |
| 10 | Child safety | Sexual content involving a minor |
| 11 | Self-harm (support, not penalties) | Self-harm or suicide |
| 12 | Intellectual property | Via the Copyright page |
| 13 | Misusing reports and appeals | False reports |
| 14 | Systems, automation and fair use | Today's §3–§5 |
| 15 | Reports and enforcement | How all of this works (today's §6) |

### 19.5 Smaller improvements, folded into the build without separate decisions

- **The reporter's outcome notice:** "You can block them or mute the conversation". There is no person-mute feature today, so the notice doesn't promise one.
- **Other reporter notices:**
  - When a case closes because the content is gone: "That content is no longer on NetworkBase."
  - A report closed as a duplicate gets the same outcome as the main case.
- **"No rule broken", then reported again:** a second report on the same thing by the same person after "No rule broken" needs new details, or it's refused with "We already reviewed this."
- **Hidden-content labels say who acted:** "Hidden by NetworkBase" or "Hidden by CSE-3A admins".
- **Org warnings** show in Account → Standing → History as "Warning from CSE-3A (no strike)".
- **Dates and times** in emails to people use their own time zone; staff emails use IST.
- **Undo (C8):** the decision applies at once in the app; notices and emails go after 10 seconds; Undo reverts both.
- **Empty morning summaries** aren't sent ("Nothing open" isn't an email).
- **Staff alerts** also go as web push to staff devices (push already exists in the app), not only email.
- **Removed content:** the content itself is deleted once its appeal is decided or the window closes. The evidence snapshot follows the 2-year retention.
- **Ban appeals:** pausing a restriction because we're late (T22) applies to limits and suspensions, **never to bans**.
- **Banned accounts:** the account record is kept for 2 years after the ban (for appeals and F15); personal data beyond that is deleted.
- **The Discover update card** Report item depends on the update-likes work, which has landed; it's built with the rest of section 18.

### 19.6 Decisions (F1–F24, locked 2026-10-29)

| # | Decision |
|---|---|
| F1 | One appeal per case, decided per action |
| F2 | The ladder counts earlier active strikes only |
| F3 | Acceptable Use becomes the numbered rules; no new guidelines page; Grievances and Copyright linked |
| F4 | Strikes for workspace and org actions only on Suspend and Remove, to the owner |
| F5 | Org moderators get half the deadline |
| F6 | Suspension of 14 days, 30 days or Pending investigation (14 days at most) |
| F7 | Name the grievance officer (Railway variable); a lawyer confirms the Indian timelines |
| F8 | Reasons become 12: Threat of violence, Self-harm, and Intimate images added |
| F9 | Self-harm is support-first: helpline notice at once, no strike |
| F10 | Child sexual content and intimate images hidden on the first report |
| F11 | Evidence defined for each kind |
| F12 | Reset profile fields, Hold @handle and Remove Verified badge |
| F13 | The restriction side-effects table (19.3) |
| F14 | Restrictions checked in the database on every write; suspension and ban sign out and revoke tokens |
| F15 | Ban blocks the email and sign-in identity from signing up again |
| F16 | Staff need an authenticator; fresh verification for the riskiest actions; sensitive views logged |
| F17 | A Staff list for admins to add or remove staff |
| F18 | The org moderators' Reports list as described |
| F19 | Bulk decisions, Merge and Close as duplicate |
| F20 | Claims release after 2 hours (15 minutes for Urgent) |
| F21 | "Report this invite" in invitation emails |
| F22 | Honest anonymity wording, and a moderation section in the Privacy Policy |
| F23 | Export and deletion rules restored |
| F24 | Inngest failure alerts and the "Background checks" line |

---

## 20. Build order

Each F item is built inside the step it touches. Examples: F14 and F15 in step 5 (restrictions), F19 and F20 in step 3 (console), F3 and F22 with the guidelines in step 9. F7 is a Railway variable you set.

1. **Data:** cases, actions, restrictions, appeals, snapshots, case numbers.
2. **Reporting from all 15 places (section 18):** one "⋯" placement, the new dialog, Also block, confirmation, outcomes, Your reports.
3. **Console (section 17):** shell and entry, tabs, queue, case view, decision form with Undo, Active, People, Verification, audit log.
4. **What the reported person sees:** content states, tray notices, the emails M1–M8, Reply-To.
5. **Restrictions:** enforcement in every write path, the banner, Account standing, the limited sign-in screen, M4 and M5.
6. **Appeals:** the form in all 7 places, the Appeals tab, the outcomes, M9–M11.
7. **Org moderators:** the Reports list, the hand-off, the repeat-removal case.
8. **Monitoring:** urgent alerts and reminder, morning summary, Health tab and weekly email, manual cases, Legal hold, and the notifications ops page onto tokens (C20).
9. **The jobs, the Community guidelines page, tests and a review.**
10. **Production (needs your approval):** migrations, deploy, one worker Inngest re-sync.

---

## Part B. The organization background jobs

### B1. What they are (designed in report §26.5 and §30.5)

| Job | Runs | What it does | If it doesn't run |
|---|---|---|---|
| **org-due-soon** | Hourly at :05 | At **9 am** each person's local time: the "due tomorrow" summary (tray, plus email E6 at most once a day), "due today" and overdue notices. It respects the org's Reminders setting and each person's mutes | Nobody is reminded about assignments |
| **org-admin-digest** | Hourly at :10 | At **8 am** local time for each org owner and admin: the daily digest (E9). Admins who chose "Instant" get notices as things happen instead | Admins get no daily summary |
| **org-duplicate** | When the owner picks Duplicate | Makes a new org from the parts the owner ticked. Never members, child workspaces, submissions, messages, posts, contributions or the join code. The owner is told when it's ready | The new org is never created |
| **org-purge** | Daily at 03:30 UTC | Permanently deletes orgs whose 30-day deletion grace has ended, up to 20 per run. Contribution entries stay | Deleted orgs never go away |

- All background jobs run on **networkbase-worker** (`INNGEST_EXECUTION_ROLE=worker`); the web service serves none.
- After adding new jobs, re-sync the worker with Inngest: `PUT https://networkbase-worker-production.up.railway.app/api/inngest`, or Resync in the Inngest dashboard.

### B2. Production status (2026-10-29)

| Step | Status |
|---|---|
| Inngest sync of the 4 org jobs | **Done:** the worker re-registered ("modified: true") |
| `EMAIL_LINK_SECRET` on both services | **Done:** the same value on both, both redeployed |
| Staff access | **Done:** your account has the `admin` role; `ADMIN_USER_IDS` isn't needed |
| `RESEND_API_KEY` on the worker; Inngest keys on both | Set |
| Supabase billing | **Yours to check:** "Grace period is over" on the free plan |
