import { z } from "zod";

/**
 * Report 38.16 O1 (A7.1): an asset is a file with details in its metadata (`metadata.asset`, call 1). Images, video,
 * audio and fonts show in Assets on their own; any other file shows once it's marked as an asset.
 */
export const ASSET_TYPES = ["logo", "photo", "illustration", "video", "footage", "audio", "font", "template", "other"] as const;
export const ASSET_TYPE_LABEL: Record<(typeof ASSET_TYPES)[number], string> = { logo: "Logo", photo: "Photo", illustration: "Illustration", video: "Video", footage: "Footage", audio: "Audio", font: "Font", template: "Template", other: "Other" };
export const PRODUCTION_STATUSES = ["concept", "wip", "review", "final"] as const;
export const PRODUCTION_LABEL: Record<(typeof PRODUCTION_STATUSES)[number], string> = { concept: "Concept", wip: "Work in progress", review: "Review", final: "Final" };

export const assetDetailsSchema = z.object({
  type: z.enum(ASSET_TYPES).optional(),
  tags: z.array(z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{0,29}$/)).max(12).optional(),
  usageRights: z.string().trim().max(300).optional(),
  credit: z.string().trim().max(200).optional(),
  productionStatus: z.enum(PRODUCTION_STATUSES).nullable().optional(),
  notes: z.string().trim().max(2000).optional(),
}).strict();
export type AssetDetails = z.infer<typeof assetDetailsSchema>;

const FONT_EXT = /\.(woff2?|ttf|otf)$/i;
/** Images, video, audio and fonts are assets on their own (call 1). */
export function isAssetMime(mime: string | null | undefined, name = "") {
  return /^(image|video|audio|font)\//.test(mime ?? "") || FONT_EXT.test(name);
}

/** A file's type when no one has set it: from its kind of content. */
export function defaultAssetType(mime: string | null | undefined, name = ""): (typeof ASSET_TYPES)[number] {
  const m = mime ?? "";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  if (m.startsWith("font/") || FONT_EXT.test(name)) return "font";
  if (m === "image/svg+xml") return "logo";
  if (m.startsWith("image/")) return "photo";
  return "other";
}

/** Read details back safely; anything else in metadata is left alone. */
export function readAssetDetails(metadata: unknown): AssetDetails | null {
  const raw = (metadata as { asset?: unknown } | null)?.asset;
  if (!raw || typeof raw !== "object") return null;
  const parsed = assetDetailsSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** W6 (call 6): production status is a grouping, in its order, with "No status" last. */
export function groupByStatus<T extends { details: AssetDetails | null }>(assets: T[]) {
  const groups = [...PRODUCTION_STATUSES.map((s) => ({ id: s as string, label: PRODUCTION_LABEL[s], items: assets.filter((a) => a.details?.productionStatus === s) })),
    { id: "none", label: "No status", items: assets.filter((a) => !a.details?.productionStatus) }];
  return groups.filter((g) => g.items.length);
}

/** Used in: each place once, tasks then documents. */
export function usedIn(tasks: Array<{ id: string; title: string; number: number | null; type: string | null }>, docs: Array<{ slug: string; title: string }>) {
  const seen = new Set<string>();
  const out: Array<{ kind: "task" | "doc"; id: string; label: string; type?: string | null }> = [];
  for (const t of tasks) if (!seen.has(`t:${t.id}`)) { seen.add(`t:${t.id}`); out.push({ kind: "task", id: t.id, label: t.number ? `NB-${t.number} ${t.title}` : t.title, type: t.type }); }
  for (const d of docs) if (!seen.has(`d:${d.slug}`)) { seen.add(`d:${d.slug}`); out.push({ kind: "doc", id: d.slug, label: d.title }); }
  return out;
}

/** A document mentions the file by its path, its name, or its id (image links use one of those). */
export function mentions(text: string, file: { id: string; name: string; path: string }) {
  const enc = (s: string) => [s, encodeURI(s)];
  return [file.id, ...enc(file.path), ...enc(file.name)].some((needle) => needle.length > 2 && text.includes(needle));
}
