import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as dotenv from "dotenv";
import postgres from "postgres";

import {
  WORKSPACE_UPDATE_ALLOWED_IMAGE_MIME_TYPES,
  WORKSPACE_UPDATE_MEDIA_BUCKET,
  WORKSPACE_UPDATE_SCHEMA_CONTRACT,
} from "../src/lib/workspaces/updates";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", ".env.local") });

const DATABASE_URL = process.env.DATABASE_URL;

const REQUIRED_TASK_COLUMNS = [
  "timeline_origin_sprint_id",
  "timeline_origin_at",
] as const;

const MIME_RESTRICTED_BUCKETS = ["project-files", "task-files"] as const;
// Mirrors the project-files bucket in drizzle/0003_storage.sql; a later bucket change updates both.
const PROJECT_FILE_ALLOWED_MIME_TYPES = [
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/html",
  "text/css",
  "text/javascript",
  "text/xml",
  "application/json",
  "application/xml",
  "application/octet-stream",
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/svg+xml",
  "image/bmp",
  "image/tiff",
  "image/avif",
  "image/x-icon",
  "image/vnd.microsoft.icon",
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-msvideo",
  "video/mpeg",
  "video/ogg",
  "video/3gpp",
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/ogg",
  "audio/aac",
  "audio/mp4",
  "audio/x-m4a",
  "audio/webm",
  "audio/flac",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/zip",
  "application/x-zip-compressed",
  "application/x-tar",
  "application/gzip",
  "application/x-gzip",
  "application/x-7z-compressed",
  "application/x-rar-compressed",
] as const;

// Applications are read by the server only; browser roles hold no grant on them (0199).
const MESSAGING_AUTHORITY_TABLES = [
  "role_applications",
  "application_events",
] as const;

const REQUIRED_LIFECYCLE_INDEXES = [
  "profile_audit_events_retention_idx",
  "onboarding_events_retention_idx",
  "extension_device_session_events_retention_idx",
] as const;

// Chat (0014_messaging). Partitions of the hash-partitioned tables keep RLS on
// with no policy so they can only be read through their parent.
const CHAT_TABLES = [
  "chat_channels",
  "chat_channel_members",
  "chat_messages",
  "chat_message_cards",
  "chat_attachments",
  "chat_reactions",
  "chat_mentions",
  "chat_thread_follows",
  "chat_pins",
  "chat_reports",
  "chat_canvases",
  "chat_saved",
  "chat_channel_tabs",
  "chat_scheduled_messages",
] as const;
const CHAT_PARTITION_PATTERN = /^chat_(messages|attachments|reactions)_p\d{2}$/;

const ALLOWED_SECURITY_DEFINER_FUNCTIONS = new Map([
  ["public.rls_auto_enable", "search_path=pg_catalog"],
  ["public.sync_profile_to_auth_user_metadata", "search_path=\"\""],
]);

const ALLOWED_PUBLIC_RLS_NO_POLICY_TABLES = new Set([
  "app_migration_journal",
  "extension_device_session_events",
  "extension_device_sessions",
  "extension_recovery_sessions",
  "import_job_files",
  "import_jobs",
  "job_heartbeats",
  // 0205: server-only email queue, delivery receipts and suppression history.
  "email_outbox",
  "email_webhook_events",
  "email_suppressions",
  // 0213: durable leases for long-running server work.
  "work_leases",
  // 0214: applied Redis counter batches (exactly-once flush identity).
  "counter_flush_batches",
  "github_contributor_identities",
  "github_sync_connections",
  "github_sync_files",
  "github_sync_runs",
  "legal_acceptances",
  "workspace_git_deltas",
  "github_sync_snapshot_assets",
  "workspace_event_counters",
  "workspace_node_conflicts",
  "project_node_events_2026_01",
  "project_node_events_2026_02",
  "project_node_events_2026_03",
  "project_node_events_2026_04",
  "project_node_events_2026_05",
  "project_node_events_2026_06",
  "project_node_events_2026_07",
  "project_node_events_2026_08",
  "project_node_events_2026_09",
  "project_node_events_2026_10",
  "project_node_events_2026_11",
  "project_node_events_2026_12",
  "project_node_events_default",
  "reserved_usernames",
  "workspace_update_draft_media_assets",
  "workspace_update_media_assets",
  "storage_asset_operations",
  "storage_asset_pins",
  // 0233: task completion policy history, written and read by the server only.
  "workspace_task_policy_events",
  // Organizations (0241, 0243, 0244, 0246): server-only tables; browser roles hold no grant on them.
  "org_handle_holds",
  "org_join_blocks",
  "org_email_invites",
  "sprint_materials",
  "task_team_members",
  "doc_opens",
  // 0254: content reports, read and written by the server (platform admins review them).
  "content_reports",
  "storage_assets",
  "storage_legacy_cleanup_targets",
  "storage_quota_scopes",
  "storage_repair_failures",
  // Lifecycle records are server-only; RLS without client policies
  // is intentional so task/Sprint history is accessed through authorized actions.
  "workspace_sprint_events",
  "task_activity_events",
  "task_pushes",
  "task_read_receipts",
  "sprint_task_memberships",
]);

if (!DATABASE_URL) {
  console.error("[db-catalog-drift] DATABASE_URL not found in .env.local");
  process.exit(1);
}

const sql = postgres(DATABASE_URL, {
  prepare: false,
  // Local disposable databases (npm run db:disposable) run without TLS.
  ssl: /@(localhost|127\.0\.0\.1)[:/]/.test(DATABASE_URL) ? false : "require",
  max: 1,
});

async function main() {
  const errors: string[] = [];
  const notes: string[] = [];

  const taskColumnRows = await sql<{ column_name: string }[]>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'tasks'
      AND column_name = ANY(${REQUIRED_TASK_COLUMNS})
  `;
  const taskColumns = new Set(taskColumnRows.map((row) => row.column_name));
  for (const column of REQUIRED_TASK_COLUMNS) {
    if (!taskColumns.has(column)) {
      errors.push(`missing tasks.${column}; apply the Sprint history migration`);
    }
  }

  const tableRows = await sql<{ table_name: string }[]>`
    SELECT c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relname = ANY(${WORKSPACE_UPDATE_SCHEMA_CONTRACT.tables})
  `;
  const tables = new Set(tableRows.map((row) => row.table_name));
  for (const table of WORKSPACE_UPDATE_SCHEMA_CONTRACT.tables) {
    if (!tables.has(table)) errors.push(`missing project update table public.${table}`);
  }

  const policyRows = await sql<{ tablename: string; count: number }[]>`
    SELECT tablename, COUNT(*)::int AS count
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = ANY(${WORKSPACE_UPDATE_SCHEMA_CONTRACT.tables})
    GROUP BY tablename
  `;
  const policies = new Map(policyRows.map((row) => [row.tablename, row.count]));
  const minPolicyCounts = WORKSPACE_UPDATE_SCHEMA_CONTRACT.minPolicyCounts as Record<string, number>;
  for (const [table, minPolicyCount] of Object.entries(minPolicyCounts)) {
    const count = policies.get(table) ?? 0;
    if (count < minPolicyCount) {
      errors.push(`public.${table} has ${count} policy/policies, expected at least ${minPolicyCount}`);
    }
  }

  // Live screens use private broadcasts (0034); a published table would be unused load.
  const realtimeRows = await sql<{ tablename: string }[]>`
    SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime'
  `;
  for (const { tablename } of realtimeRows) {
    errors.push(`${tablename} is in the supabase_realtime publication; nothing listens to it`);
  }

  const [bucketRow] = await sql<{
    id: string;
    public: boolean;
    file_size_limit: number | null;
    allowed_mime_types: string[] | null;
  }[]>`
    SELECT id, public, file_size_limit, allowed_mime_types
    FROM storage.buckets
    WHERE id = ${WORKSPACE_UPDATE_MEDIA_BUCKET}
    LIMIT 1
  `;
  if (!bucketRow) {
    errors.push(`missing storage bucket ${WORKSPACE_UPDATE_MEDIA_BUCKET}`);
  } else {
    if (bucketRow.public !== false) errors.push(`${WORKSPACE_UPDATE_MEDIA_BUCKET} bucket must be private`);
    if (Number(bucketRow.file_size_limit ?? 0) !== 8 * 1024 * 1024) {
      errors.push(`${WORKSPACE_UPDATE_MEDIA_BUCKET} bucket file_size_limit differs from the 8 MiB application contract`);
    }
    const allowedMimeTypes = [...(bucketRow.allowed_mime_types ?? [])].sort();
    const expectedMimeTypes = Array.from(WORKSPACE_UPDATE_ALLOWED_IMAGE_MIME_TYPES).sort();
    if (JSON.stringify(allowedMimeTypes) !== JSON.stringify(expectedMimeTypes)) {
      errors.push(`${WORKSPACE_UPDATE_MEDIA_BUCKET} bucket MIME allowlist differs from the canonical contract`);
    }
  }

  const realtimePolicyRows = await sql<{ policyname: string }[]>`
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'realtime'
      AND tablename = 'messages'
      AND policyname IN ('application_topic_read', 'application_topic_send')
  `;
  const realtimePolicies = new Set(realtimePolicyRows.map((row) => row.policyname));
  for (const policyName of ['application_topic_read', 'application_topic_send']) {
    if (!realtimePolicies.has(policyName)) {
      errors.push(`missing realtime.messages authorization policy ${policyName}`);
    }
  }

  const storagePolicyRows = await sql<{ policyname: string }[]>`
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND (
        qual LIKE '%' || ${WORKSPACE_UPDATE_MEDIA_BUCKET} || '%'
        OR with_check LIKE '%' || ${WORKSPACE_UPDATE_MEDIA_BUCKET} || '%'
      )
  `;
  if (storagePolicyRows.length > 0) {
    errors.push(`${WORKSPACE_UPDATE_MEDIA_BUCKET} must not have direct browser storage policies`);
  }

  const restrictedBucketRows = await sql<{ id: string; allowed_mime_types: string[] | null }[]>`
    SELECT id, allowed_mime_types
    FROM storage.buckets
    WHERE id = ANY(${MIME_RESTRICTED_BUCKETS})
  `;
  const restrictedBuckets = new Map(restrictedBucketRows.map((row) => [row.id, row.allowed_mime_types]));
  for (const bucketId of MIME_RESTRICTED_BUCKETS) {
    const allowedMimeTypes = [...(restrictedBuckets.get(bucketId) ?? [])].sort();
    const expectedMimeTypes = [...PROJECT_FILE_ALLOWED_MIME_TYPES].sort();
    if (JSON.stringify(allowedMimeTypes) !== JSON.stringify(expectedMimeTypes)) {
      errors.push(`${bucketId} bucket MIME allowlist differs from the canonical contract`);
    }
  }

  const securityDefinerRows = await sql<{ function_name: string; config: string[] | null }[]>`
    SELECT
      n.nspname || '.' || p.proname AS function_name,
      p.proconfig AS config
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.prosecdef
      AND n.nspname = 'public'
    ORDER BY function_name
  `;
  const securityDefiners = new Map(
    securityDefinerRows.map((row) => [row.function_name, row.config ?? []]),
  );
  for (const functionName of securityDefiners.keys()) {
    if (!ALLOWED_SECURITY_DEFINER_FUNCTIONS.has(functionName)) {
      errors.push(`unexpected SECURITY DEFINER function ${functionName}`);
    }
  }
  for (const [functionName, expectedSearchPath] of ALLOWED_SECURITY_DEFINER_FUNCTIONS.entries()) {
    const config = securityDefiners.get(functionName);
    if (!config) {
      errors.push(`missing expected SECURITY DEFINER function ${functionName}`);
      continue;
    }
    if (!config.includes(expectedSearchPath)) {
      errors.push(`${functionName} must set ${expectedSearchPath}`);
    }
  }

  const noPolicyRows = await sql<{ table_name: string }[]>`
    SELECT c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relrowsecurity
      AND NOT EXISTS (
        SELECT 1
        FROM pg_policy p
        WHERE p.polrelid = c.oid
      )
    ORDER BY c.relname
  `;
  for (const row of noPolicyRows) {
    if (!ALLOWED_PUBLIC_RLS_NO_POLICY_TABLES.has(row.table_name) && !CHAT_PARTITION_PATTERN.test(row.table_name)) {
      errors.push(`public.${row.table_name} has RLS enabled with no policy but is not allowlisted`);
    }
  }

  const [nativeHardeningRow] = await sql<{
    profile_auth_fk: boolean;
    archive_rls: boolean;
    workflow_search_path: boolean;
    anon_can_execute_workflow_seed: boolean;
    authenticated_can_execute_workflow_seed: boolean;
  }[]>`
    SELECT
      EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.profiles'::regclass
          AND conname = 'profiles_id_auth_users_fk'
      ) AS profile_auth_fk,
      -- 0204 dropped the retired-domain archive; it must not come back unprotected.
      to_regclass('app_private.retired_domain_archive') IS NULL AS archive_rls,
      COALESCE((
        SELECT p.proconfig @> ARRAY['search_path=""']::text[]
        FROM pg_proc p
        WHERE p.oid = to_regprocedure('public.seed_workspace_workflow_columns()')
      ), false) AS workflow_search_path,
      has_function_privilege('anon', 'public.seed_workspace_workflow_columns()', 'EXECUTE') AS anon_can_execute_workflow_seed,
      has_function_privilege('authenticated', 'public.seed_workspace_workflow_columns()', 'EXECUTE') AS authenticated_can_execute_workflow_seed
  `;
  if (!nativeHardeningRow?.profile_auth_fk) errors.push("profiles is missing the auth.users identity FK invariant");
  if (!nativeHardeningRow?.archive_rls) errors.push("app_private.retired_domain_archive was dropped in 0204 and must not reappear");
  if (!nativeHardeningRow?.workflow_search_path) errors.push("seed_workspace_workflow_columns must set an empty search_path");
  if (nativeHardeningRow?.anon_can_execute_workflow_seed || nativeHardeningRow?.authenticated_can_execute_workflow_seed) {
    errors.push("client roles must not execute seed_workspace_workflow_columns directly");
  }

  const mergedContributionPolicies = await sql<{ tablename: string; count: number }[]>`
    SELECT tablename, count(*)::int AS count
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('profile_contributions', 'profile_contribution_stages')
      AND cmd = 'SELECT'
    GROUP BY tablename
  `;
  for (const tableName of ["profile_contributions", "profile_contribution_stages"] as const) {
    const count = mergedContributionPolicies.find((row) => row.tablename === tableName)?.count ?? 0;
    if (count !== 1) errors.push(`public.${tableName} must have one consolidated SELECT policy; found ${count}`);
  }

  const partitionShadowRows = await sql<{ relname: string; row_count: number }[]>`
    SELECT c.relname, COALESCE(s.n_live_tup, 0)::int AS row_count
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
    WHERE n.nspname = 'public'
      AND c.relname IN ('tasks_partitioned')
    ORDER BY c.relname
  `;
  for (const row of partitionShadowRows) {
    notes.push(`${row.relname} is retained as a legacy shadow partition table (${row.row_count} estimated row(s)); app code uses the canonical unpartitioned table.`);
  }

  const lifecycleIndexRows = await sql<{ indexname: string }[]>`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = ANY(${REQUIRED_LIFECYCLE_INDEXES})
  `;
  const lifecycleIndexes = new Set(lifecycleIndexRows.map((row) => row.indexname));
  for (const indexName of REQUIRED_LIFECYCLE_INDEXES) {
    if (!lifecycleIndexes.has(indexName)) {
      errors.push(`missing lifecycle retention index ${indexName}`);
    }
  }
  const messagingPolicyRows = await sql<{
    tablename: string;
    cmd: string;
    roles: string[];
  }[]>`
    SELECT tablename, cmd, roles
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = ANY(${MESSAGING_AUTHORITY_TABLES})
      AND policyname <> 'nb_app_all' -- the server runtime role's policy (0268), not a browser one
  `;
  for (const tableName of MESSAGING_AUTHORITY_TABLES) {
    const tablePolicies = messagingPolicyRows.filter((row) => row.tablename === tableName);
    if (tablePolicies.length === 0) {
      errors.push(`public.${tableName} has no authenticated SELECT policy`);
      continue;
    }
    for (const policy of tablePolicies) {
      if (policy.cmd !== "SELECT" || !policy.roles.includes("authenticated")) {
        errors.push(`public.${tableName} policy must be SELECT-only TO authenticated`);
      }
    }
  }

  const messagingGrantRows = await sql<{
    table_name: string;
    grantee: string;
    privilege_type: string;
  }[]>`
    SELECT table_name, grantee, privilege_type
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name = ANY(${MESSAGING_AUTHORITY_TABLES})
      AND grantee IN ('anon', 'authenticated')
  `;
  // Browser roles read only the tables the UI uses (0199); applications are server-read.
  for (const grant of messagingGrantRows) {
    errors.push(`unexpected ${grant.privilege_type} grant on public.${grant.table_name} to ${grant.grantee}`);
  }

  // Report 10.3: nothing of the old conversation/message system may remain.
  const oldMessagingRows = await sql<{ k: string; n: string }[]>`
    SELECT 'table' AS k, tablename AS n FROM pg_tables
     WHERE schemaname = 'public' AND tablename ~ 'conversation|^message|^dm_pairs|typing_ind|attachment_uploads'
    UNION ALL
    SELECT 'func', p.proname FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace
     WHERE s.nspname IN ('public', 'app_private') AND p.proname ~ 'conversation|^handle_message|typing'
    UNION ALL
    SELECT 'col', table_name || '.' || column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND column_name ~ 'conversation_id'
    UNION ALL
    SELECT 'policy', policyname FROM pg_policies WHERE policyname ~ 'conversation|^message_|^messages_|dm_pairs'
    UNION ALL
    SELECT 'pub', tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename ~ 'conversation|message|typing'
  `;
  for (const row of oldMessagingRows) errors.push(`old messaging ${row.k} still present: ${row.n}`);

  const chatPolicyRows = await sql<{ tablename: string; cmd: string; roles: string[] }[]>`
    SELECT tablename, cmd, roles FROM pg_policies
    WHERE schemaname = 'public' AND tablename = ANY(${CHAT_TABLES}) AND policyname <> 'nb_app_all'
  `;
  const chatRlsRows = await sql<{ relname: string; relrowsecurity: boolean }[]>`
    SELECT c.relname, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = ANY(${CHAT_TABLES})
  `;
  for (const tableName of CHAT_TABLES) {
    const rls = chatRlsRows.find((row) => row.relname === tableName);
    if (!rls) {
      errors.push(`public.${tableName} is missing (0014_messaging)`);
      continue;
    }
    if (!rls.relrowsecurity) errors.push(`public.${tableName} must have RLS enabled`);
    const policies = chatPolicyRows.filter((row) => row.tablename === tableName);
    if (policies.length === 0) errors.push(`public.${tableName} has no authenticated SELECT policy`);
    for (const policy of policies) {
      if (policy.cmd !== "SELECT" || !policy.roles.includes("authenticated")) {
        errors.push(`public.${tableName} policy must be SELECT-only TO authenticated`);
      }
    }
  }
  const chatGrantRows = await sql<{ table_name: string; grantee: string; privilege_type: string }[]>`
    SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated')
      AND (table_name = ANY(${CHAT_TABLES}) OR table_name ~ '^chat_(messages|attachments|reactions)_p[0-9]{2}$')
  `;
  for (const grant of chatGrantRows) {
    if (grant.grantee === "anon" || grant.privilege_type !== "SELECT" || CHAT_PARTITION_PATTERN.test(grant.table_name)) {
      errors.push(`unexpected ${grant.privilege_type} grant on public.${grant.table_name} to ${grant.grantee}`);
    }
  }
  const chatFunctionRows = await sql<{ proname: string; prosecdef: boolean; config: string[] | null }[]>`
    SELECT p.proname, p.prosecdef, p.proconfig AS config FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'app_private' AND p.proname LIKE 'chat\\_%'
  `;
  if (chatFunctionRows.length === 0) errors.push("app_private chat functions are missing (0014_messaging)");
  for (const fn of chatFunctionRows) {
    if (!fn.prosecdef || !(fn.config ?? []).some((entry) => entry === 'search_path=""' || entry === "search_path=")) {
      errors.push(`app_private.${fn.proname} must be SECURITY DEFINER with search_path = ''`);
    }
  }
  const chatTopicRows = await sql<{ policyname: string; definition: string }[]>`
    SELECT policyname, coalesce(qual, '') || coalesce(with_check, '') AS definition FROM pg_policies
    WHERE schemaname = 'realtime' AND tablename = 'messages'
      AND policyname IN ('application_topic_read', 'application_topic_send')
  `;
  for (const row of chatTopicRows) {
    if (!row.definition.includes("chat:channel:")) {
      errors.push(`realtime.messages ${row.policyname} must authorize chat:channel topics`);
    }
    if (!row.definition.includes("chat:typing:")) {
      errors.push(`realtime.messages ${row.policyname} must authorize chat:typing topics (0183)`);
    }
  }

  if (errors.length > 0) {
    console.error("[db-catalog-drift] failed:");
    for (const error of errors) console.error(`- ${error}`);
    if (notes.length > 0) {
      console.error("[db-catalog-drift] notes:");
      for (const note of notes) console.error(`- ${note}`);
    }
    process.exit(1);
  }

  console.log("[db-catalog-drift] ok");
  for (const note of notes) console.log(`[db-catalog-drift] ${note}`);
}

main()
  .catch((error) => {
    console.error("[db-catalog-drift] failed:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  })
  .finally(async () => {
    await sql.end({ timeout: 5 }).catch(() => undefined);
  });
