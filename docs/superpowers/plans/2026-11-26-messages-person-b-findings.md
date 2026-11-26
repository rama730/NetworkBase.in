# Messages: two-person live check findings (2026-11-26)

Production, two accounts: A = Ramanayudu CH (@ramanayudu_ch) in Chrome, B = Rama (@ch_rama) in Safari (scripted
through Apple Events). Covered: 1:1 DM, workspace channels (Network for builders), organization #general (CSE 3B,
A owner, B member), a team inside the organization (Team Falcon), job-application conversation, Inbox, search,
saved, mark unread, schedule, details, floating window, phone width. Nothing below is fixed yet.

## Passed (both sides)

Live delivery and unread; Seen; read receipts off/on; reactions (with who reacted on hover); edit "(edited)"; delete
with 5 s Undo; thread replies (Inbox, badge, title, "1 reply" line with faces); @mention highlight and NEW line; photo
and voice note (thumbnail, preview, waveform, playback); pin; mute; block then restore; privacy gate; poll vote count;
create channel; browse, preview and join; topic shown live; leave with Undo; add people back (appears live); archive
(composer replaced live: "This channel is archived…"); org "Only admins post in #general" (top-level refused, thread
reply allowed, no @channel offered in threads); team channel hidden from a non-member ("Conversation not found");
scheduled message delivered on time; search; save and Saved list; profile Message opens the floating window;
Messages badge off the Messages pages; application conversation (applicant: Pending review + Withdraw; reviewer:
Accept/Decline); phone width without sideways scroll.

## Findings

| # | What a person sees | Where it comes from |
|---|---|---|
| 1 | @here / @channel: the mention is saved but B's badge, Inbox and tab title don't change until a reload; push treats it as an ordinary message. | src/lib/messaging/send.ts:147 passes only people named with @ as `mentioned`, never broadcast recipients. |
| 2 | Channel event lines ("joined", "left", "added Rama", "set the topic") never arrive live; they show only after a reload, for everyone. | joinChannel / leave / add / topic actions publish `member.changed` or `channel.updated` only; the comment in useConversation.ts says the line "arrives as message.new", but nothing sends it. |
| 3 | Home row preview shows code: `Mention check <@2b4030a1-…>`, `Heads up <!here> …`. | HomePane.tsx:35 and ChatSections.tsx:118 print `last_preview` raw; `previewText` is never applied. |
| 4 | Home and sidebar previews keep old text and time for up to about 2 minutes ("Message deleted · 2:15 PM" after a new message). Only the count is live. | `applyHint` (shell-state.ts) patches `last_seq` only; preview waits for the 90±30 s poll. Before the mix. |
| 5 | "Seen" disappears after the other person sends a message and deletes it. | `seenAfter` (src/lib/messaging/seen.ts) counts deleted messages as the newest. |
| 6 | A thread whose first message and every reply are deleted stays: "This message was deleted · 1 reply" in the conversation, a deleted line in the thread, an unread item in Inbox → Threads. | Deleting a reply leaves `reply_count` and the thread's unread state unchanged. |
| 7 | Mark unread on Rama's message showed "12 unread" when only 1 message from Rama followed it. | The count is a seq difference: your own messages, deleted ones and thread replies count too. |
| 8 | "Drafts and scheduled · 01 waiting" stays after the scheduled message is sent (and showed 01 before anything was scheduled); the page says nothing is scheduled. Clears on reload. | Sidebar count isn't refreshed when a scheduled message goes out. |
| 9 | Opening a conversation on a fresh page load: rows after 2.5 s warm, 8–13 s cold; 11–14 server actions run one after another first (one took 3.7 s). The workspace Messages page took over 4 s too. | Next.js runs server actions one at a time; the message list waits behind them. |
| 10 | Org "Only admins post in #general" turned on: members' open screens don't change; they find out when a post fails, and the failed post stays as "NOT SENT · Retry" (Retry can't work). | Setting change isn't pushed to open conversations. |
| 11 | An organization's #general reads "Everyone in the project". | drizzle 0014/0067 default description uses "project" for top-level spaces, organizations included. |
| 12 | Rama's profile says "Offline" while the conversation header says "Active just now". | Profile and Messages read presence from different places. |
| 13 | While a conversation loads, the header says "Offline", then "Active now". | Header presence defaults to Offline before data arrives. |
| 14 | Someone else's poll vote: count live, their face only after a reload. | By design (server filters blocked voters); live adds only your own face. |
| 15 | Places read "in Rama" for a DM: Inbox ("replied in a thread in Rama"), Saved ("in Rama"), Search ("in Ramanayudu CH"). | Rows use the DM's title as a place name. |
| 16 | Tab title order varies: "Rama · (1) Messages" vs "(1) #general · Messages". | Two `useDocumentTitlePrefix` calls stack in arrival order. Before the mix. |
| 17 | Schedule dialog uses the browser's date picker and says "Asia/Calcutta". | Rest of the app uses its own date-and-time field; time zone printed from the old IANA name. |
| 18 | "In Network for builders ." with a gap before the full stop (Create channel dialog). | The workspace title is saved with a trailing space; titles aren't trimmed. |
| 19 | Sidebar group heading "CSE 3B · Data Structures 2026" is cut mid-character ("…Structures 2(") with no "…", right against its count. | Heading clips instead of truncating. |
| 20 | Screen readers hear "1 UNREAD CONVERSATIONS". | Label doesn't switch to singular. |
| 21 | DM details list an organization under "Workspaces in common". | Wording. |
| 22 | Minor, seen once: the first "Seen" left the view 62 px above the bottom. | Timeline doesn't re-pin when the Seen line appears. Not reproduced. |

## Ruled out (test setup, not the app)

- Blank pages and Safari opening conversations ~400 px above the bottom: B's Safari tab was hidden behind other
  windows, so streamed parts and the list's positioning waited for animation frames. With Safari in front the page
  filled in at once and the DM opened at the bottom.

## Not checked

- A group chat with three or more people (no third test account), push and email notifications, presence over time.

## Leftovers from the tests

- #qa-live-check in Network for builders is archived (the app has no delete for channels).
- Deleted-thread lines (A–B DM message 17, CSE 3B #general message 2) stay until finding 6 is fixed.
- Test photo, thumbnail and voice files are unlinked and expire within the hour.
- Safari's "Allow JavaScript from Apple Events" should be turned off.
