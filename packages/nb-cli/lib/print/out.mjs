// The only place the CLI writes to the terminal (report A4.5, A4.7, A4.8, A13.1). stdout carries results
// (text or one JSON envelope); stderr carries progress, hints, warnings and prompts.
import { FIXES } from "../error-fixes.mjs";
import { spawnSync } from "node:child_process";

import { colorLevel, palette, pad, safe, symbols, truncateEnd, truncateMiddle, asciiOnly, width, hyperlinks } from "./style.mjs";

/**
 * @typedef {{ json: boolean, quiet: boolean, plain: boolean, verbose: boolean, fields: string[] | null, pager: boolean }} OutputMode
 * @typedef {ReturnType<typeof createOutput>} Output
 */

/**
 * @param {Partial<OutputMode>} mode
 * @param {{ stdout?: NodeJS.WriteStream, stderr?: NodeJS.WriteStream, env?: NodeJS.ProcessEnv, onResult?: (r: { schema: string, data: any, text: string, warnings: string[] }) => void }} [io]
 *   onResult: the MCP server takes each result as data plus its plain-text summary instead of printing it.
 */
export function createOutput(mode, io = {}) {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const env = io.env ?? process.env;
  const plain = Boolean(mode.plain) || env.NB_PLAIN === "1" || env.TERM === "dumb";
  const level = plain ? 0 : colorLevel(stderr, env);
  const c = palette(level);
  const sym = symbols(plain || asciiOnly(env));
  const json = Boolean(mode.json);
  const quiet = Boolean(mode.quiet);
  const columns = () => Math.max(40, stderr.columns || stdout.columns || 80);
  /** @type {string[]} */
  const warnings = [];
  const links = !plain && level > 0 && hyperlinks(stdout, env);

  /** @param {string} text */
  const err = (text) => {
    if (!quiet) stderr.write(text.endsWith("\n") ? text : `${text}\n`);
  };

  return {
    c,
    sym,
    json,
    plain,
    columns,
    interactive: Boolean(process.stdin.isTTY && stderr.isTTY && !json && !env.CI),
    stderr,
    /** Progress or context on stderr. @param {string} text */
    note: (text) => err(text),
    /** @param {string} text */
    done: (text) => err(`${c.success(sym.done)} ${text}`),
    /** Warnings go to stderr, and into the JSON envelope's meta. @param {string} text */
    warn(text) {
      warnings.push(stripForJson(text));
      if (!json) err(`${c.warning(sym.warn)} ${text}`);
    },
    /** Raw text to stdout (file contents, piped output). @param {string | Uint8Array} chunk */
    raw: (chunk) => stdout.write(chunk),
    /**
     * Clickable text in terminals that support OSC 8 links (A5.9); only for the NetworkBase server's own pages, and
     * the text alone everywhere else.
     * @param {string} text @param {string} url @param {string} origin
     */
    link: (text, url, origin) => (links && url.startsWith(`${origin}/`) && !/[\x00-\x1f\x7f]/.test(url) ? `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\` : text),
    /**
     * Print a command's result: one JSON envelope in --json, else the human lines on stdout.
     * @template T
     * @param {string} schema e.g. "nb.task.list/1"
     * @param {T} data
     * @param {(data: T) => string | string[] | null} human
     * @param {{ page?: boolean }} [options] page: long views (help, task view, file view) go through $PAGER in a terminal
     */
    result(schema, data, human, options = {}) {
      if (io.onResult) {
        const lines = human(data);
        io.onResult({ schema, data, text: lines == null ? "" : Array.isArray(lines) ? lines.join("\n") : lines, warnings });
        return;
      }
      if (json) {
        const envelope = { ok: true, schema, data: mode.fields?.length ? pickFields(data, mode.fields) : data, ...(warnings.length ? { meta: { warnings } } : {}) };
        stdout.write(`${JSON.stringify(envelope)}\n`);
        return;
      }
      const lines = human(data);
      if (lines === null || lines === undefined) return;
      const text = Array.isArray(lines) ? lines.join("\n") : lines;
      if (text === "") return;
      const out = text.endsWith("\n") ? text : `${text}\n`;
      if (options.page && mode.pager !== false && stdout.isTTY && process.stdin.isTTY && out.split("\n").length > (stdout.rows || 24)) {
        // less -F quits when it fits, -R keeps colors, -X leaves the text on screen (A4.10).
        const [cmd, ...args] = (env.NB_PAGER ?? env.PAGER ?? "less -FRX").split(" ").filter(Boolean);
        if (cmd && cmd !== "cat" && spawnSync(cmd, args, { input: out, stdio: ["pipe", "inherit", "inherit"] }).status === 0) return;
      }
      stdout.write(out);
    },
    /** @param {import("../errors.mjs").CliError} error */
    error(error) {
      // Every catalogued code links to its entry on /docs/cli (report A2.6, C5), and ends with a next step.
      const docs = FIXES[error.code] && error.code !== "CANCELLED" ? `https://networkbase.in/docs/cli#error-${error.code}` : null;
      if (!error.hint && FIXES[error.code] && error.code !== "CANCELLED") error.hint = FIXES[error.code];
      if (json) {
        const body = { ok: false, error: { code: error.code, message: error.message, ...(error.hint ? { hint: error.hint } : {}), ...(error.details !== undefined ? { details: error.details } : {}), ...(docs ? { docs } : {}) } };
        stdout.write(`${JSON.stringify(body)}\n`);
        return;
      }
      stderr.write(`${c.danger(sym.error)} ${safe(error.message)}\n`);
      if (error.hint) stderr.write(`  ${c.muted(safe(error.hint))}\n`);
      if (docs && env.NB_DOCS_LINKS !== "0") stderr.write(`  ${c.muted(docs)}\n`);
      // GitHub Actions shows this line as an error on the run's summary (A5.10).
      if (env.GITHUB_ACTIONS === "true") stderr.write(`::error title=nb::${safe(error.message).replace(/%/g, "%25").replace(/\r?\n/g, "%0A")}\n`);
    },
    /**
     * A table with a header, sized to content; one flexible column is cut to fit, and on a narrow terminal the
     * optional columns go first, from the right (A5.5).
     * @param {Array<{ title: string, value: (row: any) => string, flex?: boolean, path?: boolean, align?: "right", optional?: boolean }>} allCols
     * @param {any[]} rows
     */
    table(allCols, rows) {
      const natural = (/** @type {typeof allCols[number]} */ col) => Math.max(width(col.title), ...rows.map((r) => width(col.value(r))));
      const fixedWidth = (/** @type {typeof allCols} */ cs) => cs.reduce((a, col) => a + (col.flex ? 10 : natural(col)), 0) + 2 * cs.length;
      let cols = allCols;
      while (fixedWidth(cols) > columns() && cols.some((col) => col.optional)) {
        const drop = cols.map((col) => Boolean(col.optional)).lastIndexOf(true);
        cols = cols.filter((_, i) => i !== drop);
      }
      const cells = rows.map((row) => cols.map((col) => col.value(row)));
      const widths = cols.map((col, i) => Math.max(width(col.title), ...cells.map((r) => width(r[i] ?? ""))));
      const total = widths.reduce((a, b) => a + b, 0) + 2 * (cols.length - 1) + 2;
      const flex = cols.findIndex((col) => col.flex);
      if (flex >= 0 && total > columns()) widths[flex] = Math.max(10, (widths[flex] ?? 10) - (total - columns()));
      const fit = (/** @type {string} */ s, /** @type {number} */ i) => {
        const w = widths[i] ?? 0;
        const cut = cols[i]?.path ? truncateMiddle(s, w, sym.ellipsis) : truncateEnd(s, w, sym.ellipsis);
        return cols[i]?.align === "right" ? " ".repeat(Math.max(0, w - width(cut))) + cut : pad(cut, w);
      };
      const head = `  ${cols.map((col, i) => c.muted(fit(col.title, i))).join("  ")}`.trimEnd();
      return [head, ...cells.map((r) => `  ${r.map((cell, i) => fit(cell, i)).join("  ")}`.trimEnd())];
    },
  };
}

/**
 * `--fields id,title`: keeps those keys on each object in the result's lists (or on the result itself).
 * @param {any} data @param {string[]} fields
 */
export function pickFields(data, fields) {
  const pick = (/** @type {any} */ o) => (o && typeof o === "object" && !Array.isArray(o) ? Object.fromEntries(fields.filter((f) => f in o).map((f) => [f, o[f]])) : o);
  if (Array.isArray(data)) return data.map(pick);
  if (!data || typeof data !== "object") return data;
  const lists = Object.entries(data).filter(([, v]) => Array.isArray(v) && v.some((x) => x && typeof x === "object"));
  return lists.length ? { ...data, ...Object.fromEntries(lists.map(([k, v]) => [k, /** @type {any[]} */ (v).map(pick)])) } : pick(data);
}

/** @param {string} s */
const stripForJson = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
