# Network in the mix style: report (v4, mix not redesign)

Prototype: https://claude.ai/artifact/FsR7p2oauKhDYRCc5LpLbU (Today | Mix switch, "Mark changes" numbers each touch; example people only).

**Ruling (user, 2026-11-23):** today's Network page is good: the person card is well built in every state and matches Discover. Keep the structure (title, three tabs, search + Filters, 176 px cards, Your network rail). The mix is small touches only. No header band. Presence unchanged.

Seen live 2026-11-23 (signed in, Chrome): Suggested has no tab count or status line; Invitations shows "2 open invitations and applications" and mono group labels; Connections shows "2 connections shown"; rail counts are plain `2 / 1 / 0 / 0`.

## Touches 1–7 (v3, liked by the user)

| # | Where | Today | Mix | Code |
|---|---|---|---|---|
| 1 | Suggested tab + status | No count; no status line | `Suggested 06` like the other tabs; `06 people · best match first` like the other tabs' status lines | NetworkClient tab count, NetworkPeopleTab status |
| 2 | Suggested card, bottom-left | Empty unless there are mutual connections | The server's reason (`recommendationReason`, connections.ts ~L1147) in mono after a clay square. If the reason is only "N mutual connections", the mutual link shows as today. Card height stays 176 px | PersonCard passes `footer` to PersonCardContent |
| 3 | Rail counts | `2`, `1`, `0` | `02`, `01`, `00`; waiting counts (requests, invitations, applications) in clay, zeros quiet | NetworkClient rail, padCount |
| 4 | Invitations group labels | `CONNECTION INVITATIONS` | `CONNECTION INVITATIONS · 01` with the same hairline the rail label has | InvitationsClient section heads |
| 5 | Invitation card note | ⋯ › View note | `Read note` above the date, one click; ⋯ › View note stays | PersonCardReview footer |
| 6 | Filters button | `Filters` | `Filters · 02` when filters are on | NetworkFilters |
| 7 | Load errors | "People could not be loaded. Retry" | `NOT LOADED` tag · "People didn’t load. Nothing changed." · Try again (Settings' NOT SAVED pattern) | NetworkPeopleTab, ConnectionsClient, InvitationsClient |

## Touches 8–14 (v4, user: "invent new improvements")

| # | Where | Today | Mix | Code |
|---|---|---|---|---|
| 8 | Mutual connections line | Icon + "4 mutual connections" | Up to three 14 px faces of the mutual people before the count (the profile's Mutual stat does this) | PersonCardContent SharedConnections; needs up to 3 mutual ids per row |
| 9 | Suggested status line | — | Key: a dark square + "also your skill", so the dark skill tags explain themselves | NetworkPeopleTab status |
| 10 | Search | Results change, nothing says how many | Status line reads `02 of 06 match “py”`; no match shows the empty state with Clear search | NetworkPeopleTab, ConnectionsClient |
| 11 | Connections sort | Inside Filters only | `Recent · Name` segmented on the status line (stays in Filters too) | ConnectionsClient, same `sort` URL param |
| 12 | Waiting signals | Invitations count grey | Invitations tab count clay while anything waits on you; `NEW` tag on requests under 24 hours | NetworkClient tab, PersonCardReview footer |
| 13 | Answers | Accept/Decline: the card disappears and a toast says it (Undo only for Decline). Connect: button turns Requested ▾ | The card stays and says what happened: `CONNECTED · You and Leo are connected` with Message and Undo, or `DECLINED · Nina isn’t told` with Undo. After Connect the footer says `REQUEST SENT · Undo` for six seconds, then the card is as today. The card leaves on the next visit | InvitationsClient accept/decline, PersonCard connect; undo actions exist for decline; accept and connect need undo |
| 14 | Rail | Rows open the tab | Rows jump to their own group and light it for a moment (fill, no edge); new row `Sent, waiting on them 02` | NetworkClient rail, InvitationsClient section ids |

Everything else stays as it is: cards, matched skill tags, Open to collaboration badge, org chip, actions and menus, empty states, rail, legal links.

## Risks
- 8: one more lookup per card unless the suggestion and connection queries return up to three mutual ids; without that, ship 8 off.
- 13: undo for Accept means removing the new connection (disconnect) and putting the request back; undo for Connect is Cancel request, which exists. Needs a short server window or a plain re-create.
- 14: needs stable section ids on Invitations; jump focus moves to the group heading for keyboard and screen reader users.
- 2: every suggestion row needs `recommendationReason` on the client type; Discover's rail cards use the same PersonCardContent, so the reason must stay opt-in (`variant="network"` only).
- 5: the note text is already loaded for the ⋯ menu; no new query.
- No migration, no env change.
