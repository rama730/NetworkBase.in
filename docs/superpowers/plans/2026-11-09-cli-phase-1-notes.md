# CLI Phase 1 — notes

## Decisions and deviations

- **Envelope kept.** The server keeps `{ success, data, message, errorCode, details }` (`src/app/api/v1/_envelope.ts`); report A2.6's `{ ok, ... }` would break the web app, CLI 1.x and the VS Code extension. New codes are added to `ApiErrorCode` (first: `SCOPE_MISSING`). The CLI 2.0 `--json` output uses the report's `{ ok, ... }` envelope (Phase 2).
- **Bearer caches removed (F43).** The 15 s bearer cache in `_shared.ts` and the 30 s status cache in `extension/session` arrived with CLI 1.0 (commit d2eaf2fa2, 2026-11-06) and kept revoked tokens working; they had also broken `tests/db/extension-auth.test.ts` since then. Every token request now reads revocation (one indexed query, API-009).
- **Token access in one place.** `src/lib/security/token-access.ts` + `requireAuthenticatedUser`; method/path from the proxy's `x-networkbase-request-*` headers; missing headers → 403. Body-dependent scopes via `requireTokenScope` in task-update, fast-push, task-push.
- **F44 (webhook signing key).** Nothing in the app creates `workspace_webhooks` rows (the table is only read in `src/inngest/functions/git-sync.ts`), so no receiver exists to verify signatures. When a webhook UI is built, sign with the secret shown to the user, not `secret_hash`.
- **F79 (shared task linking)** moves to Task 7: fast-push will delegate to `placeFiles`, which owns linking.
- **Review actions from tokens.** `task-update` kinds `approve`, `request_changes`, `resubmit` call cookie-based server actions (`src/app/actions/task.ts`), so they fail for tokens today. Fixed in Task 8 with domain functions behind `POST /tasks/:ref/review` and `/transition`.
- **Pre-existing test failure.** `tests/db/task-push-receipts.test.ts` "a stable operation id is required" fails because task-push invents an operation id when `Idempotency-Key` is missing (F72). Fixed in Task 5 (key required on token writes).
- **Pre-existing unit failures not caused by this work** (Settings/Integrations contract tests): `integrations-ide-extension-redesign`, `settings-scroll-document-contract`, `workspace-dashboard-settings-ui-contract` — the files they read were not touched here; they are revisited in Phase 4 (P4.3) when Integrations is redesigned.

## Disposable database

`bash scripts/db/disposable-db.sh` → `postgresql://postgres@localhost:54332/nb_test` (Homebrew Postgres 17, no Docker). DB tests: `DATABASE_URL_FRESH=<url> npx tsx --test --test-concurrency=1 tests/db/<file>.test.ts`.
