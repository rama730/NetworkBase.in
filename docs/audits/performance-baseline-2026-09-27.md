# Performance baseline — 2026-09-27

Recorded before implementing the speed audit plan. Production still runs `codex/railway-production` in region ams.

## Production TTFB (3 runs)

```
/                TTFB min 0.750  avg 0.786  max 0.853  (TLS avg 0.267)
/login           TTFB min 0.636  avg 0.683  max 0.736  (TLS avg 0.223)
/terms           TTFB min 0.570  avg 0.749  max 1.057  (TLS avg 0.257)
/api/v1/live     TTFB min 0.599  avg 0.985  max 1.268  (TLS avg 0.370)
/api/v1/health   TTFB min 0.779  avg 1.091  max 1.708  (TLS avg 0.173)
```

## Railway (7 days, networkbase-web)

- p50 12–90 ms · p90 184–1,441 ms · p95 up to 1,817 ms · p99 up to 3,314 ms
- 3,778 requests: 2xx 1,785 · 3xx 387 · 4xx 1,606 · 5xx 0
- Memory 273 MB average (max 299 MB) of 1 GB · CPU ≈ 0

## Database (pg_stat_statements since 2026-01-16)

- Total exec 161,818 s; Realtime WAL polling 144,510 s (89%)
- Type-fetch queries 117,505 · pooler auth 502,533 · DISCARD ALL 72,348
- project_nodes seq rows read 716,431,197 · supabase_realtime tables 21 · connections 26

## Client JS per route (raw, client reference manifests)

```
   1748 KB  /discover
   1748 KB  /hub
   1619 KB  /onboarding-preview
   1462 KB  /messages
   1398 KB  /onboarding
   1364 KB  /projects/new
   1292 KB  /projects/[slug]
   1262 KB  /settings
   1191 KB  /signup
   1188 KB  /profile
   1188 KB  /my-profile
   1187 KB  /u/[username]
   1187 KB  /login
   1166 KB  /people
   1166 KB  /network
   1161 KB  /authorize
   1160 KB  /forgot-password
   1155 KB  /reset-password
   1155 KB  /verify-email
   1137 KB  /legal/accept
   1131 KB  /workspace
   1131 KB  /terms
   1131 KB  /subprocessors
   1131 KB  /security-reporting
   1131 KB  /privacy
   1131 KB  /open-source
   1131 KB  /grievances
   1131 KB  /eula
   1131 KB  /dpa
   1131 KB  /copyright
   1131 KB  /cookies
   1131 KB  /admin/notifications
   1131 KB  /acceptable-use
   1131 KB  /_not-found
   1131 KB  /_global-error
   1131 KB  /
CSS total 438 KB; largest 427 KB
```

## Round trips on load (static trace, docs/superpowers/plans/tools)

```
App shell (every signed-in page)         req=  9 actions= 7 api= 1 sql=  54 auth=  8 storage= 0 redis= 3 rest= 1 fetch= 0 click= 11 cond= 6
/hub                                     req=  4 actions= 2 api= 1 sql=  49 auth=  2 storage= 0 redis=14 rest= 0 fetch= 0 click= 12 cond= 1
/messages                                req=  8 actions= 6 api= 1 sql=  57 auth=  7 storage= 0 redis= 6 rest= 0 fetch= 0 click= 34 cond= 5
/people                                  req=  2 actions= 1 api= 0 sql=  11 auth=  1 storage= 0 redis= 2 rest= 0 fetch= 0 click=  0 cond= 1
/profile                                 req=  9 actions= 4 api= 4 sql=  69 auth=  8 storage= 0 redis= 3 rest= 0 fetch= 0 click= 16 cond= 0
/projects/[slug]                         req=  4 actions= 2 api= 1 sql=  52 auth=  3 storage= 0 redis= 4 rest= 0 fetch= 0 click=  8 cond= 2
/projects/new                            req=  1 actions= 0 api= 0 sql=   0 auth=  0 storage= 0 redis= 0 rest= 0 fetch= 0 click=  8 cond= 0
/settings                                req= 10 actions= 4 api= 5 sql=  40 auth=  9 storage= 0 redis= 9 rest= 0 fetch= 1 click= 11 cond= 1
/u/[username]                            req=  9 actions= 4 api= 4 sql=  72 auth=  8 storage= 0 redis= 3 rest= 0 fetch= 0 click= 16 cond= 0
/workspace                               req=  1 actions= 0 api= 0 sql=   0 auth=  0 storage= 0 redis= 0 rest= 0 fetch= 0 click=  0 cond= 0
/acceptable-use                          req=  1 actions= 0 api= 0 sql=   0 auth=  0 storage= 0 redis= 0 rest= 0 fetch= 0 click=  0 cond= 0
/admin/notifications                     req=  1 actions= 0 api= 0 sql=   3 auth=  1 storage= 0 redis= 0 rest= 0 fetch= 0 click=  0 cond= 0
/cookies                                 req=  1 actions= 0 api= 0 sql=   0 auth=  0 storage= 0 redis= 0 rest= 0 fetch= 0 click=  0 cond= 0
/copyright                               req=  1 actions= 0 api= 0 sql=   0 auth=  0 storage= 0 redis= 0 rest= 0 fetch= 0 click=  0 cond= 0
/dpa                                     req=  1 actions= 0 api= 0 sql=   0 auth=  0 storage= 0 redis= 0 rest= 0 fetch= 0 click=  0 cond= 0
/eula                                    req=  1 actions= 0 api= 0 sql=   0 auth=  0 storage= 0 redis= 0 rest= 0 fetch= 0 click=  0 cond= 0
/grievances                              req=  1 actions= 0 api= 0 sql=   0 auth=  0 storage= 0 redis= 0 rest= 0 fetch= 0 click=  0 cond= 0
/onboarding-preview                      req=  1 actions= 0 api= 0 sql=   0 auth=  0 storage= 0 redis= 0 rest= 0 fetch= 0 click=  3 cond= 0
/open-source                             req=  1 actions= 0 api= 0 sql=   0 auth=  0 storage= 0 redis= 0 rest= 0 fetch= 0 click=  0 cond= 0
/                                        req=  1 actions= 0 api= 0 sql=   0 auth=  0 storage= 0 redis= 0 rest= 0 fetch= 0 click=  0 cond= 0
/privacy                                 req=  1 actions= 0 api= 0 sql=   0 auth=  0 storage= 0 redis= 0 rest= 0 fetch= 0 click=  0 cond= 0
/security-reporting                      req=  1 actions= 0 api= 0 sql=   0 auth=  0 storage= 0 redis= 0 rest= 0 fetch= 0 click=  0 cond= 0
/subprocessors                           req=  1 actions= 0 api= 0 sql=   0 auth=  0 storage= 0 redis= 0 rest= 0 fetch= 0 click=  0 cond= 0
/terms                                   req=  1 actions= 0 api= 0 sql=   0 auth=  0 storage= 0 redis= 0 rest= 0 fetch= 0 click=  0 cond= 0
Project · Dashboard tab                  req=  1 actions= 1 api= 0 sql=   6 auth=  0 storage= 0 redis= 0 rest= 0 fetch= 0 click=  0 cond= 0
Project · Docs tab                       req=  3 actions= 3 api= 0 sql=  26 auth=  4 storage= 1 redis= 0 rest= 0 fetch= 2 click=  0 cond= 2
Project · Updates tab                    req=  8 actions= 7 api= 1 sql=  53 auth=  3 storage= 0 redis= 4 rest= 0 fetch= 0 click=  7 cond= 6
Project · Tasks tab                      req=  6 actions= 6 api= 0 sql=  16 auth=  4 storage= 0 redis= 1 rest= 0 fetch= 0 click=  5 cond= 1
Project · Files tab                      req= 14 actions=14 api= 0 sql=  55 auth= 13 storage= 0 redis= 1 rest= 0 fetch= 1 click= 33 cond= 4
Project · Sprints tab                    req=  2 actions= 2 api= 0 sql=  24 auth=  2 storage= 0 redis= 0 rest= 0 fetch= 0 click=  6 cond= 2
Project · Settings tab                   req=  8 actions= 6 api= 2 sql=  34 auth=  8 storage= 0 redis= 4 rest= 0 fetch= 0 click= 25 cond= 1
```

## Not measured

Signed-in INP, TBT, TTI, LCP, CLS, hydration and React render counts: deferred to the final phase (needs a signed-in session).
