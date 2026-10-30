import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

async function main() {
    const root = process.cwd()
    const schemaSource = await readFile(path.join(root, 'src/lib/db/schema/index.ts'), 'utf8')
    const sql = async (file: string) => readFile(path.join(root, 'drizzle', `${file}.sql`), 'utf8')
    const accounts = await sql('0002_profiles_accounts')
    const files = await sql('0009_files')
    const contributions = await sql('0013_contributions')
    const messaging = await sql('0014_messaging')
    const migrationNames = (await readdir(path.join(root, 'drizzle'))).filter((name) => name.endsWith('.sql')).sort()
    const allSql = (await Promise.all(migrationNames.map((name) => readFile(path.join(root, 'drizzle', name), 'utf8')))).join('\n')
    const profilesTable = accounts.slice(accounts.indexOf('CREATE TABLE public.profiles ('), accounts.indexOf(');', accounts.indexOf('CREATE TABLE public.profiles (')))
    const tables = [...allSql.matchAll(/^CREATE TABLE (?:IF NOT EXISTS )?public\.(\w+) \(/gm)].map((match) => match[1]!)
    const profileBrowserColumns = new Set(['id', 'username', 'full_name', 'avatar_url', 'visibility', 'created_at', 'updated_at', 'deleted_at'])
    const browserRoles = '(?:[\\w, ]*\\b(?:anon|authenticated|PUBLIC)\\b[\\w, ]*)'
    const profileGrants = [...allSql.matchAll(new RegExp(`GRANT SELECT\\s*\\(([\\w,\\s]+)\\) ON (?:TABLE )?public\\.profiles TO ${browserRoles};`, 'g'))].flatMap((match) => match[1]!.split(',').map((column) => column.trim()))
    const browserWrites = new RegExp(`GRANT [^;]*\\b(?:INSERT|UPDATE|DELETE|TRUNCATE|ALL)\\b[^;]* ON (?:TABLE |ALL TABLES IN SCHEMA )?public(?:\\.\\w+)?(?:, public\\.\\w+)* TO ${browserRoles};`)
    const setupSource = await readFile(path.join(root, 'scripts/setup-database.ts'), 'utf8')

    const checks: Array<[string, boolean]> = [
        ['chat tables are member-scoped (SELECT-only RLS via chat_is_member)', messaging.includes('app_private.chat_is_member(channel_id, ( SELECT auth.uid() AS uid))')],
        ['the old conversation tables are gone', !/CREATE TABLE public\.(messages|conversations|conversation_participants) /.test(allSql)],
        [
            'schema defines private profile security table',
            /export const profileSecurityStates\s*=\s*pgTable\(\s*["']profile_security_states["']/.test(schemaSource),
        ],
        ['migrations create the profile security table', accounts.includes('CREATE TABLE public.profile_security_states (')],
        ['recovery codes are not on profiles', !profilesTable.includes('security_recovery_codes')],
        ['migrations create upload intents', files.includes('CREATE TABLE public.upload_intents (')],
        ['migrations create recovery code redemptions', accounts.includes('CREATE TABLE public.recovery_code_redemptions (')],
        ['profile security state is own-row only', accounts.includes('CREATE POLICY profile_security_states_select_own ON public.profile_security_states FOR SELECT USING ((( SELECT auth.uid() AS uid) = user_id))')],
        ['profile reads are privacy-aware', allSql.includes('CREATE POLICY profiles_select_visible ON public.profiles FOR SELECT USING (((deleted_at IS NULL) AND ((( SELECT auth.uid() AS uid) = id) OR (visibility =')],
        ['upload intents are own-row only', files.includes('CREATE POLICY upload_intents_select_own ON public.upload_intents FOR SELECT USING ((( SELECT auth.uid() AS uid) = user_id))')],
        ['recovery-code redemption is unique', accounts.includes('CREATE UNIQUE INDEX recovery_code_redemptions_user_code_unique')],
        ['no stale view-all profile policy', !allSql.includes('Users can view all profiles')],
        ['every table enables RLS', tables.length > 100 && tables.every((table) => allSql.includes(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`) || table === 'app_migration_journal')],
        ['account deletions are own-row only', accounts.includes('CREATE POLICY account_deletions_select_own ON public.account_deletions FOR SELECT USING ((user_id = ( SELECT auth.uid() AS uid)))')],
        ['browser roles cannot read all of profiles', !new RegExp(`GRANT (?:SELECT(?!\\s*\\()|ALL)[^;]* ON (?:TABLE )?public\\.profiles TO ${browserRoles};`).test(allSql)],
        ['browser roles read only approved profile columns', profileGrants.length > 0 && profileGrants.every((column) => profileBrowserColumns.has(column))],
        ['browser roles have no write grant on any table', !browserWrites.test(allSql)],
        ['no cross-workspace policy tautologies', !/m\.(project|workspace)_id = m\.(project|workspace)_id/.test(allSql)],
        ['no arbitrary auth-user deletion RPC', !allSql.includes('FUNCTION public.delete_auth_user')],
        ['no broad chat attachment read policy', !allSql.includes('Users can view chat attachments')],
        ['authorization helpers live outside public', !/CREATE (?:OR REPLACE )?FUNCTION public\.nb_/.test(allSql)],
        ['public contribution reads depend on visibility', contributions.includes("CREATE POLICY profile_contributions_read_authorized ON public.profile_contributions FOR SELECT USING (((profile_id = ( SELECT auth.uid() AS uid)) OR ((visibility = 'public'::text)")],
        ['contribution stage reads derive from the parent', /CREATE POLICY profile_contribution_stages_read_authorized[\s\S]*?contribution\.visibility = 'public'::text/.test(contributions)],
        ['contribution skill reads derive from the parent', /CREATE POLICY profile_contribution_skills_select_visible[\s\S]*?contribution\.visibility = 'public'::text/.test(contributions)],
        ['contributions hide private and draft workspaces', /CREATE POLICY profile_contributions_read_authorized[\s\S]*?'draft'/.test(contributions)],
        ['database setup replays migration journal instead of authoring policies directly', setupSource.includes('Starting database setup via Drizzle migrations')],
        ['database setup no longer creates policies directly', !setupSource.includes('CREATE POLICY')],
    ]

    const failed = checks.filter(([, passed]) => !passed)
    if (failed.length > 0) {
        throw new Error(`RLS contract failed: ${failed.map(([label]) => label).join(', ')}`)
    }

    console.log('[rls-contract] ok')
}

main().catch((error) => {
    console.error('[rls-contract] failed:', error)
    process.exit(1)
})

export {}
