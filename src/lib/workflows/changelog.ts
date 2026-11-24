/**
 * Report 38.17 W5 and call 4 (A7.5): a release Update's text has a fixed shape: a first line `## v2.4`, then
 * `### Added`, `### Improved`, `### Fixed` with list items. The Changelog reads it; anything else shows as one block.
 */
export type Release = { kind: "release"; version: string; added: string[]; improved: string[]; fixed: string[] } | { kind: "plain"; text: string };
const GROUPS = { added: /^added$/i, improved: /^(improved|changed)$/i, fixed: /^fixed$/i } as const;

export function parseRelease(content: string): Release {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const first = lines.findIndex((l) => l.trim());
  const version = /^##\s+(v?\d[\w.\-+]*)\s*$/i.exec(lines[first]?.trim() ?? "")?.[1];
  if (!version) return { kind: "plain", text: content.trim() };
  const out = { added: [] as string[], improved: [] as string[], fixed: [] as string[] };
  let group: keyof typeof out | null = null;
  for (const raw of lines.slice(first + 1)) {
    const line = raw.trim();
    const heading = /^###\s+(.+)$/.exec(line)?.[1]?.trim();
    if (heading) { group = (Object.keys(GROUPS) as Array<keyof typeof GROUPS>).find((g) => GROUPS[g].test(heading)) ?? null; continue; }
    const item = /^[-*]\s+(.+)$/.exec(line)?.[1]?.trim();
    if (group && item) out[group].push(item);
  }
  return { kind: "release", version: version.startsWith("v") ? version : `v${version}`, ...out };
}

/** The release Update's text from a version and its three groups (D2's Post an Update, W4). */
export function releaseMarkdown(version: string, groups: { added?: string[]; improved?: string[]; fixed?: string[] }) {
  const v = version.trim().startsWith("v") ? version.trim() : `v${version.trim()}`;
  const block = (title: string, items: string[] = []) => (items.length ? [`### ${title}`, ...items.map((i) => `- ${i}`), ""] : []);
  return [`## ${v}`, "", ...block("Added", groups.added), ...block("Improved", groups.improved), ...block("Fixed", groups.fixed)].join("\n").trim() + "\n";
}
