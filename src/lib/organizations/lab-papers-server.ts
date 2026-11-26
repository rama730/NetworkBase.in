import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { isPublicPaper, memberAuthors, type PaperFields } from "@/lib/organizations/lab-papers";

/** About (call 8): Published papers and marked preprints, never private, from the lab's workspaces. Callers check the lab is readable. */
export async function readLabPublications(orgId: string) {
  const rows = Array.from(await db.execute<{ id: string; title: string; stage: string; fields: PaperFields; year: string }>(sql`
    SELECT t.id, t.title, t.stage, t.type_fields AS fields,
      -- Review: the year it was published (its history), not the last edit.
      coalesce((SELECT left(max(h->>'at'), 4) FROM jsonb_array_elements(coalesce(t.type_fields->'history', '[]'::jsonb)) h WHERE h->>'stage' = 'published'), to_char(t.created_at, 'YYYY')) AS year
    FROM tasks t JOIN workspaces w ON w.id = t.workspace_id
    WHERE w.parent_id = ${orgId}::uuid AND w.deleted_at IS NULL AND w.deletion_scheduled_at IS NULL AND t.item_type = 'paper' AND t.deleted_at IS NULL
      AND coalesce((t.type_fields->>'private')::boolean, false) = false
      AND (t.stage = 'published' OR (t.type_fields->>'kind' = 'preprint' AND coalesce((t.type_fields->>'preprintPublic')::boolean, false) AND t.stage <> 'withdrawn'))
    ORDER BY t.updated_at DESC LIMIT 50`)).filter((r) => isPublicPaper(r.stage, r.fields));
  const ids = [...new Set(rows.flatMap((r) => memberAuthors(r.fields.authors ?? [])))];
  const names = ids.length ? new Map(Array.from(await db.execute<{ id: string; name: string }>(sql`
    SELECT id, CASE WHEN deleted_at IS NULL THEN coalesce(full_name, username, 'Someone') ELSE 'A former member' END AS name FROM profiles WHERE id = ANY(${`{${ids.join(",")}}`}::uuid[])`)).map((p) => [p.id, p.name])) : new Map<string, string>();
  return rows.map((r) => ({ id: r.id, title: r.title, kind: r.fields.kind, venue: r.fields.venue || null, year: r.year, link: r.fields.link || null, doi: r.fields.doi || null,
    authors: r.fields.authors.map((a) => ("userId" in a ? names.get(a.userId) ?? "Someone" : a.name)) }));
}
