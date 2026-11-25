/** What a chat file is, from its type, else its extension. Audio first: an .ogg voice note is audio, not video. */
export function mediaKind(mime: string | null | undefined, name: string | null | undefined): "image" | "video" | "audio" | "file" {
  const type = (mime ?? "").toLowerCase();
  const ext = (name ?? "").toLowerCase().split(".").pop() ?? "";
  if (type.startsWith("audio/") || ["ogg", "oga", "opus", "mp3", "m4a", "wav", "aac", "flac"].includes(ext)) return "audio";
  if (type.startsWith("video/") || ["mp4", "webm", "mov", "ogv", "m4v"].includes(ext)) return "video";
  if (type.startsWith("image/")) return "image";
  return "file";
}

const PREVIEW = /^[0-9a-f]{864}$/;

/** The 12×12 pixel preview (RGB hex, row by row) as 144 CSS colours, or null when missing or malformed. */
export function parsePreview(hex: string | null | undefined): string[] | null {
  if (!hex || !PREVIEW.test(hex)) return null;
  return Array.from({ length: 144 }, (_, i) => `#${hex.slice(i * 6, i * 6 + 6)}`);
}

/** Optional media extras from the client, kept only when well formed (the DB checks the same). */
export function cleanMediaExtras(input: { preview?: unknown; durationMs?: unknown; peaks?: unknown }) {
  const preview = typeof input.preview === "string" && PREVIEW.test(input.preview) ? input.preview : null;
  const durationMs = Number.isSafeInteger(input.durationMs) && (input.durationMs as number) >= 0 && (input.durationMs as number) <= 86_400_000 ? (input.durationMs as number) : null;
  const peaks = Array.isArray(input.peaks) && input.peaks.length <= 48 && input.peaks.every((p) => Number.isInteger(p) && p >= 0 && p <= 100) ? (input.peaks as number[]) : null;
  return { preview, durationMs, peaks };
}
