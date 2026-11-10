# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS dependencies
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder

ARG APP_URL
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_REALTIME_AUTHORIZATION_ENABLED
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY
ARG NEXT_PUBLIC_GOOGLE_CLIENT_ID
ARG NEXT_PUBLIC_TRUSTED_OAUTH_REDIRECT_ORIGINS
ARG NEXT_PUBLIC_VERBOSE_APP_LOGS
ARG NEXT_PUBLIC_SENTRY_DSN
ARG NEXT_PUBLIC_SENTRY_ENVIRONMENT
# Passed only to the build step below: the token uploads source maps and must not reach ENV or the runner image.
# A build argument is already in the environment of every RUN in this stage; naming it in the RUN line would print
# its value in the build log.
ARG SENTRY_AUTH_TOKEN
ARG RAILWAY_GIT_COMMIT_SHA

# NEXT_PUBLIC_* values are written into the browser bundle at build time: one missing here is empty in production
# whatever Railway holds (Google One Tap was). tests/unit/dockerfile-build-env-contract.test.ts keeps the list whole.
ENV APP_URL=$APP_URL \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_REALTIME_AUTHORIZATION_ENABLED=$NEXT_PUBLIC_REALTIME_AUTHORIZATION_ENABLED \
    NEXT_PUBLIC_TURNSTILE_SITE_KEY=$NEXT_PUBLIC_TURNSTILE_SITE_KEY \
    NEXT_PUBLIC_VAPID_PUBLIC_KEY=$NEXT_PUBLIC_VAPID_PUBLIC_KEY \
    NEXT_PUBLIC_GOOGLE_CLIENT_ID=$NEXT_PUBLIC_GOOGLE_CLIENT_ID \
    NEXT_PUBLIC_TRUSTED_OAUTH_REDIRECT_ORIGINS=$NEXT_PUBLIC_TRUSTED_OAUTH_REDIRECT_ORIGINS \
    NEXT_PUBLIC_VERBOSE_APP_LOGS=$NEXT_PUBLIC_VERBOSE_APP_LOGS \
    NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN \
    NEXT_PUBLIC_SENTRY_ENVIRONMENT=$NEXT_PUBLIC_SENTRY_ENVIRONMENT

COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
# The webpack build with source maps outgrew the old 4 GB heap (exit 134 on Railway). With webpack's cache off
# (next.config.ts) it needs 3-4 GB (measured 2026-11-10: aborts at 3 GB, passes at 4), so 6 GB is headroom, not a
# target: V8 only grows the heap as far as the build needs.
RUN DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build \
    SUPABASE_SERVICE_ROLE_KEY=build-only \
    CSRF_TOKEN_SECRET=build-only-placeholder-not-used-at-runtime-000000000000 \
    SECURITY_STEPUP_SECRET=build-only \
    SECURITY_RECOVERY_CODE_SECRET=build-only \
    AUDIT_METADATA_HASH_SECRET=build-only \
    GITHUB_IMPORT_TOKEN_ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000 \
    JOB_REQUEST_SECRET=build-only \
    GITHUB_WEBHOOK_SECRET=build-only \
    INNGEST_EVENT_KEY=build-only \
    INNGEST_SIGNING_KEY=build-only \
    INNGEST_EXECUTION_ROLE=web \
    RAILWAY_GIT_COMMIT_SHA=$RAILWAY_GIT_COMMIT_SHA \
    NODE_OPTIONS=--max-old-space-size=6144 \
    npm run build

FROM base AS runner
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    NEXT_TELEMETRY_DISABLED=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git openssl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
