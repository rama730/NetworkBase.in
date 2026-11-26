/** `/workspaces/x.md`, `/org/x.md`, `/u/x.md` → the markdown route; anything else → null. */
export function markdownRewritePath(pathname: string): string | null {
  const match = /^\/(workspaces|org|u)\/([A-Za-z0-9_-]{1,200})\.md$/.exec(pathname);
  return match ? `/md/${match[1]}/${match[2]}` : null;
}
