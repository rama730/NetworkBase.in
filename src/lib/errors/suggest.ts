/** "Did you mean" on a 404: an address one or two letters off a real section, or off one of the viewer's own places. */

/** The app's top-level sections (the first part of every address). */
export const SECTIONS = [
  "discover", "network", "messages", "workspaces", "org", "u", "my-work", "my-profile", "settings", "onboarding",
  "login", "signup", "join", "device", "authorize", "forgot-password", "reset-password", "verify-email",
  "docs", "help", "support", "terms", "privacy", "cookies", "eula", "security-reporting", "acceptable-use",
] as const;

export type Place = { slug: string; title: string; kind: "workspace" | "organization" };
export type Suggestion =
  | { kind: "section"; from: string; to: string; path: string }
  | { kind: "place"; from: string; to: string; path: string; title: string };

/** Edits to turn one word into another; swapping two neighbouring letters counts once (Damerau–Levenshtein). */
export function editDistance(a: string, b: string) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const row = d[i]!, up = d[i - 1]!;
      row[j] = Math.min(up[j]! + 1, row[j - 1]! + 1, up[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) row[j] = Math.min(row[j]!, d[i - 2]![j - 2]! + 1);
    }
  }
  return d[a.length]![b.length]!;
}

/** The closest word within one edit (two for words longer than six letters), or null. */
function closest(word: string, words: readonly string[]) {
  let best: string | null = null, bestDistance = Infinity;
  for (const candidate of words) {
    const distance = editDistance(word, candidate);
    if (distance > 0 && distance <= (candidate.length > 6 ? 2 : 1) && distance < bestDistance) { best = candidate; bestDistance = distance; }
  }
  return best;
}

export function suggestAddress(pathname: string, places: readonly Place[]): Suggestion | null {
  const parts = pathname.replace(/^\/+/, "").split("/");
  const section = (parts[0] ?? "").toLowerCase();
  if (!(SECTIONS as readonly string[]).includes(section)) {
    if (section.length < 3) return null;
    const to = closest(section, SECTIONS);
    return to ? { kind: "section", from: parts[0]!, to, path: `/${[to, ...parts.slice(1)].join("/")}` } : null;
  }
  const name = (parts[1] ?? "").toLowerCase();
  const kind = section === "workspaces" ? "workspace" : section === "org" ? "organization" : null;
  if (!kind || name.length < 3) return null;
  const mine = places.filter((place) => place.kind === kind);
  const to = closest(name, mine.map((place) => place.slug));
  const place = mine.find((p) => p.slug === to);
  return place ? { kind: "place", from: parts[1]!, to: place.slug, path: `/${section}/${place.slug}`, title: place.title } : null;
}
