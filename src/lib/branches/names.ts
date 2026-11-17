/**
 * Branch names (report H2): letters, numbers, "-", "_", "/" and "." (git's own names follow, H6), up to 100 characters.
 * Not starting or ending with "/", no "//" or "..", not "main" (main is the workspace's own branch), compared without
 * letter case. Returns the reason a name is refused, or null.
 */
export function branchNameProblem(raw: string): string | null {
  const name = String(raw ?? "");
  if (!name.trim()) return "Name the branch";
  if (name.length > 100) return "Branch names are at most 100 characters";
  if (!/^[A-Za-z0-9_./-]+$/.test(name)) return "Use letters, numbers, -, _, / and . in branch names";
  if (name.startsWith("/") || name.endsWith("/") || name.includes("//")) return "A branch name can't start or end with / or have //";
  if (name.includes("..") || name.startsWith(".") || name.endsWith(".") || /\.lock$/i.test(name)) return "A branch name can't have .. or start or end with .";
  if (name.toLowerCase() === "main" || name.toLowerCase() === "head") return `${name} is reserved`;
  return null;
}

/** "Fix the login bug" on task 4 → "task/4-fix-the-login-bug" (report H2: from a task). */
export function branchNameForTask(number: number, title: string, prefix = "task") {
  const slug = title.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");
  return `${prefix}/${number}${slug ? `-${slug}` : ""}`;
}
