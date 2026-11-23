import { z } from "zod";

import { zonedInstant, zonedParts } from "@/lib/workflows/request-clock";

/**
 * Report 38.8 T5 (plan A2.7): Content. A content item is a task with item_type "content"; channels and types are one
 * workspace setting (call 6), kept in workspaces.workflow_settings.content. Only the Blog and Social setups (call 1).
 */
export const SETUPS = ["blog", "social"] as const;
export type Setup = (typeof SETUPS)[number];

const channel = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  name: z.string().trim().min(1).max(40),
  icon: z.string().regex(/^[A-Za-z0-9]{1,40}$/),
  audience: z.number().int().min(0).max(1_000_000_000).nullable(),
  updates: z.boolean(),
  archived: z.boolean(),
}).strict();
const type = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  name: z.string().trim().min(1).max(40),
  formats: z.array(z.string().trim().min(1).max(40)).max(10),
  checklist: z.array(z.string().trim().min(1).max(120)).max(10),
  editorId: z.string().uuid().nullable(),
}).strict();
export const contentSettingsSchema = z.object({
  setups: z.array(z.enum(SETUPS)).min(1).max(2),
  channels: z.array(channel).max(20),
  types: z.array(type).max(20),
  defaultTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
}).strict();
export type ContentSettings = z.infer<typeof contentSettingsSchema>;
export type ContentChannel = ContentSettings["channels"][number];
export type ContentType = ContentSettings["types"][number];

const BLOG: Array<[string, string, string, boolean]> = [["blog", "Blog", "PenLine", true], ["newsletter", "Newsletter", "Mail", false]];
const SOCIAL: Array<[string, string, string, boolean]> = [["instagram", "Instagram", "Camera", false], ["tiktok", "TikTok", "Music2", false], ["youtube", "YouTube", "Video", false],
  ["linkedin", "LinkedIn", "Briefcase", false], ["x", "X", "AtSign", false], ["facebook", "Facebook", "Users", false]];

/** W1.1: the channels a setup offers (Blog posts on NetworkBase Updates by default). */
export function setupChannels(setups: Setup[]): ContentChannel[] {
  return [...(setups.includes("blog") ? BLOG : []), ...(setups.includes("social") ? SOCIAL : [])]
    .map(([id, name, icon, updates]) => ({ id, name, icon, audience: null, updates, archived: false }));
}

const t = (id: string, name: string, checklist: string[] = [], formats: string[] = []): ContentType => ({ id, name, formats, checklist, editorId: null });
/** Part 2: starter types per setup, with the report's checklists. */
export function starterSettings(setups: Setup[]): ContentSettings {
  return {
    setups,
    channels: setupChannels(setups),
    types: [
      ...(setups.includes("blog") ? [t("article", "Article", ["Outline", "Draft", "Images", "SEO title"]), t("newsletter", "Newsletter", ["Draft", "Test send"])] : []),
      ...(setups.includes("social") ? [t("post", "Post", ["Copy", "Image"]), t("reel", "Reel", ["Hook", "Captions", "Cover image"], ["9:16"]), t("carousel", "Carousel", ["Slides", "Caption"]),
        t("thread", "Thread", ["Hook", "Posts"]), t("short", "Short", ["Hook", "Captions"], ["9:16"])] : []),
    ],
    defaultTime: "10:00",
  };
}

/** What a content item keeps in type_fields as people write it; Mark published and Results have their own actions. */
export const contentFieldsSchema = z.object({
  channels: z.array(z.string().regex(/^[a-z0-9-]{1,40}$/)).max(20).optional(),
  publishAt: z.string().datetime().nullable().optional(),
  contentType: z.string().regex(/^[a-z0-9-]{1,40}$/).nullable().optional(),
  format: z.string().trim().max(40).optional(),
  editorId: z.string().uuid().nullable().optional(),
  audience: z.string().trim().max(120).optional(),
  keyword: z.string().trim().max(120).optional(),
  brief: z.string().trim().max(5000).optional(),
  /** The New module's time ("HH:MM"); the server turns it and the Publish date into publishAt and drops it. */
  publishTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
}).strict();

/** Call 7: a piece's publish time at the workspace's default time on a day (also written to the due date). */
export const defaultPublishAt = (day: string, defaultTime: string, tz: string) => zonedInstant(day, defaultTime, tz).toISOString();

/** Call 5: a type's checklist becomes subtasks when a piece enters Drafting. */
export const checklistFor = (type: Pick<ContentType, "checklist"> | undefined) => (type ? [...type.checklist] : []);

/** W7.4: Published on every live channel, some, or none (an archived channel isn't needed). */
export function publishState(channels: string[], published: Record<string, unknown>, all: Array<Pick<ContentChannel, "id" | "archived">>) {
  const needed = channels.filter((c) => !all.find((x) => x.id === c)?.archived);
  const done = needed.filter((c) => published[c]).length;
  return done === 0 ? "none" : done < needed.length ? "partial" : "all";
}

/** S4 This week: Monday to Sunday, each piece under its local publish day, earliest first. */
export function weekDays<T extends { publishAt: string | null }>(monday: string, items: T[], tz: string) {
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(`${monday}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + i); return d.toISOString().slice(0, 10); });
  const placed = items.filter((i) => i.publishAt).map((i) => ({ item: i, ...zonedParts(new Date(i.publishAt!), tz) })).sort((a, b) => Date.parse(a.item.publishAt!) - Date.parse(b.item.publishAt!));
  return days.map((key) => ({ key, items: placed.filter((p) => p.day === key).map((p) => ({ ...p.item, time: p.time })) }));
}
