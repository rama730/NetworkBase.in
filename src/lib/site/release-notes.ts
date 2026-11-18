// Release notes for the home page ticker, taken from the CLI changelog at build time so they never go stale.

export type ReleaseNote = { version: string; text: string };

/** First bullet of each release, as one short line: inline code unwrapped, asides in brackets dropped, cut at the first clause. */
export function parseReleaseNotes(markdown: string, limit = 6, maxLength = 96): ReleaseNote[] {
  const notes: ReleaseNote[] = [];
  const releases = markdown.split(/^## /m).slice(1);
  for (const release of releases) {
    const version = release.match(/^(\d+\.\d+(?:\.\d+)?)/)?.[1];
    const bullet = release.match(/^- (.+)$/m)?.[1];
    if (!version || !bullet) continue;
    let text = bullet.replace(/`([^`]+)`/g, '$1').replace(/\s*\([^)]*\)/g, '').split(/;\s|\.\s|\.$/)[0]!.trim();
    if (text.length > maxLength) text = text.slice(0, maxLength - 1).replace(/\s+\S*$/, '') + '…';
    notes.push({ version, text });
    if (notes.length === limit) break;
  }
  return notes;
}
