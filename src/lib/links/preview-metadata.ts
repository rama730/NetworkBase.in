import { decodeHtmlEntities, normalizeLinkDestinationTitle } from "./destination-title";
import { isSafeHttpUrl } from "@/lib/security/urls";

/** Bounded head metadata only; quoted attribute values may contain the opposite quote. */
export function readPreviewMetadata(source: string, resolvedUrl: URL) {
  const html = source.slice(0, 64 * 1024).replace(/<!--[\s\S]*?(?:-->|$)/g, "").replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  const values = new Map<string, string>();
  for (const tag of html.matchAll(/<meta\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi)) {
    const attrs = new Map<string, string>();
    for (const match of tag[0].matchAll(/([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
      attrs.set(match[1]!.toLowerCase(), (match[2] ?? match[3] ?? match[4] ?? "").trim());
    }
    const key = (attrs.get("property") || attrs.get("name"))?.toLowerCase();
    const content = attrs.get("content");
    if (key && content && content.length <= 8192 && !values.has(key)) values.set(key, content);
  }
  const ogTitle = normalizeLinkDestinationTitle(values.get("og:title"));
  const twitterTitle = normalizeLinkDestinationTitle(values.get("twitter:title"));
  const htmlTitle = html.match(/<title\b[^>]{0,256}>([\s\S]*?)<\/title\s*>/i)?.[1];
  const title = ogTitle || twitterTitle || normalizeLinkDestinationTitle(htmlTitle);
  const description = values.get("og:description") || values.get("twitter:description") || values.get("description");
  let image: string | null = null;
  const rawImage = values.get("og:image") || values.get("twitter:image");
  if (rawImage) {
    try {
      const url = new URL(decodeHtmlEntities(rawImage), resolvedUrl).href;
      if (isSafeHttpUrl(url, { maxLength: 2000 })) image = url;
    } catch { /* A malformed image does not invalidate the readable card. */ }
  }
  return { title, description: description ? decodeHtmlEntities(description).replace(/\s+/g, " ").trim().slice(0, 500) || null : null, image,
    titleSource: title ? (ogTitle ? "open_graph" : twitterTitle ? "provider" : "html_title") : "url" } as const;
}
