# ADR: Auth Snapshot

## Decision

Request-path authentication is resolved from the Supabase access token locally, using cached JWKS or the configured JWT secret, and exposed as `AuthSnapshot`.

## Why

- Remote auth lookups in middleware do not scale cleanly on hot paths.
- Route gating only needs verified claims, not a network round trip.
- A single request-path auth contract simplifies shell rendering and overload behavior.

## Consequences

- Middleware and server bootstraps must rely on `AuthSnapshot`, not remote `auth.getUser()` calls.
- Email verification and, as a fast path, onboarding completion are read from token-backed claims. The database (`profiles.onboarding_status`) is the record of completion: when it says completed and the claim is missing (a failed claim write, or an account that finished before claims existed), `hasCompletedOnboarding` writes the claim once so the next token carries it. Until then a request pays one extra redirect, never a wrong answer.
- Invalid or expired auth cookies fail closed and are cleared centrally.
