// nb inbox (report A11.1–A11.3): the app's notification tray in the terminal, the same items and unread counts.
// --follow waits for new ones (long-poll, A11.2); --notify also shows them as desktop notifications (opt-in, D22).
import { execFile } from "node:child_process";

import { CliError, EXIT, usage } from "../errors.mjs";
import { safe } from "../print/style.mjs";
import { formatWhen } from "./tasks.mjs";

/** @typedef {import("../context.mjs").Context} Context */

/** @param {Context} ctx */
async function page(ctx) {
  return /** @type {any} */ (await ctx.api.get("/api/v1/inbox", { query: { limit: 50 } }));
}

/** @param {Context} ctx */
export async function inbox(ctx) {
  if (ctx.flags.follow) return follow(ctx);
  const p = await page(ctx);
  const items = (/** @type {any[]} */ (p.items)).filter((i) => !ctx.flags.unread || !i.readAt);
  const { c, sym } = ctx.out;
  ctx.out.result("nb.inbox/1", { unread: p.unreadCount, items }, (d) => d.items.length ? [
    `${d.unread} unread`,
    ...d.items.map((i, n) => `${i.readAt ? " " : c.brand(sym.brand)} ${String(n + 1).padStart(2)}  ${c.muted(formatWhen(i.activityAt ?? i.createdAt))}  ${i.href ? ctx.out.link(safe(i.title), new URL(i.href, ctx.profile.origin).toString(), ctx.profile.origin) : safe(i.title)}${i.body ? c.muted(` · ${safe(String(i.body)).replace(/\n/g, " ").slice(0, 80)}`) : ""}`),
    c.muted("  nb inbox reply <n> \"text\" · nb inbox approve <n> · nb inbox read <n> · nb inbox open <n>"),
  ] : "Nothing in your inbox", { page: true });
}

/** Items by their number in `nb inbox` (newest first) or id. @param {Context} ctx */
async function pick(ctx) {
  const refs = ctx.positionals;
  if (!refs.length && !ctx.flags.all) throw usage("Which ones?", "nb inbox read 1 2, or nb inbox read --all");
  const items = /** @type {any[]} */ ((await page(ctx)).items);
  return refs.map((r) => {
    const hit = /^\d+$/.test(r) ? items[Number(r) - 1] : items.find((i) => i.id.startsWith(r));
    if (!hit) throw new CliError("NOT_FOUND", `No inbox item ${r}`, { hint: "nb inbox" });
    return hit;
  });
}

/** @param {Context} ctx */
export async function inboxRead(ctx) {
  const items = ctx.flags.all ? [] : await pick(ctx);
  const res = /** @type {any} */ (await ctx.api.post("/api/v1/inbox/read", ctx.flags.all ? { all: true } : { ids: items.map((i) => i.id) }));
  ctx.out.result("nb.inbox.read/1", { read: res.read }, (d) => `${ctx.out.c.success(ctx.out.sym.done)} Marked ${d.read} read`);
}

/** The task an inbox item is about; replying and approving work on those (C4). @param {any} item @param {string} ref */
function taskOf(item, ref) {
  const refs = item.entityRefs ?? {};
  if (!refs.taskId) throw new CliError("NOT_A_TASK", "That item isn't about a task, so there's nothing to reply to here", { hint: `nb inbox open ${ref}` });
  return /** @type {{ taskId: string, projectId?: string, commentId?: string }} */ (refs);
}

/** `nb inbox reply 3 "done"` (C4): a comment on the item's task, as a reply when the item is a comment. @param {Context} ctx */
export async function inboxReply(ctx) {
  const [ref, ...words] = ctx.positionals;
  const text = String(ctx.flags.message ?? words.join(" ")).trim();
  if (!ref || !text) throw usage('nb inbox reply <n> "your reply"');
  const [item] = await pick({ ...ctx, positionals: [ref] });
  const refs = taskOf(item, ref);
  // @names become real mentions in the item's workspace (C4).
  const { withMentions } = await import("./tasks.mjs");
  const said = refs.projectId ? await withMentions({ ...ctx, requireWorkspace: () => /** @type {string} */ (refs.projectId) }, text) : text;
  await ctx.api.post("/api/v1/extension/comments", { kind: "task", ...(refs.projectId ? { projectId: refs.projectId } : {}), taskId: refs.taskId, text: said, ...(refs.commentId ? { replyTo: refs.commentId } : {}) });
  await ctx.api.post("/api/v1/inbox/read", { ids: [item.id] });
  ctx.out.result("nb.inbox.reply/1", { item: item.id, taskId: refs.taskId }, () => `${ctx.out.c.success(ctx.out.sym.done)} Replied on ${safe(item.title)}`);
}

/** `nb inbox approve 3` (C4): approve the task waiting for your review. @param {Context} ctx */
export async function inboxApprove(ctx) {
  const ref = ctx.positionals[0];
  if (!ref) throw usage("nb inbox approve <n>");
  const [item] = await pick(ctx);
  const refs = taskOf(item, ref);
  const { task } = /** @type {any} */ (await ctx.api.get("/api/v1/extension/task-detail", { query: { taskId: refs.taskId, brief: "1" } }));
  if (task.reviewStatus !== "pending") throw new CliError("NOTHING_TO_APPROVE", `#${task.taskNumber} isn't waiting for review`, { hint: `nb inbox open ${ref}` });
  await ctx.api.patch("/api/v1/extension/task-update", { kind: "approve", projectId: task.projectId, taskId: task.id, expectedUpdatedAt: new Date(task.updatedAt).toISOString() });
  await ctx.api.post("/api/v1/inbox/read", { ids: [item.id] });
  ctx.out.result("nb.inbox.approve/1", { number: task.taskNumber }, (d) => `${ctx.out.c.success(ctx.out.sym.done)} Approved #${d.number}`);
}

/** @param {Context} ctx */
export async function inboxOpen(ctx) {
  const [item] = await pick(ctx);
  if (!item?.href) throw new CliError("NOT_FOUND", "That item has no page to open");
  const url = new URL(item.href, ctx.profile.origin).toString();
  const { openInBrowser } = await import("./misc.mjs");
  const opened = await openInBrowser(url);
  await ctx.api.post("/api/v1/inbox/read", { ids: [item.id] });
  ctx.out.result("nb.inbox.open/1", { url, opened }, (d) => (d.opened ? `Opened ${d.url}` : `Open ${d.url}`));
}

/**
 * A desktop notification, without a shell: macOS osascript, Linux notify-send, Windows a PowerShell balloon. Text is
 * passed as arguments, never pasted into a script. @param {string} title @param {string} body
 */
export function desktopNotify(title, body) {
  const clean = (/** @type {string} */ s) => s.replace(/[\u0000-\u001f\u007f"\\]/g, " ").slice(0, 200);
  const [t, b] = [clean(title), clean(body)];
  const run = (/** @type {string} */ cmd, /** @type {string[]} */ args) => new Promise((resolve) => execFile(cmd, args, { windowsHide: true, timeout: 5000 }, () => resolve(undefined)));
  if (process.platform === "darwin") return run("osascript", ["-e", "on run argv", "-e", "display notification (item 2 of argv) with title (item 1 of argv)", "-e", "end run", t, b]);
  if (process.platform === "linux") return run("notify-send", ["--app-name=NetworkBase", t, b]);
  if (process.platform === "win32") return run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "param($t,$b) Add-Type -AssemblyName System.Windows.Forms; $n=New-Object System.Windows.Forms.NotifyIcon; $n.Icon=[System.Drawing.SystemIcons]::Information; $n.Visible=$true; $n.ShowBalloonTip(5000,$t,$b,'Info'); Start-Sleep 6", t, b]);
  return Promise.resolve(undefined);
}

/** Waits for new items until Ctrl+C: one line each (NDJSON with --json), and a desktop notification with --notify. @param {Context} ctx */
async function follow(ctx) {
  let since = new Date().toISOString();
  let stopping = false;
  process.once("SIGINT", () => { stopping = true; });
  if (!ctx.out.json) ctx.out.note(ctx.out.c.muted("Waiting for new notifications. Ctrl+C to stop."));
  let backoff = 1000;
  while (!stopping) {
    try {
      const res = /** @type {any} */ (await ctx.api.get("/api/v1/events", { query: { since, inbox: 1 }, timeoutMs: 40_000 }));
      since = res.cursor;
      backoff = 1000;
      for (const n of res.notifications) {
        if (ctx.out.json) ctx.out.raw(`${JSON.stringify({ schema: "nb.inbox.item/1", data: n })}\n`);
        else ctx.out.raw(`${ctx.out.c.brand(ctx.out.sym.brand)} ${ctx.out.c.muted(n.at.slice(11, 16))}  ${safe(n.title)}${n.body ? ctx.out.c.muted(` · ${safe(String(n.body)).replace(/\n/g, " ").slice(0, 80)}`) : ""}\n`);
        if (ctx.flags.notify) await desktopNotify(n.title, n.body ?? "");
      }
    } catch (error) {
      if (error instanceof CliError && (error.code === "UNAUTHORIZED" || error.status === 403)) throw error;
      // Offline or the server is busy: wait longer each time, up to a minute.
      await new Promise((r) => setTimeout(r, backoff));
      backoff = Math.min(60_000, backoff * 2);
    }
  }
  return EXIT.ok;
}

// ───────────────────────────────── settings and mute (report C4, M4b): the same as Settings → Notifications

const CATEGORIES = ["mentions", "tasks", "workflows", "projects", "applications", "connections"];
const hhmm = (/** @type {number} */ m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/**
 * `nb inbox settings` shows them; `--on tasks`, `--off projects`, `--quiet 22:00-08:00|off`, `--pause 2h|off` change
 * only what's named.
 * @param {Context} ctx
 */
export async function inboxSettings(ctx) {
  /** @type {Record<string, unknown>} */
  const change = {};
  const names = (/** @type {unknown} */ v) => /** @type {string[]} */ ([v ?? []].flat()).flatMap((x) => String(x).split(",")).map((x) => x.trim()).filter(Boolean);
  for (const [flag, on] of /** @type {const} */ ([["on", true], ["off", false]])) {
    for (const n of names(ctx.flags[flag])) {
      if (!CATEGORIES.includes(n)) throw usage(`${n} isn't a kind of notification`, `Kinds: ${CATEGORIES.join(", ")}`);
      change[n] = on;
    }
  }
  if (ctx.flags.quiet !== undefined) {
    const q = String(ctx.flags.quiet);
    const m = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec(q);
    if (q !== "off" && !m) throw usage("--quiet takes 22:00-08:00, or off");
    change.quietHours = q === "off" ? { enabled: false, startMinute: 1320, endMinute: 480 } : { enabled: true, startMinute: Number(m?.[1]) * 60 + Number(m?.[2]), endMinute: Number(m?.[3]) * 60 + Number(m?.[4]), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
  }
  if (ctx.flags.pause !== undefined) {
    const p = String(ctx.flags.pause);
    const m = /^(\d{1,3})(m|h|d)$/.exec(p);
    if (p !== "off" && !m) throw usage("--pause takes 30m, 2h, 1d, or off");
    change.pausedUntil = p === "off" ? null : new Date(Date.now() + Number(m?.[1]) * (m?.[2] === "d" ? 86_400_000 : m?.[2] === "h" ? 3_600_000 : 60_000)).toISOString();
  }
  const { preferences: p } = /** @type {any} */ (Object.keys(change).length ? await ctx.api.patch("/api/v1/me/notifications", change) : await ctx.api.get("/api/v1/me/notifications"));
  const { c } = ctx.out;
  ctx.out.result("nb.inbox.settings/1", p, (d) => [
    ...CATEGORIES.map((k) => `  ${k.padEnd(13)}${d[k] ? c.success("on") : c.muted("off")}`),
    `  quiet hours  ${d.quietHours?.enabled ? `${hhmm(d.quietHours.startMinute)}–${hhmm(d.quietHours.endMinute)}` : c.muted("off")}`,
    `  paused       ${d.pausedUntil && Date.parse(d.pausedUntil) > Date.now() ? `until ${new Date(d.pausedUntil).toLocaleString()}` : c.muted("no")}`,
    `  muted        ${d.mutedScopes?.length ? d.mutedScopes.map((/** @type {any} */ s) => safe(s.label ?? `${s.kind} ${String(s.value).slice(0, 8)}`)).join(", ") : c.muted("nothing")}`,
    c.muted("  nb inbox settings --off projects · --quiet 22:00-08:00 · --pause 2h · nb inbox mute <workspace|#task>"),
  ]);
}

/** `nb inbox mute deepscope-ai` or `nb inbox mute #4`; `--off` unmutes. @param {Context} ctx */
export async function inboxMute(ctx) {
  const ref = ctx.positionals[0];
  if (!ref) throw usage("nb inbox mute <workspace|#task> [--off]");
  /** @type {{ kind: "project" | "task", value: string, label: string }} */
  let scope;
  if (/^(#|T-)?\d+$/i.test(ref)) {
    const { resolveTask } = await import("./tasks.mjs");
    const t = await resolveTask(ctx, ref, { brief: true });
    scope = { kind: "task", value: t.id, label: `#${t.taskNumber} ${t.title}`.slice(0, 200) };
  } else {
    const { workspaces } = /** @type {any} */ (await ctx.api.get("/api/v1/extension/workspaces"));
    const w = workspaces.find((/** @type {any} */ x) => String(x.slug).toLowerCase() === ref.toLowerCase() || String(x.title).toLowerCase() === ref.toLowerCase());
    if (!w) throw new CliError("WORKSPACE_NOT_FOUND", `No workspace ${ref} in your list`, { hint: "nb workspace list" });
    scope = { kind: "project", value: w.id, label: w.title };
  }
  const { preferences } = /** @type {any} */ (await ctx.api.get("/api/v1/me/notifications"));
  const others = (preferences.mutedScopes ?? []).filter((/** @type {any} */ s) => !(s.kind === scope.kind && s.value === scope.value));
  await ctx.api.patch("/api/v1/me/notifications", { mutedScopes: ctx.flags.off ? others : [...others, scope] });
  ctx.out.result("nb.inbox.mute/1", { ...scope, muted: !ctx.flags.off }, (d) => `${ctx.out.c.success(ctx.out.sym.done)} ${d.muted ? "Muted" : "Unmuted"} ${safe(d.label)}`);
}
