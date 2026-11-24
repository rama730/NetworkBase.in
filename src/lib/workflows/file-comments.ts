import { z } from "zod";

/**
 * Report 38.16 O1 W3–W5 (A7.2, calls 2–3): a comment may sit at a spot on an image (x, y within 0–1) or a moment in
 * video or audio (t seconds), the one anchor shape of 28.4. Comments stay on the version they were made on.
 */
export const anchorSchema = z.union([
  z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).strict(),
  z.object({ t: z.number().min(0).max(86_400) }).strict(),
]);
export type Anchor = z.infer<typeof anchorSchema>;
export type MediaKind = "image" | "media" | "other";

export const mediaKindOf = (mime: string | null | undefined): MediaKind => (/^image\//.test(mime ?? "") ? "image" : /^(video|audio)\//.test(mime ?? "") ? "media" : "other");

/** A spot only on images, a moment only on video or audio (within its length when known); none fits anything. */
export function anchorValid(anchor: unknown, kind: MediaKind, duration?: number | null) {
  if (anchor == null) return true;
  const a = anchorSchema.safeParse(anchor);
  if (!a.success) return false;
  if ("x" in a.data) return kind === "image";
  return kind === "media" && (duration == null || a.data.t <= duration + 1);
}

/** "0:42", "1:02:05". */
export function formatMoment(t: number) {
  const s = Math.max(0, Math.floor(t));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
}

type C = { id: string; version: number; anchor: Anchor | null; parentId: string | null; createdAt: string; deletedAt?: string | null };
/** One version's threads, oldest first, pinned ones numbered 1, 2, 3 in order (W3); replies under their comment. */
export function versionComments<T extends C>(comments: T[], version: number) {
  const live = comments.filter((c) => !c.deletedAt);
  const top = live.filter((c) => c.version === version && !c.parentId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  let pin = 0;
  return top.map((c) => ({ ...c, pin: c.anchor ? ++pin : null, replies: live.filter((r) => r.parentId === c.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)) }));
}

/** W5: how many comments sit on other versions, for "n on earlier versions · Show". */
export const otherVersionCount = (comments: C[], version: number) => comments.filter((c) => !c.deletedAt && !c.parentId && c.version !== version).length;
