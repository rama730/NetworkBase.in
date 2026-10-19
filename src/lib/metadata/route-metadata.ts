import type { Metadata } from "next";

export const DEFAULT_ROUTE_OG_IMAGE = "/og/routes-card.png";

type RouteMetadataOptions = {
  title: string;
  robots?: Metadata["robots"];
  description: string;
  path: string;
  image?: string | null;
  imageAlt?: string;
  imageWidth?: number;
  imageHeight?: number;
  imageType?: string;
  twitterCard?: "summary" | "summary_large_image";
  openGraphType?: "website" | "profile";
};

function normalizeRoutePath(path: string): string {
  if (!path) return "/";
  if (/^https?:\/\//.test(path)) return path;
  return path.startsWith("/") ? path : `/${path}`;
}

function resolveRouteImage({
  image,
  alt,
  width,
  height,
  type,
}: {
  image?: string | null;
  alt?: string;
  width?: number;
  height?: number;
  type?: string;
}) {
  const url = image?.trim() || DEFAULT_ROUTE_OG_IMAGE;
  if (!width || !height) return [{ url, alt, ...(type ? { type } : {}) }];
  return [{ url, width, height, alt, ...(type ? { type } : {}) }];
}

export function buildRouteMetadata({
  title,
  robots,
  description,
  path,
  image,
  imageAlt,
  imageWidth,
  imageHeight,
  imageType,
  twitterCard = "summary_large_image",
  openGraphType = "website",
}: RouteMetadataOptions): Metadata {
  const canonicalPath = normalizeRoutePath(path);
  const images = resolveRouteImage({
    image,
    alt: imageAlt ?? title,
    width: imageWidth,
    height: imageHeight,
    type: imageType,
  });

  return {
    title,
    ...(robots ? { robots } : {}),
    description,
    alternates: {
      canonical: canonicalPath,
    },
    openGraph: {
      siteName: "NetworkBase™",
      title,
      description,
      type: openGraphType,
      url: canonicalPath,
      images,
    },
    twitter: {
      card: twitterCard,
      title,
      description,
      images,
    },
  };
}
