// nb ui (report C9, M4d): a full-screen, keyboard-driven view with three panes: tasks, inbox and changed files.
// Enter opens, d marks done, p pushes, / filters, r refreshes, ? lists the keys, q quits. --plain, a script or a
// pipe get nb status instead. Data comes from the same commands' --json; actions run the real command in the normal
// screen, so their questions and yes prompts work as usual.
import { spawn, spawnSync } from "node:child_process";
import { self } from "../self.mjs";
import readline from "node:readline";

import { safe } from "../print/style.mjs";

/** @typedef {import("../context.mjs").Context} Context */
/** @typedef {{ label: string, hint?: string, open?: string[], done?: string[] }} Row */
/** @typedef {{ pane: number, sel: number[], filter: string, typing: boolean, help: boolean, note: string, head: string, panes: Array<{ title: string, rows: Row[], empty: string }> }} UiState */

export const KEYS = [
  ["↑ ↓  j k", "move"],
  ["Tab ← →", "switch pane"],
  ["Enter", "open: task details, the inbox item in the app, a file's diff"],
  ["d", "done: finish the task, mark the inbox item read"],
  ["p", "push the changed files"],
  ["/", "filter the rows"],
  ["r", "refresh"],
  ["?", "these keys"],
  ["q", "quit"],
];

const fit = (/** @type {string} */ s, /** @type {number} */ w) => ([...s].length > w ? `${[...s].slice(0, Math.max(0, w - 1)).join("")}…` : s);

/**
 * The screen as lines, at most `cols` wide and `rows` tall: a header, the three panes stacked (so 80 columns
 * works), and the keys. Pure, so tests read it. @param {UiState} s @param {number} cols @param {number} rows
 * @param {{ bold: (t: string) => string, muted: (t: string) => string, brand: (t: string) => string, accent: (t: string) => string }} c
 */
export function render(s, cols, rows, c) {
  const lines = [c.bold(fit(s.head, cols)), ""];
  if (s.help) {
    lines.push(c.bold("Keys"), ...KEYS.map(([k, what]) => fit(`  ${k.padEnd(10)} ${what}`, cols)), "", c.muted("Any key to go back"));
    return lines.slice(0, rows);
  }
  const body = Math.max(3, rows - 5);
  const per = Math.max(1, Math.floor(body / 3) - 1);
  s.panes.forEach((pane, i) => {
    const shown = pane.rows.filter((r) => !s.filter || r.label.toLowerCase().includes(s.filter.toLowerCase()));
    const focus = i === s.pane;
    lines.push((focus ? c.accent : c.muted)(fit(`${focus ? "▸" : " "} ${pane.title} (${shown.length})`, cols)));
    if (!shown.length) lines.push(c.muted(fit(`    ${s.filter ? "Nothing matches" : pane.empty}`, cols)));
    const sel = Math.min(s.sel[i] ?? 0, Math.max(0, shown.length - 1));
    const from = Math.max(0, Math.min(sel - per + 1, shown.length - per));
    for (const [n, row] of shown.slice(from, from + per).entries()) {
      const on = focus && from + n === sel;
      const text = fit(`  ${on ? "›" : " "} ${row.label}${row.hint ? `  ${row.hint}` : ""}`, cols);
      lines.push(on ? c.bold(text) : text);
    }
  });
  lines.push("", s.typing ? fit(`/${s.filter}▏`, cols) : c.muted(fit(s.note || "Enter open · d done · p push · / filter · r refresh · ? keys · q quit", cols)));
  return lines.slice(0, rows);
}

/** One command's --json, as the same nb with the same sign-in. @param {Context} ctx @param {string[]} args */
function json(ctx, args) {
  return new Promise((resolve) => {
    const child = spawn(...self([...args, "--json", ...pass(ctx)]), { cwd: ctx.cwd, env: { ...ctx.env, NB_NO_UPDATE_CHECK: "1" }, stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    child.on("close", () => { try { resolve(JSON.parse(out).data ?? null); } catch { resolve(null); } });
  });
}
const pass = (/** @type {Context} */ ctx) => /** @type {const} */ (["profile", "api-url", "workspace"]).flatMap((f) => (ctx.flags[f] ? [`--${f}`, String(ctx.flags[f])] : []));

/** @param {Context} ctx @returns {Promise<Pick<UiState, "head" | "panes">>} */
async function load(ctx) {
  const [next, inbox, status] = /** @type {any[]} */ (await Promise.all([json(ctx, ["next", "--limit", "30"]), json(ctx, ["inbox"]), json(ctx, ["status"])]));
  const tasks = (next?.items ?? []).map((/** @type {any} */ t) => /** @type {Row} */ ({
    label: `#${t.number} ${safe(t.title)}`, hint: safe(t.why ?? ""),
    open: t.kind === "assignment" ? ["assignment", "view", String(t.number)] : ["task", "view", String(t.number)],
    done: t.kind === "task" ? ["task", "done", String(t.number)] : undefined,
  }));
  const items = (inbox?.items ?? []).map((/** @type {any} */ i, /** @type {number} */ n) => /** @type {Row} */ ({
    label: `${i.readAt ? " " : "•"} ${safe(i.title)}`, hint: i.body ? safe(String(i.body)).replace(/\n/g, " ").slice(0, 40) : "",
    open: ["inbox", "open", String(n + 1)], done: i.readAt ? undefined : ["inbox", "read", String(n + 1)],
  }));
  const files = (status?.files ?? []).map((/** @type {any} */ f) => /** @type {Row} */ ({ label: safe(f.path), hint: safe(f.state), open: ["diff", f.path] }));
  const ws = status?.workspace?.slug ?? "";
  const task = status?.startedTask ? ` · #${status.startedTask.number} ${safe(status.startedTask.title ?? "")}` : "";
  const unread = inbox?.unread ?? 0;
  return {
    head: `NetworkBase · ${ws || "not linked"}${task}${unread ? ` · ${unread} unread` : ""}${status?.offline ? " · offline" : ""}`,
    panes: [
      { title: "Tasks", rows: tasks, empty: "Nothing open is yours" },
      { title: "Inbox", rows: items, empty: "Nothing in your inbox" },
      { title: "Changed here", rows: files, empty: ws ? "Up to date" : "This folder isn't linked: nb init" },
    ],
  };
}

/** @param {Context} ctx */
export async function ui(ctx) {
  // Not a full-screen terminal: the same overview as nb status (C9).
  if (!ctx.out.interactive || ctx.flags.plain || !process.stdin.isTTY) {
    const { status } = await import("./files.mjs");
    return status(ctx);
  }
  const out = process.stdout;
  /** @type {UiState} */
  const s = { pane: 0, sel: [0, 0, 0], filter: "", typing: false, help: false, note: "Loading…", head: "NetworkBase", panes: [{ title: "Tasks", rows: [], empty: "" }, { title: "Inbox", rows: [], empty: "" }, { title: "Changed here", rows: [], empty: "" }] };
  const { c } = ctx.out;
  const draw = () => out.write(`\x1b[H\x1b[2J${render(s, out.columns || 80, out.rows || 24, c).join("\n")}`);
  const enter = () => { out.write("\x1b[?1049h\x1b[?25l"); process.stdin.setRawMode(true); };
  const leave = () => { process.stdin.setRawMode(false); out.write("\x1b[?25h\x1b[?1049l"); };
  const refresh = async () => { Object.assign(s, await load(ctx), { note: "" }); draw(); };
  /** Runs a real command in the normal screen, then comes back. @param {string[]} args */
  const run = async (args) => {
    leave();
    out.write(`\n$ nb ${args.join(" ")}\n`);
    process.stdin.pause();
    spawnSync(...self([...args, ...pass(ctx)]), { cwd: ctx.cwd, env: ctx.env, stdio: "inherit" });
    out.write("\nPress Enter to go back to nb ui ");
    await new Promise((resolve) => { process.stdin.resume(); process.stdin.once("data", resolve); });
    enter();
    s.note = "Refreshing…";
    draw();
    await refresh();
  };
  const shown = () => s.panes[s.pane]?.rows.filter((r) => !s.filter || r.label.toLowerCase().includes(s.filter.toLowerCase())) ?? [];
  const current = () => shown()[Math.min(s.sel[s.pane] ?? 0, Math.max(0, shown().length - 1))];

  readline.emitKeypressEvents(process.stdin);
  enter();
  draw();
  const loaded = refresh();
  out.on("resize", draw);
  let busy = false;
  await new Promise((resolve) => {
    /** @param {string} str @param {{ name?: string, ctrl?: boolean }} key */
    const onKey = async (str, key = {}) => {
      if (busy) return;
      if (key.ctrl && key.name === "c") { process.stdin.off("keypress", onKey); return resolve(null); }
      if (s.help) { s.help = false; return draw(); }
      if (s.typing) {
        if (key.name === "return" || key.name === "escape") s.typing = false;
        else if (key.name === "backspace") s.filter = s.filter.slice(0, -1);
        else if (str && str.length === 1 && str >= " ") s.filter += str;
        return draw();
      }
      const n = shown().length;
      if (str === "q" || key.name === "escape") { process.stdin.off("keypress", onKey); return resolve(null); }
      if (key.name === "down" || str === "j") s.sel[s.pane] = Math.min((s.sel[s.pane] ?? 0) + 1, Math.max(0, n - 1));
      else if (key.name === "up" || str === "k") s.sel[s.pane] = Math.max((s.sel[s.pane] ?? 0) - 1, 0);
      else if (key.name === "tab" || key.name === "right") s.pane = (s.pane + 1) % 3;
      else if (key.name === "left") s.pane = (s.pane + 2) % 3;
      else if (str === "?") s.help = true;
      else if (str === "/") { s.typing = true; s.filter = ""; }
      else if (str === "r") { s.note = "Refreshing…"; draw(); await loaded; return refresh(); }
      else if (key.name === "return" || str === "d" || str === "p") {
        await loaded;
        const row = current();
        const args = str === "p" ? ["push"] : str === "d" ? row?.done : row?.open;
        if (!args) { s.note = str === "d" ? "Nothing to mark done here" : "Nothing to open"; return draw(); }
        busy = true;
        try { await run(args); } finally { busy = false; }
        return;
      }
      draw();
    };
    process.stdin.on("keypress", onKey);
  });
  out.off("resize", draw);
  leave();
  process.stdin.pause();
  ctx.out.result("nb.ui/1", { closed: true }, () => []);
}
