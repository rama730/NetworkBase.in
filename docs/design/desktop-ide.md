# Desktop IDE control

Implemented the approved 22 October 2026 preview in the shared Files/task toolbar control and the My Work drawer header.

- Uses the application control-height token (34px at default density, 44px for coarse pointers), 13px labels, 16px trigger icons, semantic brand/status colors and existing light/dark themes.
- Disconnected state shows Desktop IDE and a searchable picker of all supported editors. Detected installed editors are grouped first; installation is not treated as an authenticated connection.
- Connected state offers one-click opening in the preferred editor and a picker with Connect another editor, even with only one connection. Pending tokens and duplicate sessions do not become extra connected editors.
- Uses the dropdown primitive shared with the dialog focus stack. The searchable content owns text/list navigation and restores focus on dismissal. Layer 240 sits above task drawers (201) and mobile sheets (221); setup/project dialogs use layers 250/251.
- Preserves project, file and task deep-link context and dispatches synchronously from the user gesture. Failed native handoffs offer extension setup, connection settings and retry.
- My Work asks which project to open. Projects load lazily from the existing authenticated workspace-summary endpoint, with an account-scoped query key, pagination, search over loaded projects, loading, empty and retry states. Empty lists never dispatch an unspecified workspace.

## Validation

- TypeScript `tsc --noEmit` and targeted ESLint: passed.
- Existing IDE, Files design, task-panel, settings integration and workspace unit contracts: 56 tests passed.
- `npx playwright test -c tests/browser/playwright.config.ts desktop-ide.spec.ts --project chromium --project webkit`: 20 checks passed. Tests render production components, dialogs, application CSS and fonts with isolated session/auth/network data. Coverage includes nested overlays, keyboard focus/search/Escape, installed/editor selection, pending/duplicate sessions, preference persistence, native fallback, My Work project paging/retry/empty state, dark mode, mobile sheets and coarse-pointer sizes.
- Running local app: checked the DeepScope AI Files header, 34px sizing, editor search, focus and Escape dismissal.

OS editor launches are intercepted in automated checks. Installed-editor sign-in and workspace opening still depend on the extension and browser/OS protocol registration; these checks do not claim a live authenticated extension round trip.
