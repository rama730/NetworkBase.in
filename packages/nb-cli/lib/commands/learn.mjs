// nb learn (report C1, M4d): five minutes of guided practice in a workspace made for it. Each step shows the real
// command, waits for Enter in a terminal, then runs it in a practice folder. Nothing touches real workspaces, and the
// practice workspace is deleted at the end (--keep leaves it for 24 hours).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

import { CliError } from "../errors.mjs";
import { safe } from "../print/style.mjs";

/** @typedef {import("../context.mjs").Context} Context */

/** Waits for Enter; q (or Ctrl+C, Esc) stops. In scripts and with --yes it never waits. @param {Context} ctx */
async function next(ctx) {
  if (!ctx.out.interactive || ctx.flags.yes) return true;
  ctx.out.stderr.write(ctx.out.c.muted("  Enter to run it, q to stop "));
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  const answer = await new Promise((resolve) => { rl.once("line", resolve); rl.once("close", () => resolve("q")); });
  rl.close();
  return !/^\s*(q|quit|exit)\s*$/i.test(String(answer));
}

/** @param {Context} ctx */
export async function learn(ctx) {
  const { c, sym } = ctx.out;
  const started = /** @type {any} */ (await ctx.api.post("/api/v1/sandbox", {})).sandbox;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nb-learn-"));
  // The steps run the same nb, signed in the same way.
  const pass = /** @type {const} */ (["profile", "api-url"]).flatMap((f) => (ctx.flags[f] ? [`--${f}`, String(ctx.flags[f])] : []));
  /** @param {string[]} args @param {{ json?: boolean }} [o] */
  const nb = (args, o = {}) => {
    const r = spawnSync(process.execPath, [process.argv[1] ?? "", ...args, ...pass, ...(o.json ? ["--json"] : [])], { cwd: dir, env: { ...ctx.env, NB_NO_UPDATE_CHECK: "1" }, encoding: "utf8", stdio: o.json ? ["ignore", "pipe", "pipe"] : ["ignore", "inherit", "inherit"] });
    if (r.status !== 0 && !o.json) throw new CliError("LEARN_STEP_FAILED", `nb ${args.join(" ")} didn't work`, { hint: "Run nb learn again; it picks up the same practice workspace" });
    return o.json ? JSON.parse(r.stdout || "{}") : null;
  };
  let number = 0;
  /** @type {Array<{ title: string, say: string, show: string, run: () => void }>} */
  const steps = [
    { title: "Link a folder", say: "A folder on your computer is linked to one workspace. This practice folder is linked to your practice workspace.", show: `nb init ${started.slug}`, run: () => nb(["init", started.slug]) },
    { title: "See what changed", say: "Make a file, then nb status lists what's new here and what's waiting.", show: "nb status", run: () => { fs.writeFileSync(path.join(dir, "notes.md"), "# My first NetworkBase file\n\nWritten during nb learn.\n"); nb(["status"]); } },
    { title: "Push it", say: "nb push uploads changes. Pushing the same path again makes a new version; nothing is overwritten.", show: "nb push notes.md", run: () => nb(["push", "notes.md"]) },
    { title: "Make a task and start it", say: "Tasks are the work. nb task start makes one this folder's task, so pushes attach to it.", show: 'nb task add "Try NetworkBase" && nb task start 1', run: () => { number = Number(nb(["task", "add", "Try NetworkBase"], { json: true })?.data?.number ?? 1); nb(["task", "start", String(number)]); } },
    { title: "Finish it", say: "nb done finishes the current task (or sends it for review where that's the rule).", show: 'nb done -m "practised"', run: () => nb(["task", "done", String(number), "-m", "practised", "--yes"]) },
  ];
  ctx.out.note(`${c.bold("nb learn")}: ${steps.length} steps, about five minutes, in a practice workspace that's deleted at the end.`);
  let finished = false;
  try {
    for (const [i, step] of steps.entries()) {
      ctx.out.stderr.write(`\n${c.accent(sym.active)} ${c.bold(`Step ${i + 1} of ${steps.length}: ${step.title}`)}\n  ${safe(step.say)}\n  ${c.brand("$")} ${step.show}\n`);
      if (!(await next(ctx))) return ctx.out.result("nb.learn/1", { finished: false, steps: i, kept: false }, () => "Stopped. Run nb learn again any time.");
      step.run();
    }
    finished = true;
  } finally {
    if (!ctx.flags.keep) await ctx.api.request("DELETE", `/api/v1/sandbox/${encodeURIComponent(started.id)}`).catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true });
  }
  ctx.out.result("nb.learn/1", { finished, steps: steps.length, kept: Boolean(ctx.flags.keep) }, () => [
    `\n${c.success(sym.done)} Done: link, status, push, task start, done. That's the everyday loop.`,
    ctx.flags.keep ? c.muted(`  The practice workspace stays for 24 hours: ${started.slug}`) : c.muted("  The practice workspace is deleted."),
    "  Next: nb init in a real project folder, or nb help for everything else.",
  ]);
}
