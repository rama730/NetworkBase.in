# Small things across NetworkBase: audit (2026-11-23)

What the user asked: before the big pages, refine the small things everywhere (loading, success, skeletons, and every small interactive piece, not just buttons) with one design touch. This lists what exists today, where it disagrees with itself, and what each should become. Counts are from `src/` on local main today.

Skeleton prototype: https://claude.ai/artifact/Fc9H7ZhYRRPyUHjxdDU9Sn (v2: profile, My work, Network, Task board, Messages; light and dark; reduced motion; people, workspaces and organizations draw in).

## 1. Waiting

| # | Piece | Today | Problem | Should be |
|---|---|---|---|---|
| 1.1 | Route loading screens | 11 `loading.tsx` for 58 pages | 47 pages show nothing or a bare spinner; the 11 that exist each drew their own shapes (profile and edit were redrawn today) | Every page gets a skeleton in its real layout, built from shared parts (band, tab bar, list row, card, panel), per the prototype's rules |
| 1.2 | In-page skeletons | `Skeleton` in 44 files (337 blocks) + 21 hand-made `animate-pulse` blocks in 18 files | Two looks: the shimmer and a pulse; bars are rounded grey blobs sized by guess | One `Skeleton`; bars at the text's cap height; one page-wide sweep; `animate-pulse` gone |
| 1.3 | Spinners | `Loader2` 117 times in 60 files, `RefreshCw` 8, `LoaderCircle` 1 | Spinners stand in for whole sections, inside buttons, and next to text, at different sizes | Sections: skeleton. Buttons: keep their width, show a 3-cell pixel beat and a verb ("Saving"). Spinners only for unknown-length background work |
| 1.4 | Timing | none | Fast answers flash a skeleton; long ones look frozen | Show after 300 ms, keep at least 400 ms, settle 220 ms; after 3 s a quiet line says what is loading |
| 1.5 | "Loading…" text | 43 strings in 35 files | Mixed words and ellipses ("Loading…", "Loading..."), often instead of a skeleton | One wording rule: "Loading {thing}…" only for the slow line or screen readers |
| 1.6 | `aria-busy` | 67 uses in 53 files | Many loading areas don't announce | Every skeleton region `aria-busy` with a visually hidden "Loading {thing}" |
| 1.7 | Load more / Show more | 47 buttons in 37 files | Some replace the list with a spinner, some append | Keep the list; append skeleton rows; the button shows the pixel beat |
| 1.8 | Upload progress | `progress`/`%` in about 59 files, `role=progressbar` 7 | Bars, percentages and spinners mixed | One upload row: file name, a slim bar, %, Cancel; then a tick |
| 1.9 | First-load draw-in | Built today: people, workspaces, organizations and org workspaces without a picture | — | Keep; it's the one motion every page shares |

## 2. Done and didn't work

| # | Piece | Today | Problem | Should be |
|---|---|---|---|---|
| 2.1 | Success toasts | `toast.success` 295 times in 116 files | Copy varies for the same act: "Saved", "Profile updated", "Saved as v3", "Link copied", "Copied", "Copied to clipboard" | Past tense, object first, no exclamation ("Link copied", "Changes saved"); a toast only when the result isn't visible on screen |
| 2.2 | Inline confirmations | Profile has "Saved just now" with a tick that pops; elsewhere mostly toasts | Two systems | Where the change is visible, confirm in place (tick + "Saved"), no toast |
| 2.3 | Undo | 40 undo actions in 27 files | Some acts can't be undone and ask a dialog instead | Reversible acts (hide, pin, remove link, decline): do it and offer Undo; irreversible: ConfirmDialog |
| 2.4 | Errors | `toast.error` 503 times in 151 files; `role="alert"` 165 in 112 | Same failure shown as a toast in one place, inline in another; some say "Action couldn't finish" with no next step | Field errors inline under the field; action errors inline near the button with "Try again"; toast only for background failures. Every message says what to do next |
| 2.5 | Info/warning toasts | 102 in 48 files | Used for things that should be inline hints | Audit each; most become inline notes |
| 2.6 | Confetti | `canvas-confetti` in 2 files | Off-style | Replace with the pixel "moment" from the motion report |
| 2.7 | Copy-to-clipboard | `navigator.clipboard` in 3 files; "Copied" 17, "Link copied" 12 | Different feedback per place | One copy button: icon swaps to a tick for 1.5 s and says "Copied"; toast only if the button isn't visible |

## 3. Nothing here yet

| # | Piece | Today | Problem | Should be |
|---|---|---|---|---|
| 3.1 | Empty states | `EmptyState` in 23 files, `nb-empty-state` in 29, `nb-pf-empty` in 5, plus about 76 ad-hoc "No … yet" lines | Three looks: centred grid box, profile empty card, plain grey line | One empty state: pixel figure (person, desk or building), one line of what goes here, one action; an owner-only note when only you see it |
| 3.2 | Search with no results | mixed | Some show the empty state for "nothing yet" instead of "nothing matches" | Separate copy: "Nothing matches '…'" + Clear search |

## 4. Small controls

| # | Piece | Today | Problem | Should be |
|---|---|---|---|---|
| 4.1 | Buttons | `Button` 936 times in 201 files (outline 427, ghost 222, destructive 96, command 24); 22 bespoke `nb-*-btn`/`nb-*-ib` buttons in 7 files | Bespoke buttons differ in height, radius and hover; pending state differs (disabled only, or spinner, or text change) | One size scale (28/34/44 touch); pending = keep width, pixel beat, verb; press = 1 px down; bespoke ones map to variants |
| 4.2 | Icon buttons | many sizes (28, 32, 34, 44) | Hit area under 44 px on touch in places | 32 px visual, 44 px hit on touch, always an aria-label and a tooltip |
| 4.3 | Focus | `focus-visible:` 514 in 108 files; `outline-none` 321 in 146 | Some controls remove the outline with nothing in its place (the "no focus ring" decision left gaps) | One focus style per surface (ink underline or 2 px brand outline for keyboard only), checked on every control |
| 4.4 | Hover | varies | Some rows highlight, some don't, some change text colour | Rows: soft fill; links: underline; buttons: one step darker |
| 4.5 | Toggles | `SettingsSwitch` 27 in 19 files, ui `Switch` 2, 4 custom `role=switch` (profile tag toggle, contribution switch) | Three switch looks and sizes; the switch colour isn't the same everywhere | One switch; the profile's tag toggle stays as the special case it is |
| 4.6 | Segmented controls / toggle buttons | `aria-pressed` 88 in 57 files | Several looks (portfolio sort, filters, prototype segs) | One segmented control and one filter chip (with count) |
| 4.7 | Chips and tags | `choiceChipClass` 5, `nb-tag` 34 in 22, `SkillChip`, `Badge` 12 | Plus icons on some, checks on others; pill vs square (open question in memory: `.nb-tag` still pill) | Two chips only: a choice chip (check when on) and a read-only tag; square, 3 px radius |
| 4.8 | Selects | native `<select>` 143 in 61 files; ui `Select` 16 in 8 | Two looks for the same control | Styled native select (fast, accessible) everywhere; ui Select only where search is needed |
| 4.9 | Inputs and counters | `Input` 140 in 62 files; counters differ ("7/80", "7 / 80"); some always shown | Inconsistent | Count shows on focus or near the limit, "7 / 80" in mono |
| 4.10 | Date and time | `DateTimeField` in 6 files | Other date entry differs | One date field everywhere |
| 4.11 | Tooltips | ui `Tooltip` 8 in 5 files; `title=` 613 in 206 | Browser tooltips: slow, unstyled, missing on touch | Styled tooltip for icon buttons and truncated text; `title` only as fallback |
| 4.12 | Menus | `DropdownMenu` 107 in 75 files | Item spacing, icons and destructive items vary | One menu item style; destructive last, red, separated |
| 4.13 | Keyboard hints | `<kbd>` 36 in 18 files | Different looks | One `kbd` style |
| 4.14 | Dialogs and panels | ui `Dialog` 140 in 107 files; side panels (contribution panel, My work) built by hand | Open/close motion and widths differ | Three sizes (confirm, form, side panel) with one enter/exit motion and one header style |
| 4.15 | Person hover cards | `HoverCard`/`PersonCard` in 13 files | Delay and content vary | One card, 400 ms open delay, same fields everywhere |
| 4.16 | Drag and drop | `onDrop` in 18 files | Drop targets look different; no common "drop here" state | One dashed drop target and one dragging state |
| 4.17 | Tabs | 20 hand-made tab lists (`role="tablist"`) | Profile tab bar, workspace tabs, My work tabs, settings tabs differ | Two tab styles: the profile's cell tab bar (pages) and an underline tab (inside panels) |
| 4.18 | Counts and unread dots | badges in the sidebar, tabs, bell | Zero-padded "05" in some, "5" in others | One rule per place (mono, zero-padded in the tab bar only) |
| 4.19 | Optimistic updates | `useOptimistic` 0; `useTransition`/`isPending` 176 in 80 | Some toggles wait for the server, some flip at once, rollback differs | Flip at once, roll back with an inline error and Try again |

## Suggested order

1. Waiting (1.1–1.8): the skeleton prototype is ready; after "implement", shared parts first, then the 11 existing loading screens, then the 47 pages without one.
2. Done and didn't work (2.1–2.7): one feedback rulebook, then a sweep of the 900 toast calls.
3. Empty states (3.1–3.2).
4. Controls (4.1–4.19), starting with buttons' pending state, focus and selects, which touch the most screens.

Each group gets its own prototype before building, like the skeletons.
