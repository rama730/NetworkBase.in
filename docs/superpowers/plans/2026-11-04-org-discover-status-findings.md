# Organization → Settings: say whether it's on Discover, and why not — findings, 4 November 2026

> **Replaced** by `2026-11-05-org-address-discovery-verification-findings.md` (5 November 2026), which holds this
> report's "On Discover" row (§4 there) together with the web address and the verified badge. Build from that one.

Source: the user found no organization cards on Discover. Checked live in Chrome (signed in) and in the code. No code
changed.

## 0. What was asked

| The user's words | Section |
|---|---|
| "On the Discover page it's not showing the organization card… check the root cause" | §1 |
| "Explain it in Settings" (chosen over relaxing the rule) | §2–§6 |

---

## 1. Root cause (confirmed live)

Discover → Show: Organizations lists **none**. CSE 3B · Data Structures 2026 is Public and in good standing, but it
doesn't pass decision 160 (`orgQualifiesSql` in `src/lib/discover/listed-sql.ts`, the same rule as
`orgDiscoverable` in `src/lib/organizations/profile-rules.ts`): a new organization shows on Discover once it is
**verified**, or is **7+ days old with 3+ members**.

| Needs | CSE 3B on 4 Nov |
|---|---|
| Verified | No (the badge asks for a website in Links first) |
| 7+ days old | 4 days (made 31 Oct) |
| 3+ members | 2 |

So the rule works as written. **The gap:** nothing tells an owner or admin that the organization is held back, why,
or what to do. Settings → Access and visibility even says the opposite: the Public choice reads "Anyone can discover…".
Search engines follow the same rule (`orgIndexableSql`, the sitemap), so the organization is missing there too and
nobody is told.

## 2. Design — "On Discover" in Access and visibility

**Where:** Settings → Access and visibility, for organizations only, as its own row directly under the Public /
Private choice (above "What visitors can see"). Owners and admins see it; the actions in it follow what each may do.

**The row:** a small heading **On Discover**, then one status line with an icon, then — only while it's waiting — what's
left, each part with its own action:

```
On Discover
◷  Not on Discover yet. New organizations show once they have 3 members and are 7 days old, or once they're verified.
   Members   2 of 3      · Invite people
   Age       4 of 7 days · from Sat, Nov 7
   Or get verified, and it shows at once · Add your website in Links first
```

The status, first that applies:

| State | Line | Action |
|---|---|---|
| Private | "Not on Discover. Private organizations never show there or in search engines." | — |
| Archived | "Not on Discover while it's archived." | — |
| Scheduled for deletion | "Not on Discover while it's scheduled for deletion." | — |
| Suspended | "Not on Discover while it's suspended." | **See Moderation** |
| Hidden by NetworkBase | "NetworkBase hid it from Discover." (the wording Moderation already uses) | **See Moderation** |
| Waiting | as drawn above; a part already met shows ✓ and no action ("Members 5 of 3 ✓") | **Invite people**, **Go to Verified badge** / **Add your website in Links first** |
| Listed | "✓ On Discover. People find it under Organizations, and search engines can list it." | **View on Discover** |

Details:
- **Members** counts everyone in the organization, viewers too — the same count the rule uses. "Invite people" opens
  the Members tab's invite (admins and owner).
- **Age** shows the day it qualifies ("from Sat, Nov 7"), in the organization's time zone when it has one. Once 7 days
  have passed it shows ✓.
- **Verified:** owners get **Go to Verified badge** (or **Add your website in Links first**, the badge's own first
  step); admins read "Or the owner can ask for the verified badge". When a request is in, it reads "Verification
  requested".
- When the last part is met, the line notes "It can take a few minutes to appear" (Discover's first page is cached
  for up to 5 minutes).
- **View on Discover** opens `/discover?org=<handle>` (the existing "Show everything from …" view).

## 3. The same card's words, fixed for organizations

Today the card reuses the workspace text. For organizations:
- "Workspace visibility · Choose who can find and see this workspace." → **"Organization visibility · Choose who can
  find and see this organization."**
- Public: "Anyone can discover and view the public workspace surface." → **"Anyone can view its public pages. It shows
  on Discover once it qualifies (below)."**
- Private: → **"Only members see it. It never shows on Discover."**
- The footer "If the workspace is Private…" → **"If the organization is Private…"**
- Verified badge card: add one line — **"Verified organizations show on Discover straight away."**

Workspaces keep their current text.

## 4. Data

- `readOrgDetail` (`src/lib/organizations/detail.ts`) adds `createdAt` and `discoverHidden` (from
  `discover_hidden_at`) to `OrgDetail`; `memberCount`, `verified`, `verificationRequested`, `hasWebsite`, `suspended`,
  `archived` and `deletionScheduledAt` are already there.
- One pure rule, `orgDiscoverStatus(detail, visibility, now)` in `profile-rules.ts`, returns the state, members still
  needed, days left and the date; it uses `orgDiscoverable` so the line can't disagree with the feed.
- The two numbers (3 members, 7 days) become named constants used by both the SQL and the TypeScript rule.

## 5. Done when

- CSE 3B's Settings reads "Not on Discover yet… Members 2 of 3 · Age 4 of 7 days · from Sat, Nov 7 · Or get
  verified…", each with its action; each other state in §2 renders its line.
- The card's organization wording in §3.
- Tests: unit — every state and the date; DB — for a set of organizations, the status says "Listed" exactly when the
  public feed includes it (so Settings and Discover can't drift); browser — the row for owner and admin, each state,
  phone width, axe.

## 6. Decisions for the user

- **D1 · Who sees it.** Owners and admins (proposal), or owners only?
- **D2 · The Overview too.** Settings only, as asked (proposal), or also a one-line nudge on the Overview for owners
  and admins until it's listed?
- **D3 · View on Discover** when listed (proposal), or no link?
