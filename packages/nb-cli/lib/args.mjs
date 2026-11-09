// Command lookup, strict flag parsing and help (report A4.2, A4.6). Uses Node's util.parseArgs; unknown
// flags and commands are errors with a "did you mean", never silently ignored (finding 81).
import { parseArgs } from "node:util";

import { ALIASES, COMMANDS, GLOBAL_FLAGS, REMOVED } from "./commands/table.mjs";
import { CliError, usage } from "./errors.mjs";

/** @typedef {import("./commands/table.mjs").CommandSpec} CommandSpec */

/** @param {string} a @param {string} b */
function distance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

/** Closest candidate within 2 edits, or null. @param {string} word @param {string[]} candidates */
export function didYouMean(word, candidates) {
  let best = null;
  let bestScore = 3;
  for (const c of candidates) {
    const score = distance(word, c);
    if (score < bestScore) { best = c; bestScore = score; }
  }
  return best;
}

const TASK_REF = /^(#?\d+|T-\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/**
 * Finds the command in argv. `nb task 4` is a shortcut for `nb task view 4`.
 * @param {string[]} argv
 * @returns {{ spec: CommandSpec | null, rest: string[], alias: { from: string, to: string } | null }}
 */
export function resolveCommand(argv) {
  const words = [];
  for (const token of argv) {
    if (token.startsWith("-")) break;
    words.push(token);
  }
  if (words.length === 0) return { spec: null, rest: argv, alias: null };
  for (let n = Math.min(3, words.length); n >= 1; n--) {
    const name = words.slice(0, n).join(" ");
    if (name in REMOVED) throw new CliError("USAGE", /** @type {Record<string, string>} */ (REMOVED)[name]);
    const target = /** @type {Record<string, string>} */ (ALIASES)[name] ?? name;
    const spec = COMMANDS.find((c) => c.name === target);
    if (spec) return { spec, rest: argv.slice(n), alias: target !== name ? { from: name, to: target } : null };
  }
  if (words[0] === "task" && words[1] && TASK_REF.test(words[1])) {
    return { spec: /** @type {CommandSpec} */ (COMMANDS.find((c) => c.name === "task view")), rest: argv.slice(1), alias: null };
  }
  const tried = words.slice(0, 2).join(" ");
  const names = COMMANDS.map((c) => c.name);
  const guess = didYouMean(tried, names) ?? didYouMean(words[0] ?? "", names);
  throw new CliError("UNKNOWN_COMMAND", `nb ${tried} isn't a command`, { hint: guess ? `Did you mean: nb ${guess}?` : "See nb help" });
}

/**
 * @param {CommandSpec} spec
 * @param {string[]} rest
 * @returns {{ positionals: string[], flags: Record<string, any> }}
 */
export function parseFlags(spec, rest) {
  const all = { ...GLOBAL_FLAGS, ...(spec.flags ?? {}) };
  /** @type {import("node:util").ParseArgsConfig["options"]} */
  const options = {};
  for (const [name, f] of Object.entries(all)) {
    options[name] = { type: f.type, ...(f.short ? { short: f.short } : {}), ...(f.multiple ? { multiple: true } : {}) };
  }
  try {
    const { values, positionals } = parseArgs({ args: rest, options, allowPositionals: true, strict: true });
    return { positionals, flags: values };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const unknown = /Unknown option '(-{1,2})([^']+)'/.exec(message);
    if (unknown) {
      const guess = didYouMean(unknown[2] ?? "", Object.keys(all));
      throw new CliError("UNKNOWN_FLAG", `nb ${spec.name} has no ${unknown[1]}${unknown[2]} flag`, {
        hint: guess ? `Did you mean --${guess}? See nb ${spec.name} --help` : `See nb ${spec.name} --help`,
      });
    }
    throw usage(message.replace(/\. To specify a positional argument.*$/, ""), `See nb ${spec.name} --help`);
  }
}

/** Help for one command (A4.6). @param {CommandSpec} spec */
export function commandHelp(spec) {
  const flags = Object.entries({ ...(spec.flags ?? {}), ...GLOBAL_FLAGS }).filter(([name, f]) => name !== "help" && !f.hidden);
  const label = (/** @type {string} */ name, /** @type {any} */ f) => `${f.short ? `-${f.short}, ` : "    "}--${name}${f.type === "string" ? ` <${f.valueName ?? "value"}>` : ""}`;
  const w = Math.max(...flags.map(([n, f]) => label(n, f).length));
  const lines = [`nb ${spec.name} — ${spec.summary}`, "", "Usage", `  ${spec.usage}`, "", "Flags"];
  for (const [name, f] of flags) lines.push(`  ${label(name, f).padEnd(w)}  ${f.describe}`);
  if (spec.examples?.length) lines.push("", "Examples", ...spec.examples.map((e) => `  ${e}`));
  if (spec.exit?.length) lines.push("", `Exit codes  ${spec.exit.map((code) => `${code} ${EXIT_WORDS[code] ?? ""}`.trim()).join(" · ")}`);
  return lines.join("\n");
}

const EXIT_WORDS = /** @type {Record<number, string>} */ ({ 0: "ok", 1: "error", 2: "usage", 3: "not signed in", 4: "conflict", 5: "blocked", 6: "needs input", 7: "needs confirmation", 8: "offline (queued)" });

/** Overview help: every command by group. */
export function overviewHelp() {
  const groups = new Map();
  for (const c of COMMANDS) {
    if (c.hidden) continue;
    if (!groups.has(c.group)) groups.set(c.group, []);
    groups.get(c.group).push(c);
  }
  const w = Math.max(...COMMANDS.map((c) => c.name.length));
  const lines = ["NetworkBase CLI", "", "Usage", "  nb <command> [flags]", ""];
  for (const [group, cmds] of groups) {
    lines.push(group);
    for (const c of cmds) lines.push(`  ${c.name.padEnd(w)}  ${c.summary}`);
    lines.push("");
  }
  lines.push("Every command takes --json, --quiet, --plain and --help.", "Docs: https://networkbase.in/docs/cli");
  return lines.join("\n");
}

/** The command table as data, for agents and completions (`nb help --json`). */
export function helpData() {
  return {
    commands: COMMANDS.filter((c) => !c.hidden).map((c) => ({ name: c.name, summary: c.summary, usage: c.usage, flags: Object.fromEntries(Object.entries(c.flags ?? {}).filter(([, f]) => !f.hidden)), examples: c.examples ?? [], exitCodes: c.exit ?? [0, 1] })),
    globalFlags: GLOBAL_FLAGS,
    aliases: ALIASES,
  };
}
