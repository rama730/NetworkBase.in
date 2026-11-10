// Questions when something is unclear (report §20.1, §20.3, A4.4, A4.11). Interactive: numbered options on
// stderr, recommended first, ↑/↓ or 1–4, Enter, Esc cancels. Not interactive: --answer key=value, --yes takes
// the recommended option, otherwise exit 6 with the question as JSON so an agent can ask the person.
import readline from "node:readline";

import { CliError } from "../errors.mjs";
import { safe } from "../print/style.mjs";

/**
 * @typedef {{ value: string, label: string, description?: string, recommended?: boolean }} Option
 * @typedef {{ key: string, header: string, question: string, options: Option[], preview?: string }} Question
 */

/** @param {import("../context.mjs").Context} ctx @param {string} key */
function answered(ctx, key) {
  for (const entry of /** @type {string[]} */ (ctx.flags.answer ?? [])) {
    const eq = entry.indexOf("=");
    if (eq > 0 && entry.slice(0, eq) === key) return entry.slice(eq + 1);
  }
  return null;
}

/**
 * @param {import("../context.mjs").Context} ctx
 * @param {Question} q
 * @returns {Promise<string>} the chosen option's value
 */
export async function ask(ctx, q) {
  const given = answered(ctx, q.key);
  if (given !== null) {
    if (!q.options.some((o) => o.value === given)) throw new CliError("USAGE", `--answer ${q.key}=${given}: choose ${q.options.map((o) => o.value).join(", ")}`);
    return given;
  }
  const recommended = q.options.find((o) => o.recommended) ?? q.options[0];
  if (ctx.flags.yes && recommended) return recommended.value;
  if (!ctx.out.interactive) {
    throw new CliError("NEEDS_INPUT", q.question, {
      hint: `Answer with --answer ${q.key}=<${q.options.map((o) => o.value).join("|")}>${recommended ? `, or --yes for ${recommended.value}` : ""}`,
      details: { schema: "nb.question/1", questions: [{ key: q.key, header: q.header, question: q.question, options: q.options, ...(q.preview ? { preview: q.preview } : {}) }] },
    });
  }
  return interactiveChoice(ctx, q);
}

/** A yes/no that defaults to the safe answer (A4.11). @param {import("../context.mjs").Context} ctx @param {{ key: string, question: string, yesLabel?: string, noLabel?: string, preview?: string, defaultYes?: boolean, heldByServer?: boolean }} c heldByServer: the server holds it for an agent token */
export async function confirm(ctx, c) {
  // --yes means yes, even where the safe default is No (delete, unlink); --answer key=no still says no.
  if (ctx.flags.yes && answered(ctx, c.key) === null) return true;
  // An agent token's big changes are held by the server for the person's yes; asking here too asked them twice.
  if (c.heldByServer && String(ctx.profile?.token ?? "").startsWith("nb_agt_")) return true;
  try {
    const value = await ask(ctx, {
      key: c.key,
      header: "Confirm",
      question: c.question,
      ...(c.preview ? { preview: c.preview } : {}),
      options: c.defaultYes
        ? [{ value: "yes", label: c.yesLabel ?? "Yes", recommended: true }, { value: "no", label: c.noLabel ?? "No" }]
        : [{ value: "no", label: c.noLabel ?? "No", recommended: true }, { value: "yes", label: c.yesLabel ?? "Yes" }],
    });
    return value === "yes";
  } catch (error) {
    // A missing yes is "needs confirmation" (exit 7), not "needs input".
    if (error instanceof CliError && error.code === "NEEDS_INPUT") throw new CliError("NEEDS_CONFIRMATION", c.question, { hint: `Run again with --yes (or --answer ${c.key}=yes)`, details: error.details });
    throw error;
  }
}

/** @param {import("../context.mjs").Context} ctx @param {Question} q */
function interactiveChoice(ctx, q) {
  const { out } = ctx;
  const err = out.stderr;
  const stdin = process.stdin;
  let cursor = Math.max(0, q.options.findIndex((o) => o.recommended));
  let drawn = 0;

  const render = () => {
    if (drawn) err.write(`\x1b[${drawn}A\x1b[J`);
    const lines = [`${out.c.accent(out.sym.active)} ${out.c.bold(safe(q.header))}  ${safe(q.question)}`];
    if (q.preview) for (const l of safe(q.preview).split("\n").slice(0, 12)) lines.push(`${out.c.muted(out.sym.rail)}  ${l}`);
    q.options.forEach((o, i) => {
      const pointer = i === cursor ? out.c.accent(out.sym.cursor) : " ";
      const label = i === cursor ? out.c.bold(safe(o.label)) : safe(o.label);
      lines.push(`${out.c.muted(out.sym.rail)} ${pointer} ${i + 1}  ${label}${o.description ? `  ${out.c.muted(safe(o.description))}` : ""}${o.recommended ? `  ${out.c.accent("Recommended")}` : ""}`);
    });
    lines.push(`${out.c.muted(out.sym.end)}  ${out.c.muted(`1–${q.options.length} or ↑/↓ · Enter choose · Esc cancel`)}`);
    err.write(`${lines.join("\n")}\n`);
    drawn = lines.length;
  };

  return new Promise((resolve, reject) => {
    readline.emitKeypressEvents(stdin);
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    err.write("\x1b[?25l");
    render();
    const cleanup = () => {
      stdin.off("keypress", onKey);
      stdin.setRawMode(Boolean(wasRaw));
      stdin.pause();
      err.write("\x1b[?25h");
    };
    const finish = (/** @type {number} */ index) => {
      cleanup();
      const chosen = /** @type {Option} */ (q.options[index]);
      err.write(`\x1b[${drawn}A\x1b[J${out.c.success(out.sym.done)} ${safe(q.header)}  ${out.c.muted(safe(chosen.label))}\n`);
      resolve(chosen.value);
    };
    /** @param {string} str @param {readline.Key} key */
    function onKey(str, key) {
      if ((key.ctrl && key.name === "c") || key.name === "escape") {
        cleanup();
        err.write(`\x1b[${drawn}A\x1b[J`);
        reject(new CliError("CANCELLED", "Cancelled"));
        return;
      }
      if (key.name === "up") { cursor = (cursor - 1 + q.options.length) % q.options.length; render(); return; }
      if (key.name === "down") { cursor = (cursor + 1) % q.options.length; render(); return; }
      if (key.name === "return" || key.name === "enter") { finish(cursor); return; }
      const n = Number(str);
      if (Number.isInteger(n) && n >= 1 && n <= q.options.length) finish(n - 1);
    }
    stdin.on("keypress", onKey);
  });
}
