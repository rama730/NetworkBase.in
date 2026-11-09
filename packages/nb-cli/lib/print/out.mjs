// The only place the CLI writes to the terminal (report A4.5, A4.7, A4.8, A13.1). stdout carries results
// (text or one JSON envelope); stderr carries progress, hints, warnings and prompts.
import { colorLevel, palette, pad, safe, symbols, truncateEnd, truncateMiddle, asciiOnly, width } from "./style.mjs";

/**
 * @typedef {{ json: boolean, quiet: boolean, plain: boolean, verbose: boolean }} OutputMode
 * @typedef {ReturnType<typeof createOutput>} Output
 */

/**
 * @param {Partial<OutputMode>} mode
 * @param {{ stdout?: NodeJS.WriteStream, stderr?: NodeJS.WriteStream, env?: NodeJS.ProcessEnv }} [io]
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
     * Print a command's result: one JSON envelope in --json, else the human lines on stdout.
     * @template T
     * @param {string} schema e.g. "nb.task.list/1"
     * @param {T} data
     * @param {(data: T) => string | string[] | null} human
     */
    result(schema, data, human) {
      if (json) {
        const envelope = { ok: true, schema, data, ...(warnings.length ? { meta: { warnings } } : {}) };
        stdout.write(`${JSON.stringify(envelope)}\n`);
        return;
      }
      const lines = human(data);
      if (lines === null || lines === undefined) return;
      const text = Array.isArray(lines) ? lines.join("\n") : lines;
      if (text !== "") stdout.write(text.endsWith("\n") ? text : `${text}\n`);
    },
    /** @param {import("../errors.mjs").CliError} error */
    error(error) {
      if (json) {
        const body = { ok: false, error: { code: error.code, message: error.message, ...(error.hint ? { hint: error.hint } : {}), ...(error.details !== undefined ? { details: error.details } : {}) } };
        stdout.write(`${JSON.stringify(body)}\n`);
        return;
      }
      stderr.write(`${c.danger(sym.error)} ${safe(error.message)}\n`);
      if (error.hint) stderr.write(`  ${c.muted(safe(error.hint))}\n`);
    },
    /**
     * A table with a header, sized to content; one flexible column is cut to fit (A5.5).
     * @param {Array<{ title: string, value: (row: any) => string, flex?: boolean, path?: boolean, align?: "right" }>} cols
     * @param {any[]} rows
     */
    table(cols, rows) {
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

/** @param {string} s */
 
const stripForJson = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
