# Organization → Workspaces: end-to-end concept — findings, 4 November 2026

Source: the user's screenshots of CSE 3B → Workspaces, Discover and the profile's Portfolio, their notes, and the code
(`OrgWorkspacesTab`, `WorkspaceRequests`, `AssignLeadDialog` in `OrgOverviewParts.tsx`; `readOrgWorkspacesAction` in
`org-dashboard.ts`; `needsAttention` in `dashboard-rules.ts`; Discover's `WorkspaceCard.tsx`). No code changed. Two
visuals were shown in chat; the second (Portfolio's full-width card) is the one this report builds on.

## 0. What was asked

| The user's words | Section |
|---|---|
| "The workspace card should be shown in the same way as Discover" | §2 |
| "Exactly what you can see in the first image (Portfolio)… keep the overview and review… the card design exactly how it is on Discover or the portfolio" | §2 |
| "Improvements on the headers — search, dropdowns, filters… placements, buttons and size proper" | §1 |
| "The New workspace button should be proper" | §1, §4 F2 |
| "'1 workspace · 0 need attention' should be proper… tight spacing and a proper layout" | §1 |
| "Add improvements, enhancements, layouts, UI/UX, placements and UX flow… find gaps and add proper solutions… end-to-end" | §3–§10 |

---

## 1. The header

**What happens.** Three loose rows: a plain sentence ("1 workspace · 0 need attention · 0 quiet · 1 person not in one")
where each phrase is a hidden button; then Search (36px), a Status select that repeats the sentence, Sort, a bare
Mine checkbox, Filters (32px), a List | Cards toggle (28px) — four different heights — and New workspace pushed to the
far right on its own. Requests (workspaces asking to join) sit as a full block above all of it.

**Design.** Top to bottom, inside the tab's usual padding:

1. **Requests line** (admins, only when there are any): one quiet banner row, not a block — "2 workspaces asked to join
   CSE 3B · **Review**". Review opens a side panel with each request (avatar, name, lead, "asked 2h ago"), Accept and
   Decline (Decline asks for an optional reason, as today). The line goes when the last one is answered. (§6 G10)
2. **Status bar:** **All 3 · Needs attention 1 · Archived 0** as tabs with counts, the board's View style; Needs
   attention's count in orange when above 0. A hairline under the bar. On the right, quiet text: "1 person isn't in a
   workspace · **Place them**" (to Members, filtered to "Not in a workspace"). When Needs attention is selected, a row
   of reason chips appears under the bar — **Overdue 1 · Quiet 7 days 1 · Needs a lead 0 · Group work 0** — each a
   filter with its count (replaces the separate Quiet tab; §6 G8, D4).
   Members see **Mine 1 · All 3** instead (no attention, no archived) — §4 F6.
3. **Toolbar, one row, every control 30px, 8px apart:** Search workspaces (220px; "/" focuses it, Esc clears) ·
   **Sort ▾** (Needs attention first — admins' default · Recently active — members' default · Name · Most overdue ·
   Newest) · **Mine** toggle (admins; members already have the Mine tab) · **Filters ▾** (Visibility, Stage, Lead,
   Sprint, Open seats — the button shows "Filters · 2" when any are on, and a "Clear" link appears after it) ·
   **List | Cards** segmented · **+ New workspace** (primary, 30px) at the right end of the same row.
4. **Result line** under the toolbar, only when something narrows the list: "Showing 2 of 9 · Clear filters".

The sentence, the Status select and the bare checkbox go. Everything above is kept in the link (§6 G3).

## 2. The card — the exact Discover / Portfolio card

The user wants the card **exactly** as on Discover and the Portfolio, full width, one per row (the second visual).

- **Same component and class** (`WorkspaceCard`, `nb-project-card`), not a copy: avatar, title, the one-line
  description, skill tags with their icons, "Updated by Ramanayudu · 3h ago" (`WorkspaceLastUpdate`), a hairline, and
  the footer with member avatars on the left and link icons, views and followers on the right.
- Inside the organization the card leaves out its "CSE 3B · Data Structures 2026 /" line (it's the page you're on).
- **The organization's part**, inside the card between "Updated by" and the hairline (an `orgDetails` slot the card
  renders only when given):
  - one line "Lead Ramanayudu CH · Plan · CO1 · Week 3–4" with the health chips (**open 4 · overdue 2 · in review 1**,
    overdue red above 0) at its right;
  - admins: an amber attention line with each reason and its own action (§4 F1) — "2 overdue · **Open board**",
    "Quiet 7 days · **Remind lead**", "Needs a new workspace lead · **Assign**", "Group assignment returned · **Open
    review**";
  - the group copy when the workspace hands in as a team: "ALM-1 · In review".
- **Title line, right:** the visibility chip (Org / Private / Public), "New" when it joined the organization this week,
  or **Archived**.
- **Footer:** after the avatars "5 people" and open seats in orange ("1 open seat" — to the team page; members not in
  it see **Apply**, §4 F6); at the right end, after views and followers: **Message lead** (members) or **⋯** (admins:
  Remind lead, Assign lead, Archive, Detach; Unarchive and Detach when archived).
- **Archived:** faded to 60%, "Archived by Rama · Nov 2" in place of the description, no attention line.
- The whole card opens the workspace; the chips, links and ⋯ are their own targets (no nested-link clicks).

**List view** stays for bulk work: one 52px row per workspace — checkbox, avatar, name and description (one line),
lead, stage · sprint, the same health chips, "Updated 3h ago", ⋯ — under a sticky column header (Name · Lead · Stage ·
Health · Updated), sortable by clicking a column. Selecting rows shows a bar in the toolbar's place: "3 selected ·
Remind leads · Archive · Clear".

## 3. Layouts and placements

| Width | Header | Cards | List |
|---|---|---|---|
| ≥1280px | Status bar and toolbar each one line; New workspace at the toolbar's end | Full width, max 1040px, left aligned with the header; 12px between cards | All columns |
| 1024–1279 | Same; Search 180px | Same | Updated column drops (shown under the name) |
| 768–1023 | Toolbar wraps once: Search grows to fill line 1 with New workspace; Sort · Mine · Filters · List \| Cards on line 2 | Same card; footer's views and followers stay | Lead and Stage fold under the name |
| <768 (phone) | Status bar scrolls sideways; Search full width; one line of icon buttons (Sort, Filters, view) with New workspace as "+ New" | Card full width; health chips wrap under the org line; ⋯ is a 44px target | List hidden; Cards only (D2) |

Placement rules: every primary action sits at the right end of its line (New workspace, Review, the card's ⋯); every
count sits right after its label; destructive actions only inside ⋯ and always confirmed.

## 4. UX flows

**F1 · Admin: "what needs me?"** Open the tab → sorted Needs attention first, the status bar says "Needs attention 2"
in orange → each card's amber line names the reason and offers its fix:

| Reason (from `needsAttention`) | Shown as | Action |
|---|---|---|
| `N overdue` (3 or more) | "2 overdue" | **Open board** — the workspace's board filtered to overdue |
| `quiet 7 days` | "Quiet 7 days" | **Remind lead** — confirm with a prefilled, editable note; sends a notification; card shows "Reminded just now" and the button turns into "Reminded" for 24h |
| `group assignment missing` | "ALM-1 not handed in" | **Open assignment** (the master's roster) |
| `group assignment returned` | "ALM-1 returned" | **Open review** (the queue on that copy) |
| `lead left the organization` | "Needs a new workspace lead" | **Assign** — the Assign lead dialog with the workspace's people first; on save the line clears |

Fixing the last reason moves the card out of Needs attention with the count dropping in place (no reload).

**F2 · New workspace.** + New workspace → the wizard (`/workspaces/new?org=…`) with the organization already chosen and
shown as a locked line ("In CSE 3B"), visibility defaulting to Org → on create the person lands in the new workspace
(as today) with a toast "Added to CSE 3B · **Back to Workspaces**". Back on the tab the new card is at the top with
"New" and a 2-second highlight. Members who can't create see no button; if the organization lets members ask, they
see **Ask to add a workspace** instead (D6).

**F3 · Requests.** Banner → Review panel → Accept (the card appears with "New") or Decline (optional reason sent to the
asker). Panel empty → banner gone. The Overview's request count drops at the same time (same read).

**F4 · Archive, unarchive, detach.**
- Archive (⋯) → confirm: "Archive Team Alpha? It stays readable; nobody can add work. You can unarchive it." →
  the card fades and moves to Archived with an **Undo** toast for 6s.
- Unarchive (Archived tab, ⋯) → no confirm, back in All.
- Detach (⋯) → confirm in red: "Detach Team Alpha from CSE 3B? The workspace stays with its people; it leaves the
  organization's boards, sprints and reviews. Its hand-ins already made stay in the organization." Requires typing
  nothing; one red button. No undo; the toast says how to ask to join again.

**F5 · Place them.** "1 person isn't in a workspace · Place them" → Members tab with `project=none` already applied
(`setFilter({ project: 'none' })` exists there) → each row's "Add to a workspace" → back link "← Workspaces".

**F6 · Member.** Opens the tab → **Mine** selected when they're in one (All otherwise) → their cards first; no
attention lines, no archived. On a card they aren't in: open seats show **Apply** (the workspace's existing apply flow,
chip "Applied" afterwards — the card already renders `applicationChip`), and **Message lead**. Health chips shown (D3).

**F7 · Bulk (admins, List).** Tick rows (shift-click for a range) → bar: Remind leads (one confirm for all, skips
those reminded in the last 24h and says so), Archive (one confirm, one Undo). Esc clears the selection.

**F8 · Open and come back.** Opening a card and pressing Back returns to the same tab, filters, sort, view and scroll
position (all in the link; scroll restored by the browser since the list renders from the cached read).

## 5. States

| State | Admin | Member |
|---|---|---|
| Loading | Header renders at once (counts as "–"); 3 card skeletons of the real card's height | Same |
| No workspaces | "No workspaces yet. Teams work inside workspaces." · **+ New workspace** · "How workspaces work" link | "No workspaces yet. Your organizer will add them." |
| No match | "No workspaces match these filters" · **Clear filters** (keeps the tab) | Same |
| Mine, none | — | "You're not in a workspace yet" · **Browse all** · open seats count |
| Needs attention, none | "Nothing needs you. Every workspace is active." | — |
| Archived, none | "Nothing archived." | — |
| Read failed | "Couldn't load workspaces." · **Try again**; header controls stay | Same |
| Organization archived | Read-only: no New workspace, no ⋯ actions, banner "This organization is archived" | Same |

## 6. Gaps found, and their solutions

| # | What happens today | Solution |
|---|---|---|
| G1 | `OrgWorkspaceRow` has no description, skills, member avatars, link icons, views or followers — the Discover card can't be drawn from it | Add them to `readOrgWorkspacesAction` in the same read and map each row to Discover's `Workspace` shape so `toWorkspaceCardViewModel` is reused unchanged |
| G2 | The Status select repeats the summary sentence; two controls for one filter | The status bar replaces both (§1) |
| G3 | Search, status, sort, filters and view live only in component state — lost on reload, Back or a shared link | Keep them in the link (`q`, `ws`, `reason`, `sort`, `view`, `vis`, `stage`, `lead`, `sprint`, `seats`), the way the Files browser keeps its place |
| G4 | "Show 50 more" pages on the client over one read of up to 200 rows | Keep the one read (the organization limit is 200 workspaces); render cards 20 at a time with **Show more** at the end and a "20 of 64" count. Server paging only if the limit rises |
| G5 | Selecting several exists only in List | Keep it there (D2); cards stay clean |
| G6 | No keyboard path beyond tabbing | "/" focuses Search, Esc clears it then the selection; cards are links (Enter opens); ⋯ opens with Enter; status tabs move with arrow keys |
| G7 | Attention reasons are raw lowercase text ("quiet 7 days") with one generic action | Each reason gets its label and its own fix (§4 F1) |
| G8 | Quiet is also counted inside Needs attention, so two tabs show the same workspace | Status bar: All · Needs attention · Archived; reasons become chips under Needs attention (D4) |
| G9 | The summary has no archived count, and the Overview and this tab compute "need attention" separately | One summary from the same rows with `archived` added; the Overview reads the same number (test: both equal) |
| G10 | Requests are a full block above the tab | One banner line and a side panel (§1, §4 F3) |
| G11 | Members get the admin layout with parts hidden | Mine · All tabs, Recently active sort, Apply and Message lead (§4 F6) |
| G12 | New workspace leaves the tab with no way back and no sign of the new one | Locked "In CSE 3B" line in the wizard, toast with Back to Workspaces, "New" card highlighted (§4 F2) |
| G13 | Remind has no feedback and can be sent again at once | "Reminded just now" on the card; one reminder per lead per 24h (server check), bulk skips and says so |
| G14 | Archive has no undo; Detach's confirm doesn't say what stays | Undo toast for Archive; Detach copy lists what stays and what leaves (§4 F4) |
| G15 | "Updated by" and the counts don't move until reload | Reuse the live update line (`WorkspaceLastUpdate` with `live`) and refresh the read when the organization's task broadcast arrives, as the board's counts do |
| G16 | Loading shows a blank area, then the page jumps | Skeletons at the real card height (§5) |
| G17 | Open seats link only to the team page | Members not in it get Apply; after applying the card shows "Applied" (§4 F6) |
| G18 | Sorting has no "attention first" | Needs attention first is the admins' default (§1) |

## 7. Data and server

- `readOrgWorkspacesAction` rows add: `description` (short), `skills` (name + icon, up to 5), `collaborators` (up to 4
  avatars), `links` (the card's icons), `views`, `followers`, `application` (the viewer's apply state), `remindedAt`
  (last reminder to the lead). Summary adds `archived`. One query, the same access rule as today.
- Counts and reasons come from the rows themselves (no second count query), so the tabs always match the cards.
- Remind keeps its action; the server refuses a second reminder to the same lead within 24h and returns `remindedAt`.
- Cache: the tab's react-query key is invalidated by accept/decline, archive/unarchive/detach, assign lead and remind,
  and by the organization's task broadcast (debounced 2s).

## 8. Accessibility

- Status bar is a `tablist`; reason chips and Mine are toggle buttons with `aria-pressed`; counts are in the accessible
  name ("Needs attention, 2").
- Each card is an `article` named by its title; the title is the link; chips, Apply, Message lead and ⋯ are separate
  focusable controls with names ("More for Team Alpha").
- The attention line uses text plus colour (never colour alone); overdue says "2 overdue", not just red.
- Confirm dialogs trap focus and return it to the ⋯ that opened them; toasts are `status` live regions.
- Targets 30px on desktop, 44px on phones; axe clean on both widths and in dark mode.

## 9. Done when

- Header: requests line, status bar (admin and member versions) with counts that match the cards, reason chips,
  one 30px toolbar row at ≥1280px with New workspace at its end, result line with Clear; everything restored from the
  link.
- Cards: `WorkspaceCard` itself, full width; org line, health chips, attention line with each reason's action, group
  copy, chips on the title line, footer additions; archived and new states; member Apply and Message lead.
- List: columns, sorting, selection bar with Remind and Archive, Esc clears.
- Flows F1–F8 work end to end, including Undo on Archive, the 24h reminder rule and the Back path.
- States in §5 each render; no sideways scroll at 390px; axe clean; Overview's "need attention" equals this tab's.
- Tests: DB — the read's new fields, the summary from the rows, the reminder rule, member vs admin rows. Browser —
  header, each card state, each flow, phone, axe. Unit — reason → label/action mapping.

## 10. Decisions for the user

- **D1 · Default view.** Cards for everyone (proposal), or keep List as the admins' default?
- **D2 · Selecting several.** Only in List (proposal), or a checkbox on cards too? Phones show Cards only.
- **D3 · Health chips on members' cards.** Shown to everyone (proposal), or admins only?
- **D4 · Quiet.** Reason chips under Needs attention (proposal), or keep Quiet as its own tab as first drawn?
- **D5 · Views and followers inside the organization.** Show them as on Discover (proposal), or hide them for Org and
  Private workspaces where they mean little?
- **D6 · Members asking for a workspace.** Add "Ask to add a workspace" for members (proposal), or only admins create?

## Built and checked (4 November 2026)

Everything above, on local main, not pushed; no migration. D1–D6 as proposed (Cards for everyone; selecting only in
List, Cards only on phones; health chips for everyone; Quiet as a reason chip; views and followers shown; members can
ask to add a workspace).

- **Tab** moved to its own file, `OrgWorkspacesTab.tsx` (requests panel, remind, archive/detach, ask-to-add and assign
  dialogs with it). Header, status bar, reason chips, the 30px toolbar, result line, Cards (Discover's `WorkspaceCard`
  itself) and List, every state in §5, keyboard (`/`, Esc, arrows), and the place kept in the link.
- **Discover's card** gained five optional slots (`titleChip`, `orgDetails`, `footerExtra`, `footerEnd`, `menuItems`);
  Discover and Portfolio pass none, so they're unchanged. The admins' items share the card's own ⋯ with Report.
- **Server** (`readOrgWorkspacesAction`): description, skills, four people (lead first), links, views, followers, the
  group copy's ids, when it joined, when its lead was last reminded, who archived it and when; `summary` from the rows
  with `archived` and `mine`; `orgArchived` and `canAsk`. New `readMyMovableWorkspacesAction` for Ask to add.
  `remindLeadsAction` takes the admin's note and returns which were reminded. Rules in
  `lib/organizations/workspace-attention.ts` (reason → label and fix, the summary, reason counts).
- **New workspace:** after creating inside an organization, a toast "Added to CSE 3B · Back to workspaces" opens the
  tab with the new card on top, highlighted for 2 seconds (`wnew`).
- **Members** now reads `project` and `status` from the link (so "Place them" and the Overview's Behind / Inactive
  links open it filtered) and shows "← Workspaces" when it came from "Place them".

**As built, differently from the wording above:**
- Words follow the terminology check, which bans a bare "lead" and "Org": **Remind workspace lead**, **Message
  workspace lead**, **Assign workspace lead**, the chip **Needs a workspace lead**, the column **Workspace lead**, and the
  visibility chip **Organization**.
- The reminder window stays **12 hours** (decision 60, `remindSamePersonHours`), not 24. Found on the way: reminding a
  quiet workspace sent nothing before; it now says "nothing has moved in Team Osprey for 7 days".
- **Open board** opens the workspace's board; the board has no overdue filter to land on yet.
- Live updates listen to the organization's own task and workspace broadcasts, plus focus and every 2 minutes — not one
  subscription per child workspace (up to 200).
- The Overview shows no workspace "need attention" number, so there's nothing to keep equal; it refreshes with this tab
  (request count, workspace rows).
- The viewer's Apply state comes from the same lookup Portfolio uses, not from the read.
- Link keys are prefixed (`wq`, `ws`, `wr`, `wsort`, `wview`, `wvis`, `wstage`, `wlead`, `wsprint`, `wseats`, `wmine`)
  so they never meet the board's or Members' own.
- **Assign workspace lead** shows in ⋯ only while a lead handover is open; the server allows it only then.
- A failed read replaces the tab with the message and Try again (the header needs the read's counts).
- The phone toolbar uses the same text controls, on one line under Search.

Tests: DB — the card fields and people order, the summary from rows, the quiet reminder with its note and the skip
inside the window, members' rows and Ask to add (`org-workspaces-tab.test.ts`). Unit — reasons to labels and fixes,
summary, reason counts. Browser — ten Workspaces tests (header, cards, chips and link, archive/undo/detach, List, member,
states, keyboard, phones and tablets, axe in light and dark) and Members opened from "Place them". Not checked here:
your signed-in screens.
