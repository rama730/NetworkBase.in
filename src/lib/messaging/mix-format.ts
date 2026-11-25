// Small formatters the Messages mix uses everywhere (counts, caps, long names, people lists).

/** Sidebar and tab counts: nothing at zero, two mono digits, "99+" above 99. */
export function padCount(n: number, cap = 99): string {
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n > cap) return `${cap}+`;
  return String(Math.floor(n)).padStart(2, "0");
}

/** A plain count with a ceiling: 1284 members → "999+", 128 pins → "99+". */
export function capCount(n: number, cap: number): string {
  return n > cap ? `${cap}+` : String(Math.max(0, Math.floor(n)));
}

/** Cut the middle of a long file name so the version and extension stay readable. */
export function middleCut(name: string, max = 48, keepEnd = 16): string {
  if (name.length <= max) return name;
  const end = name.slice(-keepEnd);
  return `${name.slice(0, Math.max(1, max - keepEnd - 1))}…${end}`;
}

/** "Ana", "Ana and Ben", "Ana, Ben and 497 others". */
export function joinPeople(names: string[], shown = 2): string {
  if (names.length === 0) return "";
  if (names.length <= shown) return names.length === 1 ? names[0] ?? "" : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  const rest = names.length - shown;
  return `${names.slice(0, shown).join(", ")} and ${rest} other${rest === 1 ? "" : "s"}`;
}
