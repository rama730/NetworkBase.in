# NetworkBase — Identity in motion

A local, interactive concept studio. It does not change application routes, the static sidebar identity, authentication, or production loading behavior. All people, operations, uploads, and outcomes are simulated.

## Open

From the repository root:

```sh
python3 -m http.server 4178 --bind 127.0.0.1 --directory artifacts/brand-studio
```

Open <http://127.0.0.1:4178>. The folder is also portable: `index.html` uses local relative assets and works as a directly opened file in a browser. Keep the CSS, JS, and `assets` directory beside it.

## Complete concept coverage

| Area                 | Included previews and interactions                                                                                                                                                                                    |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Signature            | Stepped reverse typing and continuous reverse reveal; right-to-left square travel; canonical resting lockup; 700–1,400ms duration; frame scrubbing; replay; global speed and pause/resume.                            |
| Everyday motion      | Breathe, Shuttle.                                                                                                                                                                                                     |
| Alternative motion   | Trace, Turn, Wipe.                                                                                                                                                                                                    |
| Expressive motion    | Split, Squash, Queue, Orbit, Relay, Cast.                                                                                                                                                                             |
| Opening motion       | Reverse reveal, Tally, Shatter.                                                                                                                                                                                       |
| Inspection           | Every mechanic has a larger inspector, 12/16/24/40/64px sizes, replay, local pause/resume, and a transition from its current position into one still square.                                                          |
| Comparison           | Select two or three mechanics; view at the same size and speed; pause, resolve, or replay together.                                                                                                                   |
| Mascot directions    | Living square, Square companion, Builder character. Working name “Node” is an unapproved naming exploration.                                                                                                          |
| Mascot behavior      | Connect, Look closer, Guide, Build, Acknowledge, Wait, Rest.                                                                                                                                                          |
| Creative territories | Connector, Builder, Guide, each demonstrated through the corresponding gesture.                                                                                                                                       |
| Product scenarios    | Welcome, first project, empty network, no results, completed action, delayed operation, confirmed error and retry, offline, route skeletons, measured upload progress, background refresh.                            |
| Working actions      | Discover people, clear filters, create a demo project, view a connection, inspect delayed activity, retry an error, reconnect, finish route loading, upload 20 demo files, finish a background refresh.               |
| Operation lab        | Fast (120ms, no loader), normal, ten-second delay with recovery options, failure and retry, offline, measured progress, background refresh, cancellation, and completion resolution.                                  |
| Appearance           | Paper, Ink, System; the application's Clay, Orchid, Forest, Ember, Rose, and Lagoon accent colors. External assets remain fixed-color.                                                                                |
| Accessibility        | Manual and system reduced motion; complete static information; meaningful status announcements; silent progress value updates; native keyboard-accessible controls and modal dialogs; no focus traps written by hand. |
| Responsive behavior  | Whole-studio responsive layout; a separate phone-sized application canvas; 200% wordmark type sample.                                                                                                                 |
| Small sizes          | 12/16/24/48px square specimens; multi-part loaders fall back to Breathe below 16px.                                                                                                                                   |
| Asset placements     | Actual application favicon and maskable icon; maskable crop, browser tab, and a monochrome identity treatment.                                                                                                        |
| Resilience           | Static resting mark without animation; offline/failed/delayed/canceled states; existing content retained during background work; ready content can interrupt a loading preview.                                       |

Squash, Shatter, and other expressive studies are explicitly exploratory. They do not silently amend the current restrained-motion or stable-geometry brand rules.

## Architecture and Ponytail choices

- `index.html`: the studio shell and accessible native controls.
- `studio.css`: semantic appearance tokens, layout, CSS choreography, and responsive/reduced-motion treatments.
- `studio.js`: one study catalog, one loader renderer, one mascot renderer, native Web Animations for introduction/settling, and small operation simulations.
- `assets/`: copied canonical application assets and Instrument fonts, including their licenses.
- `verify.cjs`: a runnable browser behavior check using the repository's existing Playwright installation.

No runtime packages, framework scaffold, backend, animation service, external media, or external network request is required. CSS owns looping motion. JavaScript owns user controls and lifecycle decisions. Offscreen studies pause through IntersectionObserver; background tabs pause decorative motion. Operation timers keep their real elapsed-time semantics. The timeline's animation-frame callback only updates its transport display while the introduction is playing.

The preview mirrors the canonical geometry: square size is 0.41 times type size, its corner radius is 0.28 times its size, and the following gap is approximately 0.55 square widths. The current app rounds those measurements to whole pixels; the scalable specimens retain proportional geometry. A production implementation should reuse `src/components/brand/BrandMark.tsx`, rather than introducing a second logo component.

Deliberate boundary: this is a finite concept catalog, not an extensible choreography platform. A dedicated animation runtime becomes worth considering only if the selected character requires interactive rigging that native CSS/SVG cannot maintain simply.

## Verification

With the local server running:

```sh
node artifacts/brand-studio/verify.cjs chromium
node artifacts/brand-studio/verify.cjs webkit
```

The check exercises real interactions, interruption and resolution, the ten-second delayed state, progress, error recovery, layout, keyboard dismissal, theme variants, and both forms of reduced motion. It records its results beside the preview. Screenshot evidence is a visual aid, not a frame-rate benchmark. Performance on physical phones and assistive-technology review remain production-adoption checks.
