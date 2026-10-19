# Onboarding and task email rollout

Sending and queue creation default to **disabled**. The production email migration
was separately authorized and applied on 2026-10-08 (see release status below).
Application deployment, webhook configuration and real-recipient tests remain
separate rollout steps. Supabase authentication mail and Google
Workspace SMTP/MX records are unchanged. No historical welcome/assignment backfill.

## Release status — 2026-10-08

- Applied only `0205_transactional_email_outbox` to production Supabase project
  `iutauehhgdymtpzrnzcy` (rama730's Project, Singapore). All 202 preceding
  repository entries were completed with matching checksums and journal indexes.
  Seven older, unindexed legacy journal entries were preserved unchanged.
- Used the connected Supabase migration operation, with the existing application
  advisory-lock key and prerequisite guards. Table creation and application-journal
  completion were atomic; Supabase also recorded migration `20261008064526`.
  Source SHA-256: `d4864dd282ca2263f701f83a84549ee02d6642214b3902a50b97e330c6f19496`.
- Verified three empty tables, all eight valid indexes, RLS enabled, service-role
  access, no `anon`/`authenticated` privileges and no realtime publication.
  No existing application data was changed and no email backfill was performed.
- Security advisors report informational “RLS Enabled No Policy” notices for the
  three intentionally server-only tables. No browser policies should be added.
  The pre-existing leaked-password-protection warning remains unchanged.
- Local `RESEND_EMAIL_ENABLED=false` was confirmed. Railway reactivation,
  credentials/configuration deployment, code release, Inngest registration,
  signed-webhook validation, browser/staging/inbox tests and production sending
  enablement remain pending. No Railway changes, GitHub push or real sends were
  performed as part of this database-only authorization.

### Local configuration follow-up — 2026-10-08

At the user's request, `.env.local` now sets `RESEND_EMAIL_ENABLED=true`,
`INNGEST_EXECUTION_ROLE=worker` and `INNGEST_DEV=true`. The signing secret was
retrieved through the Resend connector and stored only in the ignored local
environment file. The sending key and `RESEND_TEST_RECIPIENTS` remain empty;
real delivery is not ready and no local worker or real-recipient test was started.
The local database/Auth configuration still points to production, so local
onboarding and task submissions affect production records. The flag enables queue
creation after the app reloads; it does not itself prove email delivery.

Connected-account checks confirmed the sender domain is verified for sending,
the existing webhook is enabled with all five required events, and a production
worker sending key exists. Railway variable names confirm the sending key is
on worker and webhook secret on web; OAuth redacts their values. Both services'
latest deployments report `FAILED`. No Railway configuration, deployment, API
key rotation, domain/DNS change or webhook update was performed. Production
enablement and the example/default-off configuration remain unchanged.

Subsequent user-authorized configuration updates filled the local sending key
and recipient allowlist (credential values and recipient addresses are not
recorded here). `RESEND_EMAIL_ENABLED=true` was staged separately on both Railway
production services, with deployments skipped. The environment has two pending
flag changes; they are not live and must not be applied until the intended email
code is released, Railway is available and delivery verification is complete.
No production deployment or real-recipient test has been performed.

## Behavior

- Only the first successful **Finish profile** transaction queues welcome mail.
  Intermediate Continue steps only save drafts. Existing avatar, claims refresh
  and redirect behavior are preserved; the existing fallback avatar is unchanged.
- Creating an assigned task or changing its assignee queues assignment mail for
  another user. Persisted assignment activity IDs distinguish A → B → A.
  Unchanged assignments, self-assignment, unassignment and ordinary edits do not.
  Removing a collaborator with **reassign active tasks** uses the same assignment
  activity/mail transaction and notification policy, excluding completed or
  deleted tasks. Self-reassignment records history without notifying the actor.
- Settings → Notifications → Delivery → **Email task assignments** defaults on.
  Category/project policies, mutes, pause and quiet hours also apply. Welcome mail
  ignores task preferences. Sending checks confirmed email, active account,
  suppression and current assignment/access. Superseded assignments and deleted
  tasks are dropped, including before retries of an already frozen payload.
- Welcome uses `NetworkBase <welcome@networkbase.in>`; task mail uses
  `NetworkBase <notifications@networkbase.in>`. Both reply to
  `support@networkbase.in`. `privacy@networkbase.in` remains correspondence only.
  Task mail includes title, project and authenticated link, never descriptions,
  comments or attachments. Links use the existing trusted `APP_URL` resolution.

## 1. Prepare configuration, without enabling mail

Keep `RESEND_EMAIL_ENABLED=false` on **both** Railway services. Do not make any
Resend variable `NEXT_PUBLIC_*` or commit actual credentials.

| Setting | Web | Worker |
| --- | --- | --- |
| `INNGEST_EXECUTION_ROLE` | `web` | `worker` |
| `RESEND_EMAIL_ENABLED` | `false` | `false` |
| `RESEND_API_KEY` | absent | restricted sending key for verified domain |
| `RESEND_WEBHOOK_SECRET` | webhook signing secret | absent |
| `RESEND_TEST_RECIPIENTS` | not used for delivery | explicit comma-separated test emails outside production |

Preview/staging builds still require an allowlist, even with
`NODE_ENV=production`. Only `NODE_ENV=production` together with Railway's
`RAILWAY_ENVIRONMENT_NAME=production` bypasses that restriction. For safe live
validation use a separate staging environment with an explicit allowlist.

Gmail's “Send mail as” verification does **not** verify a domain for Resend.
Confirm `networkbase.in` is verified for sending inside Resend and that its
required DNS authentication records coexist with Google's records. Do not
replace Google Workspace's inbound MX records or authentication-email SMTP.

## 2. Apply the additive migration during an authorized rollout

Take the normal database backup/snapshot and inspect the migration journal first.
Use the existing migration procedure to apply
`drizzle/0205_transactional_email_outbox.sql` after all preceding migrations:

```sh
npm run check:db:migration-journal
npm run check:db:migration-sources
npm run db:setup
```

The last command changes the database selected by `DATABASE_URL`: run it only
after explicitly selecting the intended database and authorizing the rollout.
Migrations require a direct/session connection, **not** transaction-pooler port
6543. Runtime connections keep their existing pooler configuration.

Three private tables are added: `email_outbox`, `email_webhook_events`, and
`email_suppressions`. They have RLS enabled, no browser grants or realtime
publication, and service-role grants. Confirm the actual runtime SQL role can
read/write them; do not grant `anon` or `authenticated` access. Keep the existing
notification delivery-attempt log unchanged.

## 3. Deploy both services with sending disabled

Confirm both services deploy the intended revision, web health/readiness pass,
onboarding still saves/redirects, and task creation/reassignment still works.
In Inngest, confirm the existing **worker**, not web, registers
`email-outbox-delivery` with the `email/outbox.wake` trigger and five-minute cron.
Its heartbeat uses the existing `job_heartbeats` table.

Committed work survives missed wake-ups. The worker atomically claims indexed
due/expired-lease rows, processes at most 25 sequentially per run, and uses a
five-minute lease. A wake-up hint waits at most one second; provider calls run
only on the worker with a ten-second timeout. Supabase Auth recipient lookups use
the existing eight-second abortable fetch timeout; failures release the lease
and reschedule without consuming a provider-send attempt. Watch queue age if volume grows.

## 4. Configure the Resend webhook

In Resend register the HTTPS web-service endpoint:

```text
https://networkbase.in/api/v1/webhooks/resend
```

Subscribe to `email.sent`, `email.delivered`, `email.failed`, `email.bounced`, and
`email.complained`. Save its signing secret as `RESEND_WEBHOOK_SECRET` on **web
only** and deploy that configuration. Raw-body signatures are verified with
official Svix; events are durably recorded before success acknowledgement.
Invalid signatures get 401; persistence errors get 503 for provider retries.
Retries with the same Svix ID are harmless. Receipts arriving before the send
response are reconciled when the provider ID is saved.

## 5. Validate staging before authorizing production enablement

Use a disposable database and isolated authentication project. Allowlist only
controlled recipients, set the sending key on worker, then enable the flag on
web and worker in **staging**. With the flag off, events are deliberately not
queued and will not later be backfilled.

1. Finish a new user's onboarding. Confirm profile/avatar (or fallback), refreshed
   session and successful navigation; repeat/replay without another welcome.
2. Assign a task from another account; confirm in-app notification and email.
   Test A → B → A, no-op edits, self-assignment and unassignment.
   Also test collaborator-removal bulk reassignment, and task deletion before
   delivery or a retry. Completed/deleted tasks must not be bulk reassigned.
3. Check opt-out, task category/mutes, project policy, pause/quiet hours and
   membership removal before delivery. Do not send stale/private task context.
4. Verify Resend acceptance **and** signed `email.delivered` receipt, then check
   the controlled inbox/spam folder, both templates and their links. Neither
   API acceptance nor a delivered receipt alone proves inbox placement.
5. Use provider test tooling/addresses for bounce and complaint tests. Do not
   deliberately damage a real recipient's reputation. Confirm future sends are
   suppressed after a permanent bounce or complaint.

Only after successful staging/inbox and browser verification should a separately
authorized rollout enable `RESEND_EMAIL_ENABLED=true` on production services.
Coordinate both flags: web controls queue creation; worker controls draining.

## 6. Observe and recover safely

Inspect queue metadata rather than logging email bodies/addresses:

```sql
SELECT status, delivery_state, count(*)
FROM public.email_outbox GROUP BY status, delivery_state;

SELECT id, kind, status, attempts, due_at, last_error
FROM public.email_outbox
WHERE status IN ('needs_review', 'failed')
   OR (status = 'pending' AND due_at < now() - interval '10 minutes')
ORDER BY due_at LIMIT 50;
```

Logs/metrics: `email.accepted`, `email.dropped`, `email.webhook`,
`email.wake_failed`, `email.lookup_failed`, `email.send_failed`,
`email.needs_review`. Review the worker heartbeat, overdue rows and accepted rows
without delivery receipts. Provider outages, invalid keys and delayed webhooks
need operator attention; monitoring alerts are not automatically provisioned.

Retries freeze the recipient/content and use `networkbase/<outbox UUID>` as the
same provider idempotency key. Transient errors use bounded exponential backoff
and `Retry-After`. Eight attempts or 23 hours from the first attempt stop in
`needs_review`, before Resend's 24-hour deduplication expiry. **Never blindly
reset attempts/time, replace keys or requeue ambiguous rows:** first reconcile
provider history/receipts to prevent duplicate real mail.

Delivery states are conservative and monotonic: complaint > bounce > failure >
delivered > accepted. Late success receipts never clear a terminal failure or
suppression. A transient bounce does not suppress the address. Suppression rows
have no automatic expiry; do not clear a complaint without a consent/support
review. Outbox payloads contain recipient/name/task-title data and stay private;
user hard deletion cascades their outbox. Review retention with the existing
data-lifecycle policy before increasing volumes.

Emergency stop: disable `RESEND_EMAIL_ENABLED` on both services and deploy that
configuration. A request already in flight may still finish. Keep the additive
tables, receipts and suppression history; dropping them is not a rollback.

## Local verification evidence

The new migration was applied only to a newly created local PostgreSQL 17 test
database using the repository's Supabase shim/baseline. Email and authentication
providers were mocked: no production data or real emails were used.

```sh
node --import tsx --test 'tests/unit/**/*.test.ts'
# Set DATABASE_URL_FRESH to your isolated disposable database, never production.
node --import tsx --test --test-concurrency=1 'tests/db/**/*.test.ts'
npm run typecheck
npm run lint
node --import tsx scripts/check-migration-journal.ts
node --import tsx scripts/setup-database.ts --dry-run
node --import tsx scripts/check-sql-governance.ts
node --import tsx scripts/check-impact-review.ts --strict
npm run build
```

The existing onboarding browser smoke test now checks persisted profile/avatar
and visible avatar/fallback after navigation. Running it needs isolated Supabase
Auth credentials/fixtures; it was not run against production. Real-recipient
delivery/inbox verification and an authorized production rollout remain pending.

Verified locally: 2,160 unit tests, 41 disposable-database tests (including 19
email integration cases), typecheck, production build, changed-file lint,
migration journal/source/SQL governance, API versioning/envelope, runtime
boundaries, RLS and strict impact-review checks. Provider traffic was mocked.
The isolated database catalog check passed, and repeating migration setup
reported that the database already matched the journal.
The broad `npm run lint` command reports seven pre-existing CommonJS-import
errors in two checked-in `docs/audits/backend-database-2026-10-05/evidence/*.cjs`
scripts. The broader data-shape contract also reports existing snake_case
identity usage in five unrelated message/presence components; these were not
modified as part of this work. The full production release gate, browser E2E and
inbox-delivery acceptance have not been completed. Production migration lineage
was subsequently verified and the email migration applied as recorded above.

The follow-up gap checks cover soft deletion before first send and frozen-payload
retry, bulk reassignment activity/notification/mail consistency and rollback,
self-assignment and opt-out, and aborting stalled admin Auth requests while
allowing subsequent deliveries. The gap-verification build used dummy build-only
credentials with sending disabled, not live provider or database credentials.

Provider contracts: [24-hour idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys),
[raw webhook verification](https://resend.com/docs/webhooks/verify-webhooks-requests).
