import type { ProfileCollaborationContribution } from "@/lib/profile/collaboration";
import { z } from "zod";
import { isSafeHttpUrl } from "@/lib/security/urls";
import { contributionPositionName } from "./contribution-position";

export const STORY_LIMITS = {
  summary: 10_000,
  positions: 20,
  images: 8,
  links: 8,
  skills: 20,
  imageBytes: 10 * 1024 * 1024,
} as const;
const month = z
  .string()
  .regex(/^(\d{4}-(0[1-9]|1[0-2]))?$/, "Use a month and year");
const id = z.string().uuid();
// Incomplete links are valid private drafts; publication validates their destination.
const url = z.string().max(2048);
export const storyPositionSchema = z
  .object({
    id,
    recordedStageId: z.string().max(160).nullable(),
    title: z.string().max(120),
    start: month,
    end: month,
    current: z.boolean(),
    description: z.string().max(2000),
    hidden: z.boolean(),
  })
  .strict();
export const storyImageSchema = z
  .object({
    id,
    assetId: id,
    caption: z.string().max(500),
    alt: z.string().max(500),
    positionId: id.nullable(),
    projectFileId: id.nullable(),
    permission: z.boolean(),
  })
  .strict();
export const contributionStorySchema = z
  .object({
    schema: z.literal(1),
    title: z.string().max(120),
    summary: z.string().max(STORY_LIMITS.summary),
    start: month,
    end: month,
    current: z.boolean(),
    visible: z.boolean(),
    allowUnlisted: z.boolean(),
    positions: z.array(storyPositionSchema).max(STORY_LIMITS.positions),
    images: z.array(storyImageSchema).max(STORY_LIMITS.images),
    coverId: id.nullable(),
    skills: z.array(z.string().trim().min(1).max(80)).max(STORY_LIMITS.skills),
    links: z
      .array(z.object({ id, label: z.string().max(80), url }).strict())
      .max(STORY_LIMITS.links),
  })
  .strict();
export type ContributionStory = z.infer<typeof contributionStorySchema>;
export type StoryPosition = ContributionStory["positions"][number];
export type StoryImage = ContributionStory["images"][number];
/** Repair generated legacy labels without overwriting personal title overrides or historical dates. */
export function reconcileRecordedPositionTitles(
  story: ContributionStory | null,
  stages: NonNullable<ProfileCollaborationContribution["roleStages"]>,
): ContributionStory | null {
  if (!story) return null;
  return {
    ...story,
    positions: story.positions.map((position) => {
      const stage = stages.find(
        (stage) => stage.id === position.recordedStageId,
      );
      if (!stage) return position;
      const name = contributionPositionName(position.title);
      return !name || name === contributionPositionName(stage.roleTitle)
        ? { ...position, title: stage.roleTitle }
        : position;
    }),
  };
}
export type StoryReferenceKind =
  | "person"
  | "file"
  | "task"
  | "sprint"
  | "activity";
export type StoryReference = { kind: StoryReferenceKind; id: string };
export type ResolvedStoryReference = StoryReference & {
  label: string;
  href: string | null;
  available: boolean;
};
export const STORY_REFERENCE_PATTERN =
  /\{%\s*ref\.(person|file|task|sprint|activity)\s+id="([a-zA-Z0-9:_-]{1,160})"\s*%\}/g;
export function storyReferences(summary: string): StoryReference[] {
  return Array.from(
    summary.matchAll(new RegExp(STORY_REFERENCE_PATTERN)),
    (m) => ({ kind: m[1] as StoryReferenceKind, id: m[2]! }),
  );
}
export function referenceToken(kind: StoryReferenceKind, refId: string) {
  return `{% ref.${kind} id="${refId}" %}`;
}
export function blankContributionStory(title = ""): ContributionStory {
  return {
    schema: 1,
    title,
    summary: "",
    start: "",
    end: "",
    current: false,
    visible: false,
    allowUnlisted: false,
    positions: [],
    images: [],
    coverId: null,
    skills: [],
    links: [],
  };
}
export function parseContributionStory(
  value: unknown,
): ContributionStory | null {
  const parsed = contributionStorySchema.safeParse(value);
  return parsed.success ? reconcileStoryCurrentStatus(parsed.data) : null;
}
/** The personal project period bounds its positions, without changing team records or inventing end dates. */
export function reconcileStoryCurrentStatus(
  story: ContributionStory,
): ContributionStory {
  if (!story.current) {
    if (!story.positions.some((position) => position.current)) return story;
    return {
      ...story,
      positions: story.positions.map((position) =>
        position.current ? { ...position, current: false } : position,
      ),
    };
  }
  const currentCount = story.positions.filter((p) => p.current).length;
  if (currentCount <= 1) return story;
  let foundActive = false;
  const positions = story.positions.map((p) => {
    if (!p.current) return p;
    if (!foundActive) {
      foundActive = true;
      return p;
    }
    return { ...p, current: false };
  });
  return { ...story, positions };
}
export function storyMonth(value: string) {
  return value
    ? new Date(value.slice(0, 7) + "-01T00:00:00Z").toLocaleDateString(
        "en-US",
        { month: "short", year: "numeric", timeZone: "UTC" },
      )
    : "";
}
export function storyPeriod(value: {
  start: string;
  end: string;
  current: boolean;
}) {
  if (!value.start)
    return value.current
      ? "Currently contributing"
      : value.end
        ? `Until ${storyMonth(value.end)}`
        : "";
  if (!value.current && !value.end) return storyMonth(value.start);
  return `${storyMonth(value.start)} – ${value.current ? "Present" : storyMonth(value.end)}`;
}
export function positionDuration(positions: StoryPosition[], now = new Date()) {
  const index = (value: string) =>
    Number(value.slice(0, 4)) * 12 + Number(value.slice(5, 7));
  const currentMonth = now.toISOString().slice(0, 7);
  const ranges = positions
    .filter((p) => !p.hidden && p.start && (p.current || p.end))
    .map(
      (p) =>
        [index(p.start), index(p.current ? currentMonth : p.end)] as [
          number,
          number,
        ],
    )
    .sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last && range[0] <= last[1] + 1) last[1] = Math.max(last[1], range[1]);
    else merged.push([...range]);
  }
  const months = merged.reduce(
    (sum, [a, b]) => sum + Math.max(0, b - a + 1),
    0,
  );
  return months
    ? [
        months >= 12 ? `${Math.floor(months / 12)} yr` : "",
        months % 12 ? `${months % 12} mo` : "",
      ]
        .filter(Boolean)
        .join(" ")
    : null;
}
export function sortedStoryPositions(positions: StoryPosition[]) {
  return positions
    .filter((p) => !p.hidden)
    .sort(
      (a, b) =>
        Number(b.current) - Number(a.current) ||
        b.start.localeCompare(a.start) ||
        a.id.localeCompare(b.id),
    );
}
export function storyValidation(
  story: ContributionStory,
  options: { publish?: boolean; platform?: boolean; now?: Date } = {},
) {
  const errors: Array<{
    section: "identity" | "summary" | "positions" | "work" | "skills";
    message: string;
    imageId?: string;
    field?: "image-description" | "image-permission";
  }> = [];
  const currentMonth = (options.now ?? new Date()).toISOString().slice(0, 7);
  if (options.publish && !story.title.trim())
    errors.push({ section: "identity", message: "Enter a project name." });
  if (
    options.publish &&
    !story.summary.trim() &&
    !story.positions.some((p) => !p.hidden && p.title.trim()) &&
    !story.images.length
  )
    errors.push({
      section: "summary",
      message: "Add a summary, position, or work example before publishing.",
    });
  if (options.publish)
    for (const link of story.links)
      if (link.url && !isSafeHttpUrl(link.url))
        errors.push({
          section: "skills",
          message: "Supporting links must use a public HTTP(S) URL.",
        });
  for (const period of [story, ...story.positions]) {
    if (period.start > currentMonth || period.end > currentMonth)
      errors.push({
        section: "positions",
        message: "Contribution dates cannot be in the future.",
      });
    if (period.start && period.end && period.end < period.start)
      errors.push({
        section: "positions",
        message: "End month cannot be earlier than start month.",
      });
    if (period.current && period.end)
      errors.push({
        section: "positions",
        message: "Current positions cannot have an end date.",
      });
  }
  for (const p of story.positions) {
    if (options.publish && !p.hidden && !p.title.trim())
      errors.push({
        section: "positions",
        message: "Name each visible position or remove it.",
      });
    if (
      (story.start && p.start && p.start < story.start) ||
      (story.end &&
        ((p.end && p.end > story.end) || p.start > story.end || p.current))
    )
      errors.push({
        section: "positions",
        message: "Position dates must fit within your contribution period.",
      });
  }
  if (
    new Set(story.positions.map((p) => p.id)).size !== story.positions.length ||
    new Set(story.images.map((p) => p.id)).size !== story.images.length
  )
    errors.push({
      section: "positions",
      message: "Duplicate positions or images are not supported.",
    });
  if (story.coverId && !story.images.some((i) => i.id === story.coverId))
    errors.push({
      section: "work",
      message: "Choose a cover from your work examples.",
    });
  for (const image of story.images) {
    if (options.publish && !image.alt.trim())
      errors.push({
        section: "work",
        message: "Add a short description for each published image.",
        imageId: image.id,
        field: "image-description",
      });
    if (options.publish && image.projectFileId && !image.permission)
      errors.push({
        section: "work",
        message: "Confirm permission to publish each project image.",
        imageId: image.id,
        field: "image-permission",
      });
    if (
      image.positionId &&
      !story.positions.some((p) => p.id === image.positionId)
    )
      errors.push({
        section: "work",
        message: "An image refers to a position that no longer exists.",
      });
  }
  return errors;
}
export function removeStoryPosition(
  story: ContributionStory,
  positionId: string,
): ContributionStory {
  const role = story.positions.find((p) => p.id === positionId);
  if (role?.recordedStageId)
    return {
      ...story,
      positions: story.positions.map((p) =>
        p.id === positionId ? { ...p, hidden: !p.hidden } : p,
      ),
    };
  return {
    ...story,
    positions: story.positions.filter((p) => p.id !== positionId),
    images: story.images.map((i) =>
      i.positionId === positionId ? { ...i, positionId: null } : i,
    ),
  };
}
export function storyProjectLinks(links: ContributionStory["links"]) {
  const repository = (link: ContributionStory["links"][number]) => {
    if (/^(repository|repo|source(?: code)?)$/i.test(link.label.trim()))
      return true;
    try {
      return /^(github\.com|gitlab\.com|bitbucket\.org)$/i.test(
        new URL(link.url).hostname,
      );
    } catch {
      return false;
    }
  };
  const safe = links.filter((link) => isSafeHttpUrl(link.url));
  return {
    identity: safe.filter(
      (l) =>
        repository(l) || /^(project )?(website|site)$/i.test(l.label.trim()),
    ),
    supporting: safe.filter(
      (l) =>
        !repository(l) && !/^(project )?(website|site)$/i.test(l.label.trim()),
    ),
  };
}
export function mergeContributionStory(
  base: ContributionStory,
  mine: ContributionStory,
  theirs: ContributionStory,
): ContributionStory {
  function merge(a: unknown, b: unknown, c: unknown): unknown {
    if (JSON.stringify(a) === JSON.stringify(b)) return c;
    if (
      JSON.stringify(a) === JSON.stringify(c) ||
      JSON.stringify(b) === JSON.stringify(c)
    )
      return b;
    if (
      Array.isArray(a) &&
      Array.isArray(b) &&
      Array.isArray(c) &&
      [...a, ...b, ...c].every((v) => v && typeof v === "object" && "id" in v)
    ) {
      const am = new Map(a.map((v) => [v.id, v])),
        bm = new Map(b.map((v) => [v.id, v])),
        cm = new Map(c.map((v) => [v.id, v]));
      return Array.from(new Set([...bm.keys(), ...cm.keys()])).flatMap((id) => {
        if (!bm.has(id) && am.has(id)) return [];
        if (
          !cm.has(id) &&
          am.has(id) &&
          JSON.stringify(bm.get(id)) === JSON.stringify(am.get(id))
        )
          return [];
        return [merge(am.get(id), bm.get(id), cm.get(id))].filter(
          (v) => v !== undefined,
        );
      });
    }
    if (
      a &&
      b &&
      c &&
      typeof a === "object" &&
      typeof b === "object" &&
      typeof c === "object" &&
      !Array.isArray(a) &&
      !Array.isArray(b) &&
      !Array.isArray(c)
    ) {
      const x = a as Record<string, unknown>,
        y = b as Record<string, unknown>,
        z = c as Record<string, unknown>;
      return Object.fromEntries(
        Array.from(new Set([...Object.keys(y), ...Object.keys(z)])).map((k) => [
          k,
          merge(x[k], y[k], z[k]),
        ]),
      );
    }
    return b;
  }
  return merge(base, mine, theirs) as ContributionStory;
}

export function storyFromContribution(
  contribution: ProfileCollaborationContribution,
): ContributionStory {
  const existing =
    parseContributionStory(contribution.draftStory) ??
    parseContributionStory(contribution.presentation);
  if (existing) {
    const missing = (contribution.roleStages ?? []).filter(
      (stage) =>
        contribution.projectId &&
        !existing.positions.some((p) => p.recordedStageId === stage.id),
    );
    // Reconcile new recorded stages into the owner's next draft, never into a published snapshot.
    if (!contribution.draftStory || !missing.length) return existing;
    return reconcileStoryCurrentStatus({
      ...existing,
      positions: [
        ...existing.positions,
        ...missing.map((stage) => ({
          id: stage.id.includes(":") ? contribution.id : stage.id,
          recordedStageId: stage.id,
          title: stage.roleTitle,
          start: stage.startDate?.slice(0, 7) ?? "",
          end: stage.endDate?.slice(0, 7) ?? "",
          current: existing.current && stage.currentlyActive,
          description: stage.summary ?? "",
          hidden: false,
        })),
      ].slice(0, 20),
    });
  }
  const story = blankContributionStory(contribution.projectTitle);
  const validId = (value: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    );
  return {
    ...story,
    summary: contribution.description ?? "",
    start: contribution.startDate?.slice(0, 7) ?? "",
    end: contribution.endDate?.slice(0, 7) ?? "",
    current: contribution.currentlyActive,
    visible: contribution.visibility === "public",
    skills: contribution.skills,
    positions: (contribution.roleStages ?? []).map((stage) => ({
      id: validId(stage.id) ? stage.id : contribution.id,
      recordedStageId: contribution.projectId ? stage.id : null,
      title: stage.roleTitle,
      start: stage.startDate?.slice(0, 7) ?? "",
      end: stage.endDate?.slice(0, 7) ?? "",
      current: contribution.currentlyActive && stage.currentlyActive,
      description: stage.summary ?? "",
      hidden: false,
    })),
    links: [
      ...(contribution.projectUrl
        ? [
            {
              id: contribution.id,
              label: "Project website",
              url: contribution.projectUrl,
            },
          ]
        : []),
      ...(contribution.repoUrl
        ? [
            {
              id: contribution.id,
              label: "Repository",
              url: contribution.repoUrl,
            },
          ]
        : []),
    ],
  };
}
