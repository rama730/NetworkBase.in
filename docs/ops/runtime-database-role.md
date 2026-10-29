# Runtime database role (nb_app)

Production used to connect as `postgres`, which bypasses row-level security and can change or drop any table. Migration `0268_app_runtime_role` adds `nb_app`. This role:

- reads and writes rows in `public`, uses its sequences, and calls functions in `public`, `extensions` and `app_private`;
- has an allow-all policy (`nb_app_all`) on every public table. Authorization stays in the app code, as before. A table-creation hook (`nb_app_policy_for_new_tables`) adds the policy to new tables;
- reaches Supabase's `auth` and `storage` tables only through seven `app_private.nb_*` functions. They run as `postgres` and return only the columns the code reads. Only `nb_app` may call them;
- **cannot** create, alter, drop or truncate tables, create roles, or read password hashes and tokens.

Migrations keep running as `postgres` from `.env.local`. Only Railway's `DATABASE_URL` changes.

## Rollout

Each step that touches production needs its own go-ahead.

1. **Apply 0268**: `npm run db:setup`. The live code keeps working, because `postgres` can still do everything and the trigger rewrite behaves the same.
2. **Deploy the code that uses the `app_private` functions** (push `main`). It still connects as `postgres` at this point.
3. **Give nb_app a password.** In the Supabase SQL editor, run this with a long random password (for example from `openssl rand -base64 32`):
   ```sql
   ALTER ROLE nb_app WITH LOGIN PASSWORD '<password>';
   ```
4. **Build the connection string.** It's the current one with the user and password swapped. The pooler user is `nb_app.<project-ref>`; `<project-ref>` is the part after `postgres.` in today's user name.
   ```
   postgresql://nb_app.<project-ref>:<password>@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres
   ```
5. **Check it from your machine first.** This confirms the pooler accepts the role and that it is least-privilege:
   ```bash
   RUNTIME_DATABASE_URL='<connection string>' npm run check:db:runtime-role
   ```
   It should print `[runtime-database-role] ok (nb_app)`.
6. **Switch Railway.** Set `DATABASE_URL` to the new string on **networkbase-web** and **networkbase-worker**, and keep the old value for rollback. Each service redeploys.
7. **Verify.**
   - `https://networkbase.in/api/v1/ready` returns 200, and the worker logs show no `permission denied`.
   - Sign in, open Settings → Security (sessions list, sign out another session), open a workspace's files, and like an update.
   - To keep the release gate passing, add the new string to `.env.local` as `RUNTIME_DATABASE_URL`.

## Rollback

Put the old `DATABASE_URL` back on both Railway services. Migration 0268 can stay: `postgres` ignores the new policies, and the `app_private` functions work for it too.

## Tests

- `tests/db/app-runtime-role.test.ts` covers the role's limits, the policies and the hook, and the `auth`/`storage` functions.
- `NB_TEST_APP_ROLE=nb_app npm run test:db` runs the whole database suite with app code connected as `nb_app`.
