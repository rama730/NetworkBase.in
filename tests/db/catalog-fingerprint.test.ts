import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { catalogFingerprint, diffFingerprints } from "../../scripts/lib/catalog-fingerprint";
import { inRollback, sql } from "./_helpers";

after(() => sql.end());

// MIG-002: the replay gate compares effective authority, so every one of
// these changes must show up even when all names stay the same.
const CHANGES: Record<string, string> = {
  "same policy name on another table": `CREATE POLICY tasks_update_project_writer ON public.projects FOR UPDATE TO authenticated USING (true)`,
  "changed USING": `ALTER POLICY profiles_select_visible ON public.profiles USING (true)`,
  "changed WITH CHECK": `ALTER POLICY tasks_insert_project_writer ON public.tasks WITH CHECK (true)`,
  "changed policy roles": `ALTER POLICY tasks_update_project_writer ON public.tasks TO anon, authenticated`,
  "extra permissive policy": `CREATE POLICY extra_open ON public.tasks FOR SELECT TO anon USING (true)`,
  "table grant": `GRANT INSERT ON public.tasks TO authenticated`,
  "column grant": `GRANT UPDATE (title) ON public.tasks TO authenticated`,
  "function EXECUTE": `REVOKE EXECUTE ON FUNCTION app_private.chat_is_member(uuid, uuid) FROM authenticated`,
  "function body": `CREATE OR REPLACE FUNCTION app_private.nb_fingerprint_probe() RETURNS int LANGUAGE sql AS 'SELECT 1'`,
  "RLS disabled": `ALTER TABLE public.tasks DISABLE ROW LEVEL SECURITY`,
  "default privileges": `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT DELETE ON TABLES TO anon`,
  "check constraint": `ALTER TABLE public.tasks ADD CONSTRAINT probe_check CHECK (title <> '') NOT VALID`,
  "view security_invoker": `ALTER VIEW public.onboarding_slo_daily SET (security_invoker = false)`,
  "bucket made public": `UPDATE storage.buckets SET public = NOT public WHERE id = (SELECT min(id) FROM storage.buckets)`,
  "partition grant": `GRANT SELECT ON public.chat_messages_p00 TO anon`,
  "partition RLS": `ALTER TABLE public.chat_messages_p00 DISABLE ROW LEVEL SECURITY`,
  "sequence grant": `GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO anon`,
  "security definer owner": `ALTER FUNCTION app_private.chat_is_member(uuid, uuid) OWNER TO service_role`,
};

let baseline: string[] = [];
before(async () => {
  baseline = await catalogFingerprint(sql);
});

for (const [name, statement] of Object.entries(CHANGES)) {
  test(`fingerprint detects: ${name}`, async () => {
    const changed = await inRollback(async (tx) => {
      await tx.unsafe(statement);
      return catalogFingerprint(tx as unknown as typeof sql);
    });
    assert.notEqual(diffFingerprints(baseline, changed).length, 0);
  });
}

test("fingerprint is stable and folds partitions into their parent", async () => {
  assert.deepEqual(await catalogFingerprint(sql), baseline);
  assert.ok(!baseline.some((line) => /chat_messages_p\d+/.test(line)), "partition children are not listed");
  assert.ok(baseline.some((line) => line.startsWith("relation public.chat_messages kind=p")));
});
