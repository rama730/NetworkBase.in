import { attachmentRetryUrl } from './attachment-ttl';

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

/** A canvas for the pixel preview at the photo's own shape (48 px on the long side), so `object-fit: contain` fits it like the photo. */
export function previewCanvasSize(width: number | null | undefined, height: number | null | undefined) {
  if (!width || !height || width <= 0 || height <= 0) return { width: 48, height: 48 };
  const scale = 48 / Math.max(width, height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Paint the 12×12 colours across a canvas of any size, cell by cell. */
export function paintPreview(canvas: HTMLCanvasElement | null, colors: string[]) {
  const ctx = canvas?.getContext('2d');
  if (!canvas || !ctx) return;
  const cw = canvas.width / 12;
  const ch = canvas.height / 12;
  colors.forEach((color, i) => {
    ctx.fillStyle = color;
    ctx.fillRect(Math.floor((i % 12) * cw), Math.floor(Math.floor(i / 12) * ch), Math.ceil(cw), Math.ceil(ch));
  });
}

/** Optional media extras from the client, kept only when well formed (the DB checks the same). */
export function cleanMediaExtras(input: { preview?: unknown; durationMs?: unknown; peaks?: unknown }) {
  const preview = typeof input.preview === "string" && PREVIEW.test(input.preview) ? input.preview : null;
  const durationMs = Number.isSafeInteger(input.durationMs) && (input.durationMs as number) >= 0 && (input.durationMs as number) <= 86_400_000 ? (input.durationMs as number) : null;
  const peaks = Array.isArray(input.peaks) && input.peaks.length <= 48 && input.peaks.every((p) => Number.isInteger(p) && p >= 0 && p <= 100) ? (input.peaks as number[]) : null;
  return { preview, durationMs, peaks };
}

/** A tile's box before the file loads: the stored shape fitted to 320×360, else a 4:3 box 240 wide (one jump at most). */
export function tileBox(width: number | null | undefined, height: number | null | undefined) {
  if (!width || !height || width <= 0 || height <= 0) return { width: 240, ratio: "4 / 3" };
  const scale = Math.min(1, 320 / width, 360 / height);
  return { width: Math.max(1, Math.round(width * scale)), ratio: `${width} / ${height}` };
}

/** Retry the tile's own picture (the thumb when there is one): re-sign an attachment link, else add a cache-buster. Never the full original. */
export function tileRetryUrl(url: string, attempt: number, stamp = Date.now()): string {
  if (url.startsWith('blob:') || url.startsWith('data:')) return url;
  const signed = attachmentRetryUrl(url, 0, stamp);
  return signed ?? `${url}${url.includes('?') ? '&' : '?'}retry=${attempt}`;
}

/** "0:42", "3:05", "1:02:03"; "" without a length. */
export function formatDuration(ms: number | null | undefined) {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "";
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}
