import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { normalizeSafeExternalUrl, sameOriginPath } from "@/lib/messaging/safe-links";
import { parseShareResource } from '@/lib/sharing/presentation';

type Node = { type: string; url?: string; identifier?: string; children?: Node[] };

/** Use the renderer's parser, including GFM and reference links; code and images are separate nodes. */
export function markdownDestinations(body: string, kind: "link" | "image" = "link"): string[] {
  const destinations: string[] = [];
  function collect() {
    return (tree: Node) => {
      const definitions = new Map<string, string>();
      const visit = (node: Node, fn: (node: Node) => void) => {
        fn(node);
        node.children?.forEach((child) => visit(child, fn));
      };
      visit(tree, (node) => {
        if (node.type === "definition" && node.identifier && node.url) definitions.set(node.identifier.toLowerCase(), node.url);
      });
      visit(tree, (node) => {
        if (node.type === kind && node.url) destinations.push(node.url);
        if (node.type === `${kind}Reference` && node.identifier) {
          const url = definitions.get(node.identifier.toLowerCase());
          if (url) destinations.push(url);
        }
      });
    };
  }
  Markdown({ children: body, remarkPlugins: [remarkGfm, collect], skipHtml: true });
  return destinations;
}

export function firstExternalMarkdownLink(body: string, origin?: string): string | null {
  for (const destination of markdownDestinations(body)) {
    if (origin) {
      const path = sameOriginPath(destination, origin);
      if (path && /^\/messages(?:\/|\?|$)/.test(path)) continue;
    }
    // Relative paths are never external URLs.
    if (!/^https?:\/\//i.test(destination)) continue;
    if (parseShareResource(destination, origin)) return new URL(destination).href;
    const safe = normalizeSafeExternalUrl(destination);
    if (safe) return safe;
  }
  return null;
}
