/** Viewer zoom: 100–400 %. */
export function clampZoom(zoom: number) {
  return Math.min(4, Math.max(1, Math.round(zoom * 100) / 100));
}

/** The viewer dialog's name: "Media viewer: photo.jpg, 2 of 5". */
export function viewerLabel(name: string, index: number, count: number) {
  return `Media viewer: ${name || "file"}${count > 1 ? `, ${index + 1} of ${count}` : ""}`;
}

/** The mono line under the file name: "2 / 5 · JPG · 2.4 MB · 3024 × 4032". */
export function viewerMeta(parts: { index: number; count: number; name: string; size?: number | null; width?: number | null; height?: number | null; formatSize: (n: number) => string }) {
  const ext = (parts.name.match(/\.([a-z0-9]{1,5})$/i)?.[1] ?? "").toUpperCase();
  return [
    parts.count > 1 ? `${parts.index + 1} / ${parts.count}` : null,
    ext || null,
    parts.size ? parts.formatSize(parts.size) : null,
    parts.width && parts.height ? `${parts.width} × ${parts.height}` : null,
  ].filter(Boolean).join(" · ");
}
