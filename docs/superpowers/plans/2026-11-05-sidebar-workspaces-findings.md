# Left navigation → Workspaces: names only, and an organization's workspaces as a clean group — findings, 5 November 2026

Source: the user's screenshot of Discover with the left navigation, their notes, and the code
(`src/components/layout/SidebarWorkspaces.tsx`, `AppSidebar.tsx`, `readSidebarWorkspacesAction` in
`src/app/actions/org-workspace.ts`, the `.nb-nav-link` / collapsed rules in `globals.css`). No code changed. A visual was
shown in chat.

## 0. What was asked

| The user's words | Section |
|---|---|
| "On the workspace where it's showing the profile pictures, it's not needed… only the workspace title" | §1 |
| "For the organization, whatever the sub-workspace is there, it should become proper" | §2 |

---

## 1. Names only

**What happens.** Every row in the list starts with `Mark`: the workspace's picture, or two letters in a grey box
("CS", "PO", "CA"). The same box is on organizations, personal workspaces, workspaces outside your organizations
("CSE 3B / Team Falcon") and requests. The pictures crowd the list and pull the eye from the names.

**Design.**
- Every row is **the name alone**: no picture, no letters. Rows are the main navigation's height (`--ui-nav-item-height`)
  and text (13px, medium), and line up under the **WORKSPACES** label (no icon column).
- A long name is cut with "…" and the whole name shows on hover (`title`) and to screen readers.
- The selected row uses the main navigation's selected look (`--sidebar-accent`), as today.
- Outside workspaces keep their organization in muted text: "CSE 3B / Team Falcon".
- Requests keep "Requested" at the right, faded as today.
- **Collapsed sidebar (64px strip):** the pictures were the only thing it could show for workspaces. Without them the
  **Workspaces section is hidden** in the strip (the heading already is); opening the sidebar shows it. (D1)

## 2. An organization and its workspaces as one group

**What happens.**
- The organization's row ends with **+**, a number badge and a chevron, all always visible; the number ("2") doesn't
  say what it counts (things that need you).
- Its workspaces sit under it with their own indent (`ml-7`) and a smaller font (13px vs the row's), with nothing
  joining them to the organization; "Team Falcon: Hash tab…" is cut early.
- Two different trailing links: **See all** (only when you're in more than 5) and **All workspaces** (admins only), in a
  third style (12px, no row padding).

**Design.**
- **Organization row:** a disclosure chevron **at the left** (▸ closed / ▾ open; click or Enter/Space; remembered per
  organization as today), then the name, then at the right the **needs-you count** with a tooltip and accessible name
  "2 things need you" (or the announcement dot). The **+ New workspace** button shows only on hover or keyboard focus of
  the row (and always on touch screens), so the row stays clean.
- **Its workspaces:** one step in (the name starts under the organization's name, past the chevron), with a **thin
  vertical guide line** on the left joining them to the organization. Same height and size as every row, muted until
  hovered or selected; the selected one uses the main navigation's selected look. Up to 5, most recently opened first
  (as today).
- **One closing link, "All workspaces"**, styled as a muted row in the group, for everyone (members see the Workspaces
  tab too): "All workspaces" when all are shown, "All workspaces · 3 more" when some are hidden. It replaces both "See
  all" and the admin-only "All workspaces". It opens the organization's Workspaces tab.
- **Empty organization** (you're in none of its workspaces): the group shows only "All workspaces".
- Keyboard: Tab moves row to row; the chevron and + are reachable; the guide line is decoration only.

## 3. The rest of the list

- **Archived (N)** keeps its own disclosure, with the same chevron at the left and its rows one step in, names only.
- **Join with code** stays last, as a muted row with **+**.
- "No workspaces yet" stays as the empty line.

## 3a. Gaps found, and enhancements (added after the user approved §1–§3)

The user asked for improvements, enhancements and gaps. From the code (`readSidebarWorkspacesAction`, `AppSidebar.tsx`):

| # | What happens today | Solution |
|---|---|---|
| G1 | **The list goes stale.** It's read once (`staleTime` 60s, no refetch on focus, nothing ever invalidates `sidebar-workspaces`): a workspace you create, join, rename, archive or leave, and the needs-you count, don't change until a full reload. | Refresh it after each of those actions (invalidate `sidebar-workspaces` where they finish), when the window regains focus, and every 2 minutes while visible — the same as the Overview. |
| G2 | **The workspace you're on can be missing.** Only 5 of an organization's workspaces show, personal workspaces stop at 12, and an organization group remembered as closed hides its children — so the page you're on may have no row, or no highlight. | The current workspace always shows: its group opens (without changing the remembered choice), and it's added to the shown rows if it wasn't in them. |
| G3 | **Personal workspaces past 12 disappear silently** (`.slice(0, 12)`, no "More"). | After 12, "More (N)" as organizations already have; it shows the rest in place. |
| G4 | **The order jumps.** "Most recently opened" is `greatest(your last visit, the workspace's updated_at)`, so someone else's edit moves a row while you look. | Order by **your own** last visit only; rows move only when you open something. |
| G5 | **Only organizations say something's new.** A personal or child workspace with updates you haven't seen has no sign. | The same small dot (unseen updates since your last visit) on personal and child rows, with "New updates" in its accessible name; no counts there. |
| G6 | **Nothing separates organizations from your own workspaces** once pictures go. | 8px of space between the organization groups and the rest; organization rows are also the only ones with a chevron. No extra labels. |
| G7 | **Collapsed sidebar can't reach workspaces at all** once the section hides (D1). | One **Workspaces** icon in the collapsed strip opens a small panel with the same list (names, groups, counts); Esc or a click outside closes it. |
| G8 | **Long lists have no quick way in.** | When there are more than 10 rows, a small **Filter** box appears under the WORKSPACES label; typing narrows the list (organizations stay as headers of matching children); Esc clears. |
| G9 | **No row actions.** | A **⋯** on hover/focus (always on touch): **Pin to top**, **Copy link**, **Open in new tab**. Pinned rows sit first, under a quiet "Pinned" line, saved on your account (so every device agrees). Unpin from the same menu. |
| G10 | **Screen readers hear a flat run of links.** | The list is a list; each organization's workspaces are a nested list named "Workspaces in CSE 3B"; the chevron says "Show/Hide CSE 3B's workspaces" with `aria-expanded`. |
| G11 | **Archived's open/closed isn't remembered.** | Remembered like organization groups. |

**Data:** G4 and G5 change one read (`readSidebarWorkspacesAction`: order by `last_seen_updates_at`; an `unseen`
flag per workspace from `workspace_updates` after your last visit, using the same audience rule as organizations).
G9 needs a small `pinned` list on the account (profile preferences), read with the sidebar. The rest is client-side.

## 4. Done when

- No picture or letters on any workspace, organization, outside or requested row; names cut with "…" and shown whole on
  hover.
- Organization rows: chevron at the left, count with its meaning, + only on hover/focus (and on touch); workspaces one
  step in with the guide line, same size as other rows; one "All workspaces" link (with "· N more" when needed) for
  everyone.
- Collapsed sidebar: no Workspaces section, and one Workspaces icon that opens the list in a panel (G7).
- G1–G11: the list refreshes after create/join/rename/archive/leave and on focus; the current workspace always shows and
  its group opens; "More (N)" past 12; order by your own visits; dots on personal and child rows with unseen updates;
  space between organizations and the rest; Filter past 10 rows; ⋯ with Pin to top / Copy link / Open in new tab and
  pins on the account; nested lists with names; Archived remembered.
- Tests: browser (names only, no `img` or letters in the list; the group's indent, guide line and order; the count's
  label; + appears on hover and focus; one "All workspaces" with "· 3 more"; collapsed hides the section; keyboard; axe;
  phone drawer).

## 5. Decisions for the user

- **D1 · Collapsed sidebar.** Hide the Workspaces section (proposal), or show each organization's first letter?
- **D2 · + New workspace.** Only on hover/focus (proposal), or always visible?
- **D3 · "All workspaces" for members.** Show it to everyone (proposal), or admins only as today?
- **D4 · Pin to top (G9).** Saved on the account (proposal), or this browser only?
- **D5 · New-updates dots on personal and child rows (G5).** Show them (proposal), or keep the dot for organizations only?
- **D6 · Filter box (G8).** Only past 10 rows (proposal), or always?

## Built and checked (5 November 2026)

Everything above, on local main, not pushed. D1–D6 as proposed. **Migration 0065 (`0065_sidebar_pins_and_visits`)
must be applied in production before deploying**: `workspace_members.last_opened_at` and the `sidebar_pins` table.

- **§1–§3** (`SidebarWorkspaces.tsx`): names only on every row (no picture or letters); the organization row has the
  chevron at the left, the count with "N things need you", and + and ⋯ that take no room until hover or keyboard focus
  (always on touch); its workspaces one step in under a 1px line, same size as other rows; one "All workspaces" (with
  "· N more") for everyone; Archived and Join with code in the same style.
- **G1:** the list refreshes on focus, every 2 minutes while visible, on navigating once it's 15 seconds old, and right
  after create, join, leave, rename (settings), archive/restore/delete (workspace and organization), accept/detach on
  the Workspaces tab, a pin, and reading a workspace's Updates (`useRefreshSidebar`; the query moved under the profile
  key, so profile-wide refreshes include it).
- **G2:** the workspace you're on always shows (past the first 5 or 12) and opens its group without changing what's
  remembered. **G3:** More (N) past 12. **G4:** ordered by your own visits (`stampOpened` on opening a workspace, at most
  every 5 minutes). **G5:** a dot on personal, outside and child rows with posts by others after you last read Updates;
  opening a workspace's Updates now records it (only organizations did before). **G6:** 8px between organizations and
  the rest. **G7:** the collapsed strip shows one Workspaces button that opens the list in a panel. **G8:** Filter past
  10 rows (Esc clears; organizations stay as headers of matching children; "No workspaces match"). **G9:** ⋯ → Pin to
  top / Unpin, Copy link, Open in new tab; pins on the account (`sidebar_pins`, up to 10, membership checked), first
  under "Pinned". **G10:** nested lists named "Workspaces in …"; the chevron says "Show/Hide …'s workspaces".
  **G11:** Archived's open/closed remembered.

**As built, differently from the wording above:**
- "Requested" rows use the muted text colour instead of fading the whole row (the faded row failed the contrast check).
- A pinned workspace inside an organization also stays in its group (the pin is a shortcut); a pinned organization moves
  to the top with its group.
- The collapsed strip already hid the list before; the new part is the Workspaces button and its panel.

Tests: browser — seven sidebar tests (names only, the group, the current row, dots and the row menu with pins, More /
Filter / Archived, spacing and keyboard with axe, collapsed strip). DB — order by your own visits and the 5-minute
stamp, dots (not your own posts; cleared on reading), all children and personal rows returned, pins (membership, limit,
order, unpin, cascade). Not checked here: your signed-in screens.
