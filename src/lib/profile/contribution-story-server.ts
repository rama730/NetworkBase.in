import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import type { ProfileCollaborationContribution } from "@/lib/profile/collaboration";
import {
  storyReferences,
  type ContributionStory,
  type ResolvedStoryReference,
  type StoryReferenceKind,
} from "./contribution-story";

export type ContributionReferenceOption = ResolvedStoryReference & {
  mimeType?: string | null;
};
/** Public-resource resolution is intentionally uncached. Labels never come from client-authored tokens. */
export async function contributionReferenceOptions(
  projectId: string | null,
  kind: StoryReferenceKind,
  query = "",
  ids?: string[],
): Promise<ContributionReferenceOption[]> {
  if (kind === "activity") return [];
  if (!projectId) return [];
  const like =
    "%" +
    query
      .trim()
      .replace(/^@/, "")
      .slice(0, 100)
      .replace(/[\\%_]/g, "\\$&") +
    "%";
  const wanted = ids
    ? sql`id::text IN (SELECT jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb))`
    : sql`true`;
  const rows = await db.execute<{
    id: string;
    label: string;
    href: string;
    mime_type: string | null;
  }>(sql`
    WITH project AS (
      SELECT id,slug,owner_id,public_tab_visibility,visibility,status FROM projects
      WHERE id=${projectId}::uuid AND deleted_at IS NULL
    ), candidates AS (
      SELECT p.id::text AS id, COALESCE(NULLIF(p.full_name,''),p.username,'Contributor') AS label,
        '/u/'||COALESCE(p.username,p.id::text) AS href, NULL::text AS mime_type,
        COALESCE(p.username,'') AS search_text
      FROM profiles p,project j
      WHERE ${kind}='person' AND p.deleted_at IS NULL AND p.visibility='public'
        AND (p.id=j.owner_id OR EXISTS(SELECT 1 FROM project_members m WHERE m.project_id=j.id AND m.user_id=p.id))
      UNION ALL
      SELECT n.id::text,n.name,'/projects/'||COALESCE(j.slug,j.id::text)||'?tab=files&fileId='||n.id::text,n.mime_type,NULL::text
      FROM project_nodes n,project j WHERE ${kind}='file' AND n.project_id=j.id AND n.type='file'
        AND n.deleted_at IS NULL AND n.task_id IS NULL AND n.path NOT LIKE '/.system/%'
        AND j.visibility IN ('public','unlisted') AND j.status<>'draft' AND COALESCE((j.public_tab_visibility->>'files')::boolean,false)
      UNION ALL
      SELECT t.id::text,t.title,'/projects/'||COALESCE(j.slug,j.id::text)||'?tab=tasks&drawerType=task&drawerId='||t.id::text,NULL::text,NULL::text
      FROM tasks t,project j WHERE ${kind}='task' AND t.project_id=j.id AND t.deleted_at IS NULL
        AND j.visibility IN ('public','unlisted') AND j.status<>'draft' AND COALESCE((j.public_tab_visibility->>'tasks')::boolean,false)
      UNION ALL
      SELECT s.id::text,s.name,'/projects/'||COALESCE(j.slug,j.id::text)||'?tab=sprints&sprintId='||s.id::text,NULL::text,NULL::text
      FROM project_sprints s,project j WHERE ${kind}='sprint' AND s.project_id=j.id
        AND j.visibility IN ('public','unlisted') AND j.status<>'draft' AND COALESCE((j.public_tab_visibility->>'sprints')::boolean,false)
    ) SELECT * FROM candidates WHERE (${wanted}) AND (label ILIKE ${like} OR search_text ILIKE ${like}) ORDER BY label,id LIMIT ${ids ? 200 : 30}
  `);
  return Array.from(rows, (r) => ({
    kind,
    id: r.id,
    label: r.label,
    href: r.href,
    available: true,
    mimeType: r.mime_type,
  }));
}
export async function resolveStoryReferences(
  story: ContributionStory,
  projectId: string | null,
  fileCount: number,
): Promise<ResolvedStoryReference[]> {
  const refs = storyReferences(story.summary).slice(0, 200);
  const unique = Array.from(
    new Map(refs.map((r) => [`${r.kind}:${r.id}`, r])).values(),
  );
  const resolved = await Promise.all(
    (["person", "file", "task", "sprint"] as const).map(async (kind) => {
      const ids = unique.filter((r) => r.kind === kind).map((r) => r.id);
      return ids.length
        ? contributionReferenceOptions(projectId, kind, "", ids)
        : [];
    }),
  );
  const map = new Map(resolved.flat().map((r) => [`${r.kind}:${r.id}`, r]));
  return unique.map((ref) =>
    ref.kind === "activity" && projectId
      ? {
          ...ref,
          label: `Contributed to ${fileCount} workspace files`,
          href: null,
          available: true,
        }
      : (map.get(`${ref.kind}:${ref.id}`) ?? {
          ...ref,
          label:
            ref.kind === "person"
              ? "Unavailable person"
              : `Unavailable ${ref.kind}`,
          href: null,
          available: false,
        }),
  );
}
/** No private draft is accepted on this path. Only call with a server-selected published snapshot. */
export async function hydratePublicStory(
  contribution: ProfileCollaborationContribution,
) {
  const [resolvedReferences, draftReferences] = await Promise.all([
    contribution.presentation
      ? resolveStoryReferences(
          contribution.presentation,
          contribution.projectId,
          contribution.fileContributionCount ?? 0,
        )
      : [],
    contribution.draftStory
      ? resolveStoryReferences(
          contribution.draftStory,
          contribution.projectId,
          contribution.fileContributionCount ?? 0,
        )
      : [],
  ]);
  const presentation = contribution.presentation;
  if (!presentation)
    return {
      ...contribution,
      resolvedReferences,
      ...(contribution.draftStory ? { draftReferences } : {}),
    };
  const projectImageIds = presentation.images.flatMap((image) =>
    image.projectFileId ? [image.projectFileId] : [],
  );
  const available = projectImageIds.length
    ? await contributionReferenceOptions(
        contribution.projectId,
        "file",
        "",
        projectImageIds,
      )
    : [];
  const safeImages = presentation.images.filter(
    (image) =>
      !image.projectFileId ||
      (image.permission &&
        available.some((file) => file.id === image.projectFileId)),
  );
  return {
    ...contribution,
    presentation: {
      ...presentation,
      skills: contribution.skills,
      images: safeImages,
      coverId: safeImages.some((image) => image.id === presentation.coverId)
        ? presentation.coverId
        : (safeImages[0]?.id ?? null),
    },
    resolvedReferences,
    ...(contribution.draftStory ? { draftReferences } : {}),
  };
}
