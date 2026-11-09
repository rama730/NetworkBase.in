# CLI Phase 3 — notes

Local `main`, not pushed. P3.2 `nb mcp` (bd87799ed) and P3.3 `nb agent setup` (09fd71c0b) are described in the phase 2 notes' last section and the CHANGELOG. This file covers P3.1.

## P3.1 Sign-in with a code, and agent tokens

- **Migration `drizzle/0072_device_codes_agent_tokens.sql`**:
  - `extension_device_sessions` gets `token_type` (`device`|`agent`, with a check that an agent token has a workspace), `agent_name` and `workspace_id`;
  - `personal_access_tokens` gets `workspace_id`;
  - new table `device_codes`.
  Applied only to the disposable DB. **Production needs it before this code is deployed**: until then `/device` and `nb login --device` fail, and agent/bound tokens can't exist.
- **Flow:**
  - `POST /api/v1/device/code` (no sign-in, 10 per 10 minutes per IP) returns a code like `ABCD-EFGH`; only the hash of the polling code is stored.
  - The person approves at `/device`: Device, or Agent + one workspace they can change + 7/30/90 days + optional "Finish tasks / Final files / Edit docs".
  - `POST /api/v1/device/token` (polled every 5 s; `slow_down` if faster) creates the token at that poll, once: the code moves to `consumed` in the same transaction that creates the session. The token itself is never stored.
  - Approving needs the same recent verification as making a token in Settings (`SecurityStepUpDialog`), and records `editor_token_created` plus the "token created" email.
- **Token types:**
  - `nb_dev_` (device: all scopes except `ask:others`, 90 days);
  - `nb_agt_` (agent: `workspace:read task:read task:write file:read file:write` plus what was ticked).
  The prefix must match the stored type.
- **Keeping a bound token in its workspace (fail closed).** Each `TOKEN_ROUTES` entry has an `agent` mode:
  - `path` / `query`: checked centrally in `checkTokenAccess`;
  - `route`: the handler calls `denyOutsideTokenWorkspace(auth, { projectId, taskId })`, which also looks up a task id's real workspace; `tests/unit/token-route-coverage` fails if one doesn't;
  - `self`: `/me` and the session; the workspace list and task count are limited to the bound workspace.
  Routes without a mode refuse bound tokens with `WORKSPACE_NOT_ALLOWED`; extend modes as agents need more routes. Workspace-bound PATs use the same path, but Settings can't create them yet (P4.3).
- **CLI:**
  - `nb login --device` (automatic with `SSH_CONNECTION`/`SSH_TTY`, or on Linux with no `DISPLAY`/`WAYLAND_DISPLAY`);
  - `--agent "<name>"` requests an agent token;
  - `nb whoami` shows the token type and "one workspace only".
- **Tests:**
  - `tests/db/device-codes.test.ts`: pending → slow_down → approved → token once → 410; denied; expired; agent token refused in another workspace via query, body and a task id; workspace list limited; wrong prefix 401.
  - `tests/unit/token-access.test.ts`: binding rules.
  - `packages/nb-cli/test/login.test.mjs`.
  - Related DB suites (36) and CLI suite (74) pass.
- **Browser check:** `/device` signed out on the running dev server (desktop and phone width): sign-in keeps the code in the return path; no console errors. The signed-in approval form was not checked: that server uses the production database, where 0072 isn't applied.

## Left from P3.1

- Keychain storage (A3.4): tokens stay in `~/.networkbase/credentials.json` (0600).
- Profiles UI (`nb whoami --all`, `nb token list|revoke`, `nb logout --all`) and suspicious-use notices (A3.10).
- Settings → Integrations doesn't show the type/agent/workspace of these sessions yet (P4.3).
