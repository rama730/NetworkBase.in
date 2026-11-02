# Deploy 1d — Wording

**Goal:** the 1d items from the master plan (step 1d). No database change.
**Tests:** `tests/unit/organization-1d-wording.test.ts` (source and rule checks, written first), plus the terminology check.

| # | Item | Change |
|---|---|---|
| 1 | Plus button (parity bug 1, 31.5) | Sidebar plus sends the handle, not the id, so the owner isn't told "not a member" |
| 2 | Sidebar loading (parity bug 10, 31.5) | A placeholder while loading, never "No workspaces yet" before data arrives |
| 3 | Long titles (parity bug 12) | Rail headings cut off with "…" instead of widening the page |
| 4 | Wizard and ready screen (27.2, 27.3) | "Select Create organization"; Discover line by visibility; ready screen says the join mode and how many addresses were skipped |
| 5 | Names and welcome notes (27.8, decision 55) | Names 3–100 characters everywhere; welcome note 500 |
| 6 | Smaller bug 12 | "Returned", never "Returned for changes" |
| 7 | Smaller bug 20 | Organization feeds drop the follower and progress wording |
| 8 | Parity wording 6, 13–17 | "Workspace or workspace", counts with the right plural, Discover line, "0 of 0 done" explained |
| 9 | Terminology check (39.5, 44, 108, 110) | Retired organization words added to the check: "Returned for changes", "Guest", "progress post" |
| 10 | 18 and over (163) | Education card "A college or university class"; join page and invite email "You must be 18 or older to join"; Report reason "This person may be under 18" |
| 11 | Privacy Policy draft (167) | Section from 29.4 in `docs/`, not published until a lawyer reviews it |
| 12 | Focus ring (32.3, decision 75) | **Not built, owner's call (2 November 2026):** focus stays as it is, with no outer ring; `global-outline-elimination-contract.test.ts` keeps guarding it. Decision 75's second half (shared dialogs) still goes in step 14 |
