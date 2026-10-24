# Message history background

The approved default is the original drafting grid: uniform 24px cells with a 0.7px stroke. The sketch and stronger 96px guide studies are excluded. The application uses its existing neutral theme tokens, independent of the selected action accent.

## Coverage

`MessageHistory` is the shared history root in `Timeline`, `ThreadPane`, and `TimelineSkeleton`. Conversation and thread loading, empty, populated, grouped, long-message, media, and reconnect/error states therefore use the same underlying canvas. The floating chat window reuses these components. The drawer also renders `ThreadSkeleton` while its thread code downloads, keeping the quieter thread grid and a solid composer placeholder without duplicating the drawer header. No extra scrolling element is added.

Welcome content and introductions for channels, DMs, group conversations, and applications have transparent backgrounds so the same continuous history grid remains visible behind them. Their action buttons retain solid surfaces. Headers, navigation, composers, structured cards, code, file/media frames, dates, unread labels, and notices also retain solid surfaces. Files, Canvas, Pins, Tasks, Inbox, search results, and details retain their existing backgrounds. Real sending, retry, drafts, uploads, thread controls, and virtualized scrolling remain owned by the existing messaging components.

## Rendering

- The canvas mixes 72% light background (dark card) with the muted surface.
- One local SVG, `public/patterns/message-grid.svg`, repeats through a CSS mask. The neutral muted foreground supplies its color.
- Grid opacity is 0.10 in light appearance and 0.065 in dark appearance, multiplied by 0.72 in threads. Each history's actual width supplies a further multiplier: 0.76 at 480px and below, 0.88 above 480px through 680px, and 1 above 680px. Narrow desktop lanes, floating windows, and phones therefore get the same treatment at the same width. Cell size stays constant, and individual message contents never change opacity.
- Ordinary hovered/focused rows use a 55% muted surface overlay. Mention and jump treatments keep their existing solid backgrounds; keyboard controls retain their independent focus treatment.
- Histories align their pattern phase to the nearest existing `data-messages-surface` shell, including its border. ResizeObserver and window resize batch width-strength and phase updates in an animation frame, including when a thread opens or the keyboard changes the available layout. Cleanup disconnects observers, removes listeners, and cancels outstanding work. Scrolling requires no geometry updates.
- Decoration has no accessible element, receives no pointer events, introduces no focus stop, and uses no animation or fixed background attachment.
- Missing assets or unsupported masks leave a solid canvas. Forced colors use the system Canvas and omit the pattern; printing also omits the pattern.
- Existing visual-viewport height handling and composer safe-area behavior remain in place.

The standalone preview's theme/surface/state selectors, sample messages, simulated keyboard, scale studies, and local demo send controls are review tools. They are not added to production. The personal Grid / Plain preference was explicitly excluded from application adoption: the original grid remains the application default, with no new background selector, persistence, or account setting. No database migration is needed.

## Code verification

`tests/unit/chat-history-grid.test.ts` covers width thresholds (including fractional boundary values), width updates on pane resize, phase alignment across unequal pane offsets, fractional positions, resize batching and cleanup, absence of scroll listeners, fallback without ResizeObserver, server-rendered log/loading semantics (including the first thread-code download), original SVG geometry, and CSS fallback rules. Contrast checks cover body/metadata over the canvas, strongest grid stroke, and hovered rows in both themes, across narrow, medium, and wide conversations and threads. Dense-content tests render the application's real `MessageBody` inside both history variants with full paragraphs, user/channel mentions, inline code, lists, code blocks, and a long filename; no fictional messages are inserted into application conversations.

The broader `chat-*.test.ts` and `message-*.test.ts` suite passes all 164 tests, including timeline, thread, row, floating-window, media, reconnect, and accessibility coverage.

TypeScript, targeted ESLint, theme and appearance contracts, and production PostCSS/Tailwind compilation pass. The scroll contract reports an existing legacy scrollbar utility in the unchanged `src/components/projects/EditProjectModal.tsx`; this change adds no scroll owner or scrollbar utility.

Verification is code-only, as requested. No browser automation, physical-device testing, or visual certification at actual browser zoom was performed.

## Rendering verification boundaries

| Area | Current evidence | Remaining verification |
| --- | --- | --- |
| Width-aware strength | Width boundaries, fractional widths, observer updates, and compiled opacity rules pass code checks. | Perceived comfort on different physical displays. |
| Dense conversation content | Actual message renderer preserves content, wrapping hooks, and solid mention/code surfaces; body and metadata contrast meet AA across the width/theme combinations. Existing grouping and media tests pass. | Reading comfort during a long conversation on a physical display. |
| Browser zoom and display scaling | Fractional coordinate arithmetic is checked at representative 100%, 125%, 150%, and 200% scale measurements; fixed 24px mask geometry is retained. | Actual browser zoom, operating-system display scaling, thin-line sharpness, and painting. Arithmetic checks do not emulate these. |
| Phone keyboard | Existing visual-viewport height handling and composer safe-area rules remain in place; history resize handling is tested. | Physical-device keyboard, scrolling, focus, and viewport behavior. The standalone preview's keyboard area is a simulation. |

These verification notes belong to design/engineering documentation, not the messaging interface. They do not report unperformed visual checks as complete.
