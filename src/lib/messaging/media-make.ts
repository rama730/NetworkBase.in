// Media extras made on the device at upload (the mix, §7.2): a 12×12 pixel preview, a 640px WebP thumb or a
// video poster, a length, and 48 waveform bars for audio. Every step is optional: a failure returns nothing
// and the file still sends.

/** Average colours of an RGBA image into n×n cells, as RGB hex row by row (n=12 → 864 chars). */
export function averageGrid(pixels: Uint8ClampedArray, width: number, height: number, n = 12): string {
  let out = "";
  for (let cy = 0; cy < n; cy++) {
    for (let cx = 0; cx < n; cx++) {
      const x0 = Math.floor((cx * width) / n), x1 = Math.max(x0 + 1, Math.floor(((cx + 1) * width) / n));
      const y0 = Math.floor((cy * height) / n), y1 = Math.max(y0 + 1, Math.floor(((cy + 1) * height) / n));
      let r = 0, g = 0, b = 0, count = 0;
      for (let y = y0; y < y1 && y < height; y++) {
        for (let x = x0; x < x1 && x < width; x++) {
          const i = (y * width + x) * 4;
          r += pixels[i]!; g += pixels[i + 1]!; b += pixels[i + 2]!; count++;
        }
      }
      const hex = (v: number) => Math.round(count ? v / count : 0).toString(16).padStart(2, "0");
      out += hex(r) + hex(g) + hex(b);
    }
  }
  return out;
}

/** 48 (or `bars`) peak heights 0–100, scaled to the loudest bar; [] for no samples. */
export function peaksFrom(samples: Float32Array, bars = 48): number[] {
  if (!samples.length) return [];
  const size = Math.ceil(samples.length / bars);
  const raw = Array.from({ length: bars }, (_, bar) => {
    let peak = 0;
    for (let i = bar * size; i < Math.min(samples.length, (bar + 1) * size); i++) peak = Math.max(peak, Math.abs(samples[i]!));
    return peak;
  });
  const top = Math.max(...raw);
  return raw.map((p) => (top ? Math.round((p / top) * 100) : 0));
}

type Extras = { thumb?: Blob; preview?: string; durationMs?: number; peaks?: number[] };

function canvas(width: number, height: number) {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return c;
}

function previewOf(source: CanvasImageSource, width: number, height: number) {
  const c = canvas(48, 48);
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return undefined;
  ctx.drawImage(source, 0, 0, 48, 48);
  return averageGrid(ctx.getImageData(0, 0, 48, 48).data, 48, 48, 12);
}

function blobOf(source: CanvasImageSource, width: number, height: number, max = 640): Promise<Blob | undefined> {
  const scale = Math.min(1, max / Math.max(width, height));
  const c = canvas(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
  c.getContext("2d")?.drawImage(source, 0, 0, c.width, c.height);
  return new Promise((resolve) => c.toBlob((blob) => resolve(blob ?? undefined), "image/webp", 0.8));
}

async function imageExtras(file: File): Promise<Extras> {
  const bitmap = await createImageBitmap(file);
  try {
    const preview = previewOf(bitmap, bitmap.width, bitmap.height);
    // A small image is its own thumbnail.
    const thumb = Math.max(bitmap.width, bitmap.height) > 640 || file.size > 200_000 ? await blobOf(bitmap, bitmap.width, bitmap.height) : undefined;
    return { preview, thumb };
  } finally {
    bitmap.close();
  }
}

function videoExtras(file: File): Promise<Extras> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    let done = false;
    const finish = (extras: Extras) => {
      if (done) return;
      done = true;
      URL.revokeObjectURL(url);
      video.removeAttribute("src");
      video.load();
      resolve(extras);
    };
    const timer = window.setTimeout(() => finish({}), 10_000);
    video.muted = true;
    video.preload = "auto";
    video.playsInline = true;
    video.onloadedmetadata = () => {
      const durationMs = Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : undefined;
      video.onseeked = async () => {
        window.clearTimeout(timer);
        const thumb = await blobOf(video, video.videoWidth, video.videoHeight);
        finish({ durationMs, thumb, preview: previewOf(video, video.videoWidth, video.videoHeight) });
      };
      video.currentTime = Math.min(1, (video.duration || 0) / 10);
    };
    video.onerror = () => { window.clearTimeout(timer); finish({}); };
    video.src = url;
  });
}

async function audioExtras(file: File): Promise<Extras> {
  const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Context || file.size > 50_000_000) return {};
  const context = new Context();
  try {
    const buffer = await context.decodeAudioData(await file.arrayBuffer());
    return { durationMs: Math.round(buffer.duration * 1000), peaks: peaksFrom(buffer.getChannelData(0), 48) };
  } finally {
    void context.close();
  }
}

/** The extras for one file, or {} when the browser can't make them. Never throws. */
export async function makeMediaExtras(file: File): Promise<Extras> {
  try {
    if (typeof document === "undefined") return {};
    const kind = file.type.split("/")[0];
    if (kind === "image" && file.type !== "image/gif" && typeof createImageBitmap === "function") return await imageExtras(file);
    if (kind === "video") return await videoExtras(file);
    if (kind === "audio" || /\.(ogg|oga|opus|mp3|m4a|wav)$/i.test(file.name)) return await audioExtras(file);
  } catch {
    // Optional: the file sends without them.
  }
  return {};
}
