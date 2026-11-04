# Organization address, Discover and the verified badge, explained end to end — findings, 5 November 2026

Sources: the user's screenshot of CSE 3B → Settings (Handle and Verified badge, "Add your website in Links first"),
their notes, the live check of Discover (4 November) and the code. No code changed. A visual was shown in chat.

This report **takes in and replaces** `2026-11-04-org-discover-status-findings.md` (the "On Discover" row is §4 here).

## 0. What was asked

| The user's words | Section |
|---|---|
| "The Discover page isn't showing the organization card… the root cause" | §1 |
| "Explain it in Settings" | §4 |
| "We can allow anything for verification… a class, a company, a mini startup without a website" | §5 |
| "What is the use of this verification and how to apply it… the user doesn't know what it is" | §2, §5 |
| "On creation we give the user a handle… what is the use of that?" | §2, §3 |
| "The complete structure is mismatching… where the design should change" | §3–§6 |

---

## 1. Root cause of the empty Discover (confirmed live)

CSE 3B is Public and in good standing but doesn't pass decision 160 (`orgQualifiesSql`, `orgDiscoverable`): a new
organization shows on Discover once it is **verified**, or **7+ days old with 3+ members** (the rule D7 replaces; §8a). On 4 November it was
4 days old, had 2 members and wasn't verified. The rule works; **nobody is told about it**, and the badge that would skip
the wait is a dead end without a website.

## 2. What each thing is for (the words the screens will use)

| Thing | What it is | What it's for | What it is not |
|---|---|---|---|
| **Web address** (today "Handle" / "Organization URL" / "@") | `networkbase.in/org/cse-3b-2026` | The link you share; link previews; "Show everything from CSE 3B" on Discover | Not how people join, not a sign-in name, not an @mention |
| **Join code** | `NZWHM9` | How people get in (`/join`) | Not public; not the address |
| **On Discover** | Whether the organization is listed under Discover → Organizations (and search engines) | Being found by people who don't have the link | Not needed for a class to work |
| **Verified badge ✓** | NetworkBase checked the organization is who it says it is | Trust for organizations people could fake (colleges, companies, public communities); also skips the Discover wait | Not a quality mark; not required |

## 3. Creation

**What happens.** The Identity step asks for "Organization URL *" with an "@" and "Your organization's address" —
three names, an "@" that suggests mentions, and the full link is never shown. Nothing mentions Discover or the badge. The
created screen shows the join code only.

**Design.**
- Identity step: the field is **Web address**, shown as the whole link that updates while typing:
  `networkbase.in/org/[cse-3b-2026]` (the editable part in the box, the rest as fixed text). No "@". Help: "The link
  you share with people. Letters, numbers and dashes. You can change it later." The live check stays ("Available" /
  "Taken — try cse-3b-2026-b").
- Created screen: under the join code, a second row **Your organization's link** `networkbase.in/org/cse-3b-2026`
  with **Copy link**; then one quiet line (D7 wording): "It shows on Discover once it has a description and a workspace or a second member, or once it's
  verified. Settings → Visibility and discovery."
- Review step (`Phase5Review`): "@cse-3b-2026" becomes "networkbase.in/org/cse-3b-2026".

## 4. Settings → Visibility and discovery

**What happens.** Handle and Verified badge sit inside **Details** with no menu entry of their own, so the menu
highlights "Organization profile" while you read them (the screenshot). Discover status isn't shown anywhere. The
visibility card uses workspace words ("Workspace visibility", "Anyone can discover…").

**Design.** Rename the **Access and visibility** section (organizations only) to **Visibility and discovery** — "Who
can find the organization, and how." Everything about outsiders finding it, in this order:

1. **Visibility** — Public: "Anyone can view its public pages. It shows on Discover once it qualifies (below)." Private:
   "Only members see it. It never shows on Discover." (Organization words; workspaces keep theirs.)
2. **On Discover** — one status line, first that applies:

   | State | Line | Action |
   |---|---|---|
   | Private | "Not on Discover. Private organizations never show there or in search engines." | — |
   | Archived / scheduled for deletion | "Not on Discover while it's archived." / "…scheduled for deletion." | — |
   | Suspended / hidden by NetworkBase | "Not on Discover while it's suspended." / "NetworkBase hid it from Discover." | **See Moderation** |
   | Waiting | "Not on Discover yet. Organizations show once they have a tagline or description, and a workspace or a second member, or once they're verified." then `Description · Add a tagline or description` · `Workspace or second member · New workspace / Invite people` · `Or get verified · Verified badge ↓` (met parts show ✓) | as listed |
   | Listed | "✓ On Discover. People find it under Organizations, and search engines can list it." | **View on Discover** |

   When the last part is met: "It can take a few minutes to appear."
3. **Web address** — the link with **Copy**, then the change field (owner: once every 7 days, old link redirects for 90
   days; admins read "Only the owner can change it").
4. **Verified badge** — §5.
5. **What visitors can see** — unchanged.

**Details** keeps only the image, name, tagline, description and tags. Handle and badge leave it.

## 5. The verified badge

**What happens.** Owner only; one line, "Add your website in Links first", whatever the organization is. Behind it:
instant when the owner's email domain matches the website, otherwise the NetworkBase team reviews it — but staff see
only the name, links and the owner's email. The server already accepts a request without a website; only the screen
blocks it.

**Design — the card explains itself, then offers four ways in:**

- Top: "A ✓ beside the name that tells visitors NetworkBase checked you're real." Then **Do you need it?** "Useful for
  colleges, companies and public communities. A class usually doesn't need it: it reaches Discover by itself once it has a description and a workspace or a second member."
- **Ways to verify** (choices; the best fit first, by organization type — Education puts 1 and 2 first):

  | Way | How | Result |
  |---|---|---|
  | **1. School or work email** | Enter any address on your organization's domain (`@rvce.edu.in`, `@acme.com`), not Gmail, Outlook and the like. We email a 6-digit code; enter it here. It needn't be your sign-in email. | Verified at once · "Verified · rvce.edu.in" |
  | **2. Confirmed by your parent organization** | When "Part of" is linked to an organization on NetworkBase that is itself verified, ask it; one of its admins confirms from their Overview. | Verified when they confirm · "Verified · Part of Northgate Institute" |
  | **3. A code on your website, GitHub or domain** | We show a short code; put it on your website's home page, your GitHub organization's description, or a DNS TXT record. **Check** looks for it. | Verified at once · "Verified · github.com/acme" |
  | **4. Ask our team** | Always open, no website needed: who you are and how to check (links, a contact). Optional document (a letter, registration certificate). | Reviewed by the NetworkBase team; a decline says why |

- States: not requested · code sent ("Enter the code sent to r…@rvce.edu.in · Resend in 0:45") · waiting for parent ·
  requested (team) · **verified** ("Verified · rvce.edu.in · since Nov 5" with what it was checked against) ·
  declined or removed (the reason, **Try another way**).
- Who: the owner asks; admins see the card and the state with "The owner can ask for this."
- The badge text everywhere stays a plain ✓; its tooltip and the About page say what it was checked against.
- Rechecks stay as today (decision 56): a renamed organization goes back to review; a method tied to a domain is lost
  when that domain leaves the organization's links or email.

**Why not "allow anything":** a ✓ anyone can get lets someone call themselves "RV College" with a ✓. Each way above is
still a real proof; the fourth is always open, so nobody hits a dead end.

## 6. Gaps found, and their solutions

| # | What happens today | Solution |
|---|---|---|
| G1 | Three names and an "@" for the address | **Web address**, shown as the full link (§3) |
| G2 | Nothing explains Discover's rule | **On Discover** row (§4) |
| G3 | Handle and badge hidden inside Details; the menu highlights the wrong item | Moved to **Visibility and discovery**, with their own places (§4) |
| G4 | Badge card is a dead end without a website | Four ways in; team review always open (§5) |
| G5 | The badge never says what it's for or who needs it | Card explains it and says a class usually doesn't (§5) |
| G6 | Admins never see the badge | They see it read-only (§5) |
| G7 | Staff review sees only name, links, email | The request carries the method, the explanation, links and the optional document |
| G8 | "Part of" is free text, so no parent organization can confirm | "Part of" can be linked to an organization on NetworkBase (search as you type; free text still allowed) |
| G9 | Created screen shows only the join code | Adds the link with Copy and the Discover line (§3) |
| G10 | Visibility card uses workspace words | Organization words (§4) |

## 7. Data and server

- `OrgDetail` adds `createdAt`, `discoverHidden`, `verificationMethod`, `verifiedAgainst`, the pending request
  (`method`, `at`, masked email for a code), and `parentOrg` (linked "Part of").
- One pure rule, `orgDiscoverStatus(detail, visibility, now)`, built on `orgDiscoverable`; the numbers 3 and 7 become
  named constants used by both the SQL and the rule.
- **Email code:** `requestOrgEmailCodeAction(orgId, email)` and `confirmOrgEmailCodeAction(orgId, code)`; codes hashed,
  10 minutes, 5 tries, 3 sends an hour; free-mail domains refused (the existing list). New table
  `org_verification_codes` (migration).
- **Parent confirm:** `askParentOrgAction(orgId)`; the parent's admins get a Today row and notification; Confirm or
  Decline with a reason.
- **Code check:** `checkOrgProofAction(orgId, where)` — website home page (fetch with the existing link-safety rules),
  GitHub organization description (public API), DNS TXT (`dns.resolveTxt`). LinkedIn can't be checked automatically,
  so it goes to team review.
- **Team review:** `requestOrgVerificationAction` takes `{ explanation, links, document? }`; the staff Inbox shows them.
  Documents: staff-only storage, deleted 30 days after the decision (D4).
- `verification_method` and `verified_against` columns on `workspaces` (same migration).

## 8. Done when

- Creation shows the Web address as a full live link with no "@"; the created screen has Copy link and the Discover
  line; Review shows the link.
- Settings → **Visibility and discovery** holds Visibility, On Discover, Web address, Verified badge and What visitors
  can see, in that order; Details holds only the profile basics; the menu highlights the right item while scrolling.
- CSE 3B (description, 1 workspace, 2 members) reads "✓ On Discover" under D7, and appears on Discover; an organization missing its description or with nothing in it reads "Not on Discover yet" with the missing parts and their actions; every other state in §4 renders.
- Each of the four ways works end to end, with its states, limits and rechecks; staff see the request's evidence.
- Tests: unit (status rule, email domain rule, code limits); DB (status says Listed exactly when the feed includes the
  organization; each way to verify, who can, limits, rechecks); browser (creation field and created screen, the
  section for owner and admin, each badge state, phone, axe).

## 8a. When a new organization reaches Discover (the rule itself)

**The user's point:** a class doesn't need the badge, but a real organization should show on the normal Discover page.
Today it can't for its first week: CSE 3B (2 members, made 31 October) shows only from Saturday 7 November, and only
once a third person has joined. The rule (decision 160) keeps empty and throwaway organizations out of the public feed;
its cost is that a properly set-up class is hidden for a week.

**Options** (the user liked all four and chose **option 1** at D7):

| # | Rule | CSE 3B | Keeps out |
|---|---|---|---|
| **1 · Shows once it looks real** (proposal) | Public, **and** a tagline or description, **and** at least one workspace **or** at least 2 members. No waiting days. Verified still always shows. | Shows **today** (description, 1 workspace, 2 members) | Empty test organizations (no description, nothing in them) |
| **2 · Lower the bar** | 2 members, no waiting days | Shows today | One-person test organizations |
| **3 · Classes show at once** | Organizations of type Education skip the wait; other types keep 3 members and 7 days | Shows today | Non-class organizations still wait a week |
| **4 · Keep the rule** | 3 members and 7 days, or verified; only explained in Settings (§4) | From Sat, Nov 7 with a third member | Most; at the cost of a week's wait |

**Why option 1:** it uses signs a real organization has from day one (someone wrote what it is and put something in
it) instead of a calendar, so a teacher who sets up a class properly is listed the same day, while a bare test
organization still isn't.

**What changes with the chosen rule:**
- One rule in two places that must agree: `orgQualifiesSql` (`src/lib/discover/listed-sql.ts`, used by Discover's
  feed, search and the public feed) and `orgDiscoverable` (`src/lib/organizations/profile-rules.ts`, used by the
  Settings row). Its numbers become named constants used by both.
- Search engines follow it too (`orgIndexableSql`, the sitemap), so the organization's page becomes indexable at the
  same moment it reaches Discover.
- The **On Discover** row (§4) lists the parts of the chosen rule. For option 1 while waiting:
  `Description ✓ · Workspaces 1 ✓ · Members 2 ✓` — or, when something's missing, `Add a tagline or description ·
  Go to Details` and `Add a workspace or invite someone · New workspace / Invite people`. No "days" line.
- The creation screen's line (§3) and the badge card's "Do you need it?" (§5) use the chosen rule's words, e.g.
  for option 1: "It shows on Discover once it has a description and a workspace or a second member."
- Existing tests that pin decision 160 (`tests/unit/organization-profile.test.ts`,
  `tests/db/public-feed-org-rule.test.ts`) change to the chosen rule; a DB test checks the Settings row says "On
  Discover" exactly when the feed lists it.

## 9. Decisions (approved by the user, 5 November 2026: "I like everything")

All as proposed:
- **D1 · Name of the section:** **Visibility and discovery** (not "Access and visibility").
- **D2 · What the ✓ shows:** a plain ✓; what it was checked against is in its tooltip and on About.
- **D3 · Ways to verify in the first release:** all four.
- **D4 · Documents in team review:** allowed, seen only by the reviewing staff, deleted 30 days after the decision.
- **D5 · Who sees the On Discover row and the badge card:** owners and admins (admins read-only for the badge).
- **D6 · The Overview:** Settings only; no Overview nudge.

- **D7 · When a new organization reaches Discover (§8a):** **option 1, "shows once it looks real"** (chosen by the
  user, 5 November 2026) — Public, a tagline or description, and at least one workspace or at least 2 members; no
  waiting days; verified always shows. This replaces decision 160. The On Discover row, the creation line and the
  badge card use its words (§8a).

## 10. The visual (as shown in chat and approved)

Three screens, top to bottom. The visual was drawn with the old rule ("Members 2 of 3 · Age 4 of 7 days"); below it is
written with D7's parts instead, everything else as drawn.

1. **Creation → Identity.** Label "Web address"; on one line the fixed text `networkbase.in/org/` and the editable box
   `cse-3b-2026`; under it "✓ Available" in green; then the help "The link you share with people. Letters, numbers
   and dashes. You can change it later."
2. **Created screen.** Row one: "Join code **NZWHM9**" (mono, spaced) with **Copy code** at the right. Row two: "Your
   organization's link networkbase.in/org/cse-3b-2026" with **Copy link** at the right. Under them, quiet text: "It
   shows on Discover once it has a description and a workspace or a second member, or once it's verified. Settings → Visibility and
   discovery."
3. **Settings → Visibility and discovery** ("Who can find the organization, and how."), sections split by hairlines:
   - **Visibility:** two choice cards side by side — Public (selected, accent border): "Anyone can view its public
     pages. It shows on Discover once it qualifies." · Private: "Only members see it. It never shows on Discover."
   - **On Discover:** "◷ Not on Discover yet" in the warning colour; the rule line; then a three-column grid —
     Description · ✓ or **Go to Details**; Workspace or second member · ✓ or **New workspace / Invite people**; Or · Get verified, and it shows at
     once · **Verified badge ↓**.
   - **Web address:** the full link, **Copy**, **Change**; "Change it once every 7 days. The old link keeps working
     for 90 days."
   - **Verified badge:** "A ✓ beside the name that tells visitors NetworkBase checked you're real." A tinted box: "**Do
     you need it?** Useful for colleges, companies and public communities. A class usually doesn't: it reaches
     Discover by itself once it has a description and a workspace or a second member." Then "Ways to verify" as four bordered rows, each icon · title and one line · button:
     School or work email (**Use email**) · Confirmed by your parent organization, "Northgate Institute is verified
     here. One of its admins confirms you." (**Ask Northgate**) · A code on your website, GitHub or domain (**Get
     code**) · Ask our team, "Tell us who you are and how to check. No website needed." (**Ask**).
   - **What visitors can see:** unchanged.

## 11. From the discussion (kept so the build follows it)

- **Why not "allow anything" for the badge:** the ✓ is worth something only because it's checked; a ✓ anyone can get
  lets someone call themselves "RV College" with one. Every way in §5 is a real proof, and team review is always open,
  so nobody is stuck.
- **A class doesn't need the badge to reach Discover:** under D7 it shows by itself once it has a description and a workspace or a second member. The badge only
  skips that wait; for a class the On Discover row and Invite people are the main path.
- **How verification works today** (kept, extended): instant when the owner's email domain matches a website in Links
  (not free-mail domains); otherwise staff review, which today sees only the name, links and owner's email. The server
  already accepts a request without a website — only the screen blocks it (`requestOrgVerificationAction`,
  `OrgVerificationSection`).
- **Strength of each way:** school or work email — strong, instant · parent organization — strong once confirmed ·
  code on website, GitHub or DNS — medium to strong, instant · team review — as good as the reviewer.
- **Who each way fits:** classes and college clubs → school email or the parent organization · companies → work email
  or the domain code · startups with only Gmail → GitHub or website code, or team review · anyone → team review.
- **The web address is not:** how people join (the join code), a sign-in name, or something people @mention — which
  is why the "@" goes.

## Built and checked (5 November 2026)

Everything above, on local main, not pushed. **Migration 0064 (`0064_org_verification_ways`) must be applied in
production before deploying**: two columns on `workspaces` (existing badges back-filled as `owner_email` or `team`),
the `org_verification_codes` table, the `org_verify_code` email kind, and the private `org-verification-documents`
bucket.

- **D7 rule:** `orgQualifiesSql` and `orgDiscoverable` are the same rule with named constants
  (`ORG_DISCOVER_MIN_MEMBERS = 2`, `ORG_DISCOVER_MIN_WORKSPACES = 1`); the sitemap and page indexing follow it.
  `orgDiscoverStatus` gives Settings its state. A DB test checks the Settings row says "listed" exactly when the
  public feed lists the organization, step by step (no description → description → second member → workspace →
  blank tagline → verified).
- **Creation:** "Web address" with `networkbase.in/org/` before the box and no "@", "✓ Available" / "Taken — try
  …-b" (a suggestion checked to be free), "You can change it later"; Part of searches public organizations and links
  one (saved as `partOfOrgId`, checked on the server); the created screen adds the link with Copy link and the
  Discover line; Review shows the link. Rename and duplicate errors say "web address" too.
- **Settings → Visibility and discovery:** Visibility (organization words) → On Discover → Web address → Verified
  badge → What visitors can see, split by hairlines in one section (`OrgDiscoverySections.tsx`); Details no longer
  holds Handle or the badge, so the menu highlights the right item. Part of in Organization profile is linkable.
- **Verified badge:** the card explains itself and lists four ways (a class's type profile puts email and parent
  first — `verifyFirst` in the type profile, not a type check); every state in §5; admins read it with "The owner can
  ask for this." Server: `requestOrgEmailCodeAction` / `confirmOrgEmailCodeAction` (hashed 6-digit code, 10
  minutes, 5 tries, 3 sends an hour, 45 seconds apart; abandoning a code keeps its sends so the cap can't be reset),
  `askParentOrgAction` / `decideParentVerificationAction` (the parent's Today row with Confirm and Decline + reason,
  and notifications both ways), `checkOrgProofAction` (website home page through the safe-fetch rules, GitHub's API,
  DNS TXT), `requestOrgVerificationAction` (explanation, links, optional document) and
  `cancelOrgVerificationAction`. The original instant rule (owner's email domain matches the website) still applies.
- **Staff:** the Inbox shows the explanation, links, Part of and a 5-minute link to the document; approving records
  `team`; the document stays 30 days after the decision and the daily download-history job deletes it (no new
  scheduled function).
- **✓ everywhere:** the header, Discover cards (main feed and the cached first page) and About say what it was
  checked against ("Verified · rvce.edu.in", "Verified by the NetworkBase team"). About's "Handle @…" became "Web
  address networkbase.in/org/…" with Copy.
- **Rechecks follow the way:** a website-based badge goes when the website leaves Links; an email code or DNS badge
  survives a rename; team, parent and GitHub badges go back to review on a rename.

**As built, differently from the wording above:**
- Two labels are sentence case for the wording check: the block's heading is **Shown on Discover** (not "On
  Discover") and the action is **Go to Moderation** (not "See Moderation"), like "Go to Details".
- The admin's view of a pending email code says "A code was sent to h…@rvce.edu.in" (only the owner enters it).
- "Resend" after the wait is **Use a different address or resend**: it ends the pending code (keeping the hourly cap)
  and shows the email form again.
- Documents ride in the request itself (up to 3.5 MB, PDF, JPG, PNG or WebP) rather than a separate signed upload.
- LinkedIn can't be checked automatically: it's a link in team review.
- When a parent loses its own ✓, organizations it confirmed keep theirs (nothing cascades).

Tests: unit — the D7 rule and every On Discover state; email domain, limits, proof matching, rechecks by way, the ✓
label; Settings order; the code email. DB — Settings agrees with the feed; the indexing test; each way end to end
(who can, limits, wrong codes, the parent's Today row, decline and confirm, DNS proof per organization, team review
with document, staff-only document link, approval, 30-day purge). Browser — creation field, Part of linking and the
created screen; every On Discover state; Web address (owner and admin); the badge card's four ways and every state;
phone width and axe. Not checked here: your signed-in screens, a real code email, or a real website/GitHub/DNS check.

### Follow-up: security review of the verification code (5 November 2026)

An automatic review of `c51aed3f5` found four issues; all fixed:
- **No ✓ for an organization that isn't live.** `markVerified` now only verifies an organization that isn't deleted,
  suspended or archived, and the parent's Confirm checks both sides are live (a child suspended since asking gets
  nothing).
- **No orphaned documents.** Try another way, a new team request and a parent ask delete the pending request's
  document at once; starting a new team request also deletes an earlier decision's document.
- **The bytes decide a document's type.** PDF, JPEG, PNG and WebP are recognised from their first bytes (HTML named
  `.pdf` is refused), stored under that type with a generated name, and staff always get it as a download.
- **Way 1 matches the website.** With a website in Links, the code must go to an address on its domain, and that's
  checked again on confirm; with none (a class without a site), any school or work domain still works and the ✓ says
  which.
- Also found while fixing: each wrong code now counts in one statement, so parallel guesses can't share a try.
