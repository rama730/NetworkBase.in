import * as dotenv from 'dotenv';
import postgres from 'postgres';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { assertDisposableDatabaseUrl } from './lib/disposable-db';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env.local') });

const DATABASE_URL = process.env.E2E_DATABASE_URL;
const TARGET_EMAIL = process.env.E2E_USER_EMAIL || 'codex.e2e.smoke@example.com';
const E2E_RUN_ID = process.env.E2E_RUN_ID || 'local';

if (!DATABASE_URL) {
    console.error('E2E_DATABASE_URL is required and must identify a disposable test database');
    process.exit(1);
}
assertDisposableDatabaseUrl(DATABASE_URL, 'seed:e2e:fixtures');

const sql = postgres(DATABASE_URL, {
    prepare: false,
    ssl: 'require',
});

const FIXTURE_TAG = `e2e-smoke-fixture:${E2E_RUN_ID}`;
const PEER_USER_ID = '25adfef8-81fd-4f53-b6a2-2132ca1b0a1b';
const APP_PROJECT_ID = '4adbd756-cf5f-4cea-b13c-2bff6512d98f';
const APP_ROLE_ID = '20075878-a4f2-4af8-8ef8-f1dce85eac5d';
const APP_ID = 'bb49eb63-4afe-4f72-b670-c5e3a71149ab';
const FILES_ROOT_NODE_ID = 'e695a4d5-8e1d-4537-8bc1-df47f0f8e8f3';

const HUB_PROJECT_FIXTURES = [
    {
        id: 'd1f3096a-dfa0-4e18-864a-c08dedf40ec4',
        slug: 'e2e-files-workspace-controls',
        title: 'QA Files Workspace Controls',
        description: 'Runner/search controls QA fixture',
    },
    {
        id: '7bc4dbb9-8edf-4434-9fa0-95f26fddce13',
        slug: 'e2e-hub-pagination-alpha',
        title: 'QA Hub Pagination Alpha',
        description: 'Hub pagination fixture alpha',
    },
    {
        id: '9406ca80-f8e2-4d45-bd9c-169d413229db',
        slug: 'e2e-hub-pagination-beta',
        title: 'QA Hub Pagination Beta',
        description: 'Hub pagination fixture beta',
    },
    {
        id: '2e602530-bf89-4dbb-9f06-5f78be16d446',
        slug: 'e2e-hub-pagination-gamma',
        title: 'QA Hub Pagination Gamma',
        description: 'Hub pagination fixture gamma',
    },
    {
        id: 'e8a3564f-3204-46d8-bce4-cb6d5cf6e755',
        slug: 'e2e-hub-pagination-delta',
        title: 'QA Hub Pagination Delta',
        description: 'Hub pagination fixture delta',
    },
    {
        id: 'ef2a1547-7db8-432a-9ae8-f2c23e3fbc08',
        slug: 'e2e-hub-pagination-epsilon',
        title: 'QA Hub Pagination Epsilon',
        description: 'Hub pagination fixture epsilon',
    },
];

async function ensureUsernameGuardrailObjects() {
    await sql`
        create table if not exists public.reserved_usernames (
            username text primary key,
            reason text,
            created_at timestamptz not null default now()
        )
    `;

    await sql`
        create or replace function public.enforce_profile_username_rules()
        returns trigger
        language plpgsql
        set search_path = ''
        as $$
        begin
            if new.username is null then
                return new;
            end if;

            new.username := lower(trim(new.username));

            if new.username !~ '^[a-z0-9_]{3,20}$' then
                raise exception using errcode = '23514', message = 'Invalid username format';
            end if;

            if exists (
                select 1 from public.reserved_usernames where username = new.username
            ) then
                raise exception using errcode = '23514', message = 'Username is reserved';
            end if;

            return new;
        end;
        $$;
    `;
}

async function ensureTargetUserProfileId(email: string): Promise<string> {
    const existingProfile = await sql<{ id: string }[]>`
        select id
        from profiles
        where email = ${email}
        limit 1
    `;
    if (existingProfile[0]?.id) {
        return existingProfile[0].id;
    }

    const authUser = await sql<{ id: string; email: string }[]>`
        select id, email
        from auth.users
        where email = ${email}
        limit 1
    `;
    if (!authUser[0]?.id) {
        throw new Error(`No auth.users row found for ${email}`);
    }

    const fallbackUsername = email.split('@')[0]?.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 20) || 'e2e_user';

    await sql`
        insert into profiles (id, email, username, full_name, created_at, updated_at)
        values (${authUser[0].id}, ${email}, ${fallbackUsername}, 'E2E Smoke', now(), now())
        on conflict (id) do update
        set email = excluded.email,
            username = coalesce(profiles.username, excluded.username),
            updated_at = now()
    `;

    return authUser[0].id;
}

async function seedFixtures() {
    await ensureUsernameGuardrailObjects();
    const targetUserId = await ensureTargetUserProfileId(TARGET_EMAIL);

    await sql.begin(async (tx: any) => {
        // A profile is a child of an Auth identity, so the disposable Auth user comes first (MAINT-005).
        await tx`
            insert into auth.users (id, email)
            values (${PEER_USER_ID}, 'codex.e2e.peer@example.com')
            on conflict (id) do nothing
        `;
        await tx`
            insert into profiles (id, email, username, full_name, created_at, updated_at)
            values (
                ${PEER_USER_ID},
                'codex.e2e.peer@example.com',
                'e2e_peer_user',
                'E2E Peer User',
                now(),
                now()
            )
            on conflict (id) do update
            set email = excluded.email,
                username = excluded.username,
                full_name = excluded.full_name,
                updated_at = now()
        `;

        // A DM from the peer, so the chat list has a conversation with an unread message.
        await tx`
            select app_private.chat_send_message(
                app_private.chat_get_or_create_dm(${PEER_USER_ID}::uuid, ${targetUserId}::uuid, 'invite'),
                ${PEER_USER_ID}::uuid,
                ${`Seeded conversation for E2E messaging checks [${E2E_RUN_ID}]`},
                ${`e2e-seed:${E2E_RUN_ID}`},
                null, '{}'::uuid[], null, '[]'::jsonb, null
            )
        `;

        await tx`
            insert into workspaces (
                id,
                owner_id,
                title,
                slug,
                description,
                visibility,
                status,
                created_at,
                updated_at
            )
            values (
                ${APP_PROJECT_ID},
                ${PEER_USER_ID},
                'E2E Applications Fixture Project',
                'e2e-applications-fixture-project',
                'Fixture project for applications/messages smoke checks',
                'public',
                'active',
                now(),
                now()
            )
            on conflict (id) do update
            set owner_id = excluded.owner_id,
                title = excluded.title,
                slug = excluded.slug,
                description = excluded.description,
                visibility = excluded.visibility,
                status = excluded.status,
                updated_at = now()
        `;

        await tx`
            insert into workspace_open_roles (
                id,
                workspace_id,
                role,
                title,
                description,
                count,
                filled,
                skills,
                created_at,
                updated_at
            )
            values (
                ${APP_ROLE_ID},
                ${APP_PROJECT_ID},
                'engineer',
                'QA Engineer',
                'Fixture role for e2e smoke',
                1,
                0,
                '[]'::jsonb,
                now(),
                now()
            )
            on conflict (id) do update
            set workspace_id = excluded.workspace_id,
                role = excluded.role,
                title = excluded.title,
                description = excluded.description,
                updated_at = now()
        `;

        await tx`
            insert into role_applications (
                id,
                workspace_id,
                role_id,
                applicant_id,
                creator_id,
                message,
                status,
                created_at,
                updated_at
            )
            values (
                ${APP_ID},
                ${APP_PROJECT_ID},
                ${APP_ROLE_ID},
                ${targetUserId},
                ${PEER_USER_ID},
                ${`Seeded outgoing application for E2E smoke validation [${E2E_RUN_ID}]`},
                'pending',
                now(),
                now()
            )
            on conflict (id) do update
            set workspace_id = excluded.workspace_id,
                role_id = excluded.role_id,
                applicant_id = excluded.applicant_id,
                creator_id = excluded.creator_id,
                message = excluded.message,
                status = 'pending',
                updated_at = now()
        `;
        // The project's #general and the application's private thread with its card.
        await tx`select app_private.chat_sync_workspace_members(${APP_PROJECT_ID}::uuid, null, 'ensure_default')`;
        await tx`select app_private.chat_ensure_application_channel(${APP_ID}::uuid)`;

        for (let index = 0; index < HUB_PROJECT_FIXTURES.length; index += 1) {
            const fixture = HUB_PROJECT_FIXTURES[index];
            if (!fixture) continue;
            const shiftedSeconds = 3600 + index;

            await tx`
                insert into workspaces (
                    id,
                    owner_id,
                    title,
                    slug,
                    description,
                    visibility,
                    status,
                    created_at,
                    updated_at
                )
                values (
                    ${fixture.id},
                    ${targetUserId},
                    ${fixture.title},
                    ${fixture.slug},
                    ${fixture.description},
                    'public',
                    'active',
                    now() - (${shiftedSeconds} * interval '1 second'),
                    now() - (${shiftedSeconds} * interval '1 second')
                )
                on conflict (id) do update
                set owner_id = excluded.owner_id,
                    title = excluded.title,
                    slug = excluded.slug,
                    description = excluded.description,
                    visibility = excluded.visibility,
                    status = excluded.status,
                    created_at = excluded.created_at,
                    updated_at = excluded.updated_at
            `;

            await tx`
                insert into workspace_members (workspace_id, user_id, role, joined_at)
                values (${fixture.id}, ${targetUserId}, 'owner', now())
                on conflict (workspace_id, user_id) do update
                set role = 'owner'
            `;
        }

        await tx`
            insert into workspace_nodes (
                id,
                workspace_id,
                parent_id,
                type,
                name,
                created_by,
                metadata,
                created_at,
                updated_at
            )
            values (
                ${FILES_ROOT_NODE_ID},
                ${HUB_PROJECT_FIXTURES[0]!.id},
                null,
                'folder',
                'workspace',
                ${targetUserId},
                ${JSON.stringify({ fixture: FIXTURE_TAG })}::jsonb,
                now(),
                now()
            )
            on conflict (id) do update
            set workspace_id = excluded.workspace_id,
                type = excluded.type,
                name = excluded.name,
                updated_at = now()
        `;
    });

    const [conversationCount] = await sql<{ count: number }[]>`
        select count(*)::int as count
        from chat_channel_members
        where user_id = (select id from profiles where email = ${TARGET_EMAIL} limit 1)
          and archived_at is null
    `;
    const [applicationCount] = await sql<{ count: number }[]>`
        select count(*)::int as count
        from role_applications
        where applicant_id = (select id from profiles where email = ${TARGET_EMAIL} limit 1)
           or creator_id = (select id from profiles where email = ${TARGET_EMAIL} limit 1)
    `;
    const [publicProjectCount] = await sql<{ count: number }[]>`
        select count(*)::int as count
        from workspaces
        where visibility = 'public'
          and status = 'active'
    `;

    console.log('E2E fixture seed complete');
    console.log(
        JSON.stringify(
            {
                targetEmail: TARGET_EMAIL,
                conversationCount: conversationCount?.count ?? 0,
                applicationCount: applicationCount?.count ?? 0,
                publicProjectCount: publicProjectCount?.count ?? 0,
            },
            null,
            2,
        ),
    );
}

seedFixtures()
    .catch((error) => {
        console.error('Failed to seed E2E fixtures:', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await sql.end();
    });
