# Compact navigation feedback — implementation and acceptance

22 October 2026. Implements the approved revision 04 toast concept. The fictional scenario reference is `toast-scenarios.json`; it is documentation and is not imported into production.

## Implementation

All application toast consumers use `@/lib/feedback`. `components/ui/sonner.tsx` remains the provider entry point, with no Sonner runtime renderer. Sonner's public types preserve compatibility with existing options and callbacks. No production dependency was added.

- `src/lib/feedback/store.ts`: operation identity, active reading clocks, finite queue/history, priority, duplicate merging, deadlines, and cleared-account generation boundaries.
- `src/lib/feedback/index.ts`: compatible notification functions, promise handling, compact/safe copy, date context, and deferred local Undo.
- `src/lib/feedback/copy.ts`: reviewed message contracts; runtime names, numbers, file limits, and dates stay at actual call sites.
- `src/components/feedback/FeedbackHost.tsx`: single accessible presentation owner, navigation/mobile/modal placement, queue review, focus, gestures, and live announcements.
- `src/components/feedback/feedback.css`: application tokens, compact card anatomy, touch sizes, and motion.
- `src/components/feedback/ManualCopyDialog.tsx`: task-specific manual clipboard recovery, with selected native text. This is not an additional toast disclosure.

## Approved plan coverage

| Preview requirement | Application implementation |
| --- | --- |
| Fit left navigation | Slot between scrollable navigation and fixed footer; width derives from the 224 px rail minus 24 px inset. Border accounting preserves an actual 200 px card. |
| Small card | 40 px minimum confirmation, 7 × 9 px padding, 14 px icon, 13/18 title, 12/16 essential context, neutral 1 px border and 8 px radius. Height grows with content. |
| Remove Details | No Details/More/disclosure control. One task action and dismiss; no empty action footer. |
| Consistent surfaces | Every toast caller shares the host. File/field cues and durable native conditions remain unboxed in their task context. Profile position overrides and legacy Sonner placement CSS are removed. |
| File too large | Compact warning, actual contextual limit, native rejected-file rows, Choose file action, and no oversized alert banner. Cancelling a native picker retains the unresolved message. |
| One visible message | Queue of up to 50 messages; review pending in any order. Incoming failures are announced. Priority applies when the current message finishes, protecting active focused/Undo messages. |
| Duplicates | Matching passive outcomes merge and show a repeat count. Different action closures never merge into one operation. |
| Overflow/staleness | Recent read-only history is bounded at 100; old queued passive outcomes expire after a minute. History strips action closures. Overflow is identified in review. |
| Collapsed navigation | 44 px severity/count button in 64 px rail. Explicit activation expands navigation; text is never squeezed into the collapsed rail. Reading time pauses. |
| Mobile | At most 224 px, 16 px left inset, actual visual viewport and mounted composer/footer clearance, safe area, and 44 × 44 px minimum control targets. |
| Modal/drawer ownership | Move the single host into the active modal. Actions remain within its focus/ARIA boundary; the background navigation never owns the only usable recovery control. |
| Motion | Enter: 200 ms, opacity + 6 px rise. Exit: 140 ms, opacity + 4 px drop. Updates preserve the operation card. Reduced motion: 100 ms fade, no rotation/progress interpolation. |
| Reading clocks | Pause on hover, focus, hidden document, collapsed rail, queue review, transitions, and unavailable presentation owner. Queued messages retain reading time. |
| Loading | Promise loading is delayed 400 ms; fast operations skip it. Measurable upload progress appears immediately. Unchanged loading becomes Still working after 15 seconds, preserving its action and identity. |
| Promise correctness | `.unwrap()` returns the actual operation result/rejection. Notification formatting/finally failures cannot change mutation success or rollback behavior. |
| Local Undo | Message deletion uses the same 10-second active clock for presentation and commit. Undo cancels the commit; explicit dismissal/expiry commits once. Hiding the document pauses. Page leave settles pending local work. |
| File Undo | Uses the operation's existing backend reversal, one toast identity, loading and retry, and explicit failure copy. No unsupported Undo is invented. |
| Server deadline | Optional absolute deadline expires even while reading is paused; action activation checks it. UI hover never extends server eligibility. |
| Upload lifecycle | Flat and folder uploads reuse a card through measured progress, partial result, retry, cancellation, and completion. Only unfinished files are retried. Completed work remains in the file list/Transfers. |
| Project creation | One notification identity through creation, folder import, doc setup, and image/permission follow-up. Setup failures state Project created and retain the remaining requirements. |
| MFA partial success | Authenticator enabled + Recovery codes missing, with functional Get codes recovery. Repeated failure preserves the enabled state. |
| Field validation | Persistent associated password/MFA/project-name errors; compact acknowledgement. Existing channel/composer/attachment requirements remain with their controls/items. |
| Durable conditions | Connection indicator survives toast dismissal; debounced connection transitions reuse a card. Account deletion keeps its actual date and reactivation control in a compact native status row. Session/access enforcement remains in existing auth/permission owners. |
| Activity | Keep batching and context suppression. Group review opens the notifications list, not its arbitrary first item. Toast descriptions do not expose private notification bodies. |
| Safe copy | Allowlisted runtime errors, operation fallbacks, numeric constraints, protected drafts, access/privacy caveats, actual date/timezone context. No preview people, dates, or fabricated global upload cap enter runtime copy. |
| Account isolation | Sign-out clears active/history state. Late promises and generated-ID manual updates cannot resurrect the previous account's messages. |
| Keyboard | F8 focuses current feedback; Escape closes review first or dismisses focused feedback. Action updates retain focus; dismissal restores a usable target. |

## Verification

- Production build and TypeScript check pass.
- Focused runtime tests cover reading/commit clocks, deadlines, identity, deduplication, bounded queues/history, priority, stale outcomes, deferred Undo, promise rollback semantics, formatting failure, and account clearing.
- Chromium rendered all 255 approved scenarios through the actual React host on desktop and mobile. Desktop width: 200 px; mobile: 224 px. No horizontal text overflow. Default file-size specimen: 200 × 72 px; confirmation: 200 × 40 px. Touch actions/dismiss have 44 px minimum targets.
- Browser interaction checks exercised modal ownership (one card, inside the active Radix dialog), queue selection/recovery, collapsed severity button, manual copy dialog/selection, Undo and commit, F8/Escape, reduced motion, and 16 px clearance above a mounted bottom control/keyboard simulation.
- Existing unit contracts were updated where their old Sonner selectors, literal copy, five-second Undo timer, or two-argument upload signature no longer describe the approved behavior. Upload E2E outcomes still fail on partial/failure results.
- The new runtime/components and changed notification flows pass focused lint. Broader changed-file lint also encounters existing Timeline memoization and ImageViewerDriver render-ref errors; both reproduce on the unchanged HEAD versions.
- Full unit suite: **2,630 passed / 2,631 total**. The remaining failure is unrelated: the sibling VS Code extension lease contract (`await this.acquireLock(uri, true)`). This task does not modify the sibling extension or weaken its contract.

## Verification boundaries

The running local application redirected the automated browser to sign-in. Authenticated backend mutations were not executed; component interaction checks used the real production components in an isolated local harness. Production build, source integration, unit tests, and component behavior were checked without uploading live files, messaging real people, changing account security, or modifying database data.

Native operating-system keyboard behavior, browser/assistive-technology combinations, real translations/text scaling, and authenticated server integration remain release acceptance checks. The local deferred-delete page-leave request remains best effort, as in the existing architecture: closing a browser process can interrupt client network work. Absolute backend deadlines must be supplied by the operation owner; the shared UI does not invent or extend them.

The queue is intentionally finite. Older records are read-only and cannot replay stale callbacks; current truth remains with the affected item, editor, transfer, permission state, or account status. Permanent deletion, ownership transfer, and broad permission confirmations retain their existing task confirmation before mutation.

No migration, live database change, production deployment, or unrelated user edit is part of this redesign.
