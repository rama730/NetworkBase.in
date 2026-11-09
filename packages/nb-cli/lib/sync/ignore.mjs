// What never syncs (report A1.3): built-ins, then .gitignore files (root and nested, with negation), then
// .nbignore (same syntax, wins). Fixes finding 21's whole-folder uploads and the "add it to .gitignore"
// hint the 1.x CLI gave but never honoured.
import fs from "node:fs";
import path from "node:path";

/** Always skipped: VCS, our metadata, dependencies, OS junk, editor swap files. */
const BUILT_IN = [".git/", ".networkbase/", ".tasks/", "node_modules/", ".DS_Store", "Thumbs.db", "desktop.ini", "*.swp", "*.swo", "*~", ".#*", "4913", "*.nbtmp-*"];

/**
 * gitignore glob → RegExp over a path relative to the ignore file's folder.
 * @param {string} pattern
 */
function compile(pattern) {
  let p = pattern;
  const negated = p.startsWith("!");
  if (negated) p = p.slice(1);
  const dirOnly = p.endsWith("/");
  if (dirOnly) p = p.slice(0, -1);
  const anchored = p.includes("/") && !p.startsWith("**/") ? true : false;
  if (p.startsWith("/")) p = p.slice(1);
  let re = "";
  for (let i = 0; i < p.length; i++) {
    const ch = p[i] ?? "";
    if (ch === "*") {
      if (p[i + 1] === "*") {
        const slashAfter = p[i + 2] === "/";
        re += slashAfter ? "(?:.*/)?" : ".*";
        i += slashAfter ? 2 : 1;
      } else re += "[^/]*";
    } else if (ch === "?") re += "[^/]";
    else if (ch === "[") {
      const end = p.indexOf("]", i);
      if (end > i) { re += p.slice(i, end + 1); i = end; } else re += "\\[";
    } else re += ch.replace(/[.+^${}()|\\]/g, "\\$&");
  }
  const regex = new RegExp(`${anchored ? "^" : "(?:^|/)"}${re}(?:/.*)?$`);
  return { regex, negated, dirOnly };
}

/** @param {string} text */
const parse = (text) =>
  text
    .split(/\r?\n/)
    .map((line) => line.replace(/(?<!\\)\s+$/, ""))
    .filter((line) => line && !line.startsWith("#"))
    .map(compile);

/**
 * @param {string} root linked folder
 * @returns {(relPosix: string, isDir: boolean) => boolean} true = skip
 */
export function createIgnore(root) {
  /** @type {Map<string, ReturnType<typeof compile>[]>} folder (posix, "" = root) → rules */
  const byDir = new Map();
  const builtIn = BUILT_IN.map(compile);

  /** @param {string} dirRel */
  const rulesFor = (dirRel) => {
    if (byDir.has(dirRel)) return /** @type {ReturnType<typeof compile>[]} */ (byDir.get(dirRel));
    const abs = path.join(root, ...dirRel.split("/").filter(Boolean));
    const read = (/** @type {string} */ name) => {
      try { return parse(fs.readFileSync(path.join(abs, name), "utf8")); } catch { return []; }
    };
    const rules = [...read(".gitignore"), ...read(".nbignore")];
    byDir.set(dirRel, rules);
    return rules;
  };

  return (rel, isDir) => {
    // A folder rule also covers paths inside it ("node_modules/x.js"), not only the folder itself.
    for (const r of builtIn) if (r.regex.test(rel) && (!r.dirOnly || isDir || rel.includes("/"))) return true;
    let ignored = false;
    const parts = rel.split("/");
    // Rules from each ancestor folder apply to the path relative to that folder; later (deeper) rules win.
    for (let depth = 0; depth < parts.length; depth++) {
      const dir = parts.slice(0, depth).join("/");
      const sub = parts.slice(depth).join("/");
      for (const r of rulesFor(dir)) {
        if (r.dirOnly && !isDir && !sub.includes("/")) continue;
        if (r.regex.test(sub)) ignored = !r.negated;
      }
    }
    return ignored;
  };
}
