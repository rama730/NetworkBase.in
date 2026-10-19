# nb-s3

`nb-s3` is a Next.js product shell with explicit scale boundaries for authenticated delivery, public feed delivery, realtime collaboration, and heavy Git/import jobs.

## System Overview

The repo is split into four runtime paths:

- Request path: Next.js app routes, middleware, route contracts, and authenticated shells.
- Public read path: CDN plus Redis backed feeds and public cache envelopes.
- Realtime path: Supabase Realtime channels for durable invalidation, cursor presence, and typing traffic.
- Worker path: Inngest orchestration with worker-only execution for Git sync and project import flows.

The most important architecture docs live here:

- [System map](docs/architecture/system-map.md)
- [Engineering standards charter](docs/architecture/engineering-standards-charter.md)
- [Engineering standards enforcement matrix](docs/architecture/engineering-standards-enforcement-matrix.md)
- [Stability rollout runbook (archived, 2026-09)](docs/stability-rollout-runbook.md)
- [Page data contract](docs/performance/page-data-contract.md)
- [Security checklist](docs/security-checklist.md)

## Runtime Boundaries

Request delivery is classified into three route classes:

- `public_cached`: CDN plus Redis first, stale-or-shed under overload.
- `user_shell`: authenticated shell plus minimal bootstrap, one background notification stream max.
- `active_surface`: active conversation/editor/workspace surfaces only, two background channels max.

Those contracts are enforced in:

- [page-contract.ts](src/lib/performance/page-contract.ts)
- [route-class.ts](src/lib/routing/route-class.ts)
- [check-page-performance-contract.ts](scripts/check-page-performance-contract.ts)
- [check-runtime-boundaries.ts](scripts/check-runtime-boundaries.ts)

## Realtime Model

Durable invalidation and ephemeral collaboration use Supabase-backed wrappers:

- [subscriptions.ts](src/lib/realtime/subscriptions.ts)
- [RealtimeProvider.tsx](src/components/providers/RealtimeProvider.tsx)
- Presence client transport: [presence-client.ts](src/lib/realtime/presence-client.ts)

Cursor, typing, and online presence state remains ephemeral and is not written to Postgres.

## Worker Model

The web deployment must not register heavy Git/import workers. Function registration is controlled by:

- [registry.ts](src/inngest/registry.ts)
- [route.ts](src/app/api/inngest/route.ts)

Set `INNGEST_EXECUTION_ROLE=web` for the web app and `INNGEST_EXECUTION_ROLE=worker` for the worker deployment.

## Core Commands

```bash
npm run typecheck
npm run test:unit:coverage
npm run check:db:migration-sources
npm run check:engineering-standards
npm run check:page-contract
npm run check:force-dynamic-allowlist
npm run check:runtime-boundaries
```

Local development:

```bash
npm run dev
```

`npm run dev` starts the Next.js app. Typing indicators and cursor presence connect through Supabase Realtime; there is no separate collaboration server.

## Environment

The minimal local env template is in [.env.local.example](.env.local.example).

Database replay and credentialed E2E runs require disposable targets. Set `DATABASE_URL_FRESH` for migration replay and a distinct `E2E_DATABASE_URL` for E2E fixtures; neither workflow falls back to `DATABASE_URL`.

The new scale-critical settings are:

- `INNGEST_EXECUTION_ROLE`
- `LOAD_SHEDDING_ENABLED`
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

## Operational Proof

The capacity-audit, production-rollout and load-suite tooling described in the archived [stability rollout runbook](docs/stability-rollout-runbook.md) no longer exists in this repo. Current release evidence comes from `npm run check:engineering-standards`, `npm run test:db` and the E2E gates in `.github/workflows/`.
