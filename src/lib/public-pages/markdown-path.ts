import { isShareCrawler } from '@/lib/sharing/presentation';

/** `/workspaces/x.md`, `/org/x.md`, `/u/x.md` → the markdown route; anything else → null. */
export function markdownRewritePath(pathname: string): string | null {
  const match = /^\/(workspaces|org|u)\/([A-Za-z0-9_-]{1,200})\.md$/.exec(pathname);
  return match ? `/md/${match[1]}/${match[2]}` : null;
}

/** A .md copy, or a reader (crawler, AI fetcher, curl) on a public page: served as a signed-out person, never with a session. */
export function isAnonymousReaderRequest(pathname: string, userAgent: string | null): boolean {
  return markdownRewritePath(pathname) !== null || (/^\/(workspaces|org|u)\//.test(pathname) && isShareCrawler(userAgent));
}
