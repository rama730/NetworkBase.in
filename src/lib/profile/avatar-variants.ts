export const PUBLIC_AVATAR_VARIANT_SIZES = [64, 128, 400] as const;

export type PublicAvatarVariantSize = (typeof PUBLIC_AVATAR_VARIANT_SIZES)[number];

const PUBLIC_AVATAR_SOURCE_MARKER = "/object/public/avatars/";
const PUBLIC_AVATAR_RENDER_MARKER = "/render/image/public/avatars/";

export function avatarVariantSizeForDisplay(displaySize?: number): PublicAvatarVariantSize {
  if (!displaySize || !Number.isFinite(displaySize) || displaySize <= 0) return 128;
  if (displaySize <= 32) return 64;
  if (displaySize <= 64) return 128;
  return 400;
}

/**
 * Uses Supabase's public image renderer for verified avatar objects. Blob,
 * data, external, private and application routes are returned unchanged.
 */
export function publicAvatarVariantUrl(
  value: string,
  size: PublicAvatarVariantSize,
): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return value;
  }

  const sourceIndex = url.pathname.indexOf(PUBLIC_AVATAR_SOURCE_MARKER);
  const renderIndex = url.pathname.indexOf(PUBLIC_AVATAR_RENDER_MARKER);
  if (sourceIndex >= 0) {
    url.pathname = `${url.pathname.slice(0, sourceIndex)}${PUBLIC_AVATAR_RENDER_MARKER}${url.pathname.slice(sourceIndex + PUBLIC_AVATAR_SOURCE_MARKER.length)}`;
  } else if (renderIndex < 0) {
    return value;
  }

  url.searchParams.set("width", String(size));
  url.searchParams.set("height", String(size));
  url.searchParams.set("resize", "cover");
  url.searchParams.set("quality", "80");
  return url.toString();
}
