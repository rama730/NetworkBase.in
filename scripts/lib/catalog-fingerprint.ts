/**
 * Effective-catalog fingerprint (MIG-001, MIG-002): one line per app-owned
 * object, carrying what decides behaviour and authority, not just names.
 * Policies carry roles, command, permissiveness and USING/CHECK; tables,
 * columns, schemas, functions and default privileges carry grants for the
 * roles a browser or service key can act as.
 *
 * Partitions are a family rule: they inherit columns, constraints, indexes
 * and triggers from their parent, and time partitions differ between
 * databases by creation date, so only the parent and its partition key count.
 * Extension members are not app-owned and are skipped.
 */
import type postgres from "postgres";

const APP_SCHEMAS = ["public", "app_private"];
const POLICY_SCHEMAS = ["public", "app_private", "storage", "realtime"];
/** Roles whose grants are security relevant; "-" is PUBLIC. */
const TRACKED_ROLES = ["anon", "authenticated", "service_role", "-"];

export async function catalogFingerprint(sql: postgres.Sql): Promise<string[]> {
  const rows = await sql<{ line: string }[]>`
    WITH app_ns AS (
      SELECT oid, nspname FROM pg_namespace WHERE nspname = ANY(${APP_SCHEMAS})
    ),
    ext AS (
      SELECT objid FROM pg_depend WHERE deptype = 'e'
    ),
    rels AS (
      SELECT c.oid, n.nspname || '.' || c.relname AS name, c.relkind, c.relrowsecurity, c.relforcerowsecurity, c.relacl, c.relowner
      FROM pg_class c JOIN app_ns n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f') AND NOT c.relispartition AND c.oid NOT IN (SELECT objid FROM ext)
    ),
    grantee AS (
      SELECT oid, rolname FROM pg_roles UNION ALL SELECT 0, '-'
    )
    SELECT 'relation ' || name || ' kind=' || relkind::text || ' rls=' || relrowsecurity || '/' || relforcerowsecurity
      || CASE WHEN relkind = 'p' THEN ' partition=' || pg_get_partkeydef(oid) ELSE '' END
      || CASE WHEN relkind IN ('v', 'm') THEN ' def=' || md5(pg_get_viewdef(oid)) ELSE '' END AS line
    FROM rels
    UNION ALL
    SELECT 'column ' || r.name || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
      || CASE WHEN a.attnotnull THEN ' not-null' ELSE '' END
      || coalesce(' default=' || pg_get_expr(d.adbin, d.adrelid), '')
      || CASE WHEN a.attidentity <> '' THEN ' identity=' || a.attidentity::text ELSE '' END
      || CASE WHEN a.attgenerated <> '' THEN ' generated' ELSE '' END
    FROM rels r
    JOIN pg_attribute a ON a.attrelid = r.oid AND a.attnum > 0 AND NOT a.attisdropped
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    UNION ALL
    SELECT 'constraint ' || r.name || '.' || c.conname || ' ' || pg_get_constraintdef(c.oid)
    FROM rels r JOIN pg_constraint c ON c.conrelid = r.oid AND c.conparentid = 0
    UNION ALL
    SELECT 'index ' || r.name || ' ' || pg_get_indexdef(i.indexrelid)
    FROM rels r JOIN pg_index i ON i.indrelid = r.oid
    UNION ALL
    SELECT 'trigger ' || r.name || ' ' || pg_get_triggerdef(t.oid)
    FROM rels r JOIN pg_trigger t ON t.tgrelid = r.oid AND NOT t.tgisinternal AND t.tgparentid = 0
    UNION ALL
    SELECT 'policy ' || p.schemaname || '.' || p.tablename || '.' || p.policyname || ' ' || p.cmd || ' ' || p.permissive
      || ' roles=' || array_to_string(ARRAY(SELECT unnest(p.roles) ORDER BY 1), ',')
      || coalesce(' using=' || p.qual, '') || coalesce(' check=' || p.with_check, '')
    FROM pg_policies p WHERE p.schemaname = ANY(${POLICY_SCHEMAS})
    UNION ALL
    SELECT 'rls-table ' || n.nspname || '.' || c.relname || ' rls=' || c.relrowsecurity
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('storage', 'realtime') AND c.relkind IN ('r', 'p') AND NOT c.relispartition
      AND EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid)
    UNION ALL
    SELECT 'grant ' || g.rolname || ' ' || x.privilege_type || ' on ' || r.name
    FROM rels r, aclexplode(coalesce(r.relacl, acldefault('r', r.relowner))) x JOIN grantee g ON g.oid = x.grantee
    WHERE g.rolname = ANY(${TRACKED_ROLES})
    UNION ALL
    SELECT 'grant ' || g.rolname || ' ' || x.privilege_type || ' on ' || r.name || '.' || a.attname
    FROM rels r JOIN pg_attribute a ON a.attrelid = r.oid AND a.attacl IS NOT NULL, aclexplode(a.attacl) x JOIN grantee g ON g.oid = x.grantee
    WHERE g.rolname = ANY(${TRACKED_ROLES})
    UNION ALL
    SELECT 'grant ' || g.rolname || ' ' || x.privilege_type || ' on schema ' || n.nspname
    FROM pg_namespace n, aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) x JOIN grantee g ON g.oid = x.grantee
    WHERE n.nspname = ANY(${APP_SCHEMAS}) AND g.rolname = ANY(${TRACKED_ROLES})
    UNION ALL
    SELECT 'function ' || n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') def=' || md5(pg_get_functiondef(p.oid))
    FROM pg_proc p JOIN app_ns n ON n.oid = p.pronamespace
    WHERE p.prokind IN ('f', 'p') AND p.oid NOT IN (SELECT objid FROM ext)
    UNION ALL
    SELECT 'grant ' || g.rolname || ' EXECUTE on ' || n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
    FROM pg_proc p JOIN app_ns n ON n.oid = p.pronamespace, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x JOIN grantee g ON g.oid = x.grantee
    WHERE p.prokind IN ('f', 'p') AND p.oid NOT IN (SELECT objid FROM ext) AND g.rolname = ANY(${TRACKED_ROLES})
    UNION ALL
    SELECT 'enum ' || n.nspname || '.' || t.typname || ' ' || array_to_string(ARRAY(SELECT e.enumlabel FROM pg_enum e WHERE e.enumtypid = t.oid ORDER BY e.enumsortorder), ',')
    FROM pg_type t JOIN app_ns n ON n.oid = t.typnamespace
    WHERE t.typtype = 'e' AND t.oid NOT IN (SELECT objid FROM ext)
    UNION ALL
    SELECT 'default-acl ' || pg_get_userbyid(d.defaclrole) || ' ' || coalesce(n.nspname, '*') || ' ' || d.defaclobjtype::text || ' ' || g.rolname || ' ' || x.privilege_type
    FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace, aclexplode(d.defaclacl) x JOIN grantee g ON g.oid = x.grantee
    WHERE (n.nspname IS NULL OR n.nspname = ANY(${APP_SCHEMAS})) AND g.rolname = ANY(${TRACKED_ROLES})
    UNION ALL
    SELECT 'publication ' || pubname || ' ' || schemaname || '.' || tablename
    FROM pg_publication_tables WHERE schemaname = ANY(${APP_SCHEMAS})
  `;
  return rows.map((row) => row.line).sort();
}

/** Lines only in `expected` (-) or only in `actual` (+). */
export function diffFingerprints(expected: string[], actual: string[]) {
  const want = new Set(expected);
  const have = new Set(actual);
  return [
    ...expected.filter((line) => !have.has(line)).map((line) => `- ${line}`),
    ...actual.filter((line) => !want.has(line)).map((line) => `+ ${line}`),
  ];
}
