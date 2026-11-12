// help, version, completion, config, open, doctor, feedback, prompt, setup shell (report §17.4, A6.4–A6.6, A13.9).
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { commandHelp, helpData, overviewHelp } from "../args.mjs";
import { COMMANDS } from "./table.mjs";
import { DIR_NAME, readUserConfig, writeUserConfig } from "../config.mjs";
import { CliError, usage } from "../errors.mjs";
import { safe } from "../print/style.mjs";

/** @typedef {import("../context.mjs").Context} Context */

/** `nb` on its own (report C1): signed out → sign in; not linked → the matching workspace; linked → nb status. @param {Context} ctx */
export async function home(ctx) {
  const { c } = ctx.out;
  if (!ctx.profile.token) {
    ctx.out.result("nb.home/1", { state: "signed-out" }, () => [
      `${c.brand("NetworkBase")} ${c.muted(ctx.version)}`, "", "You're not signed in.", "",
      `  nb login   ${c.muted("Sign in (one click in your browser)")}`,
      `  nb help    ${c.muted("What the CLI can do")}`,
    ]);
    return;
  }
  if (!ctx.project) {
    const { folderMatches } = await import("./link.mjs");
    const { workspaces } = /** @type {any} */ (await ctx.api.get("/api/v1/extension/workspaces"));
    const matches = folderMatches(workspaces, ctx.cwd).slice(0, 3).map((/** @type {any} */ w) => ({ slug: w.slug, title: w.title }));
    ctx.out.result("nb.home/1", { state: "not-linked", matches, workspaces: workspaces.length }, (d) => [
      "This folder isn't linked to a workspace.",
      ...(d.matches.length
        ? ["", `Best match${d.matches.length > 1 ? "es" : ""}:`, ...d.matches.map((/** @type {any} */ m) => `  nb init ${safe(m.slug)}   ${c.muted(safe(m.title))}`)]
        : ["", `  nb init    ${c.muted(d.workspaces ? "Choose one of your workspaces" : "Create a workspace at networkbase.in first")}`]),
      `  nb help    ${c.muted("What the CLI can do")}`,
    ]);
    return;
  }
  const { status } = await import("./files.mjs");
  return status(ctx);
}

/** @param {Context} ctx */
export async function help(ctx) {
  const name = ctx.positionals.join(" ");
  if (!name) {
    ctx.out.result("nb.help/1", helpData(), () => overviewHelp(process.stdout.columns), { page: true });
    return;
  }
  const spec = COMMANDS.find((c) => c.name === name);
  if (!spec) throw usage(`No command called nb ${name}`, "See nb help");
  ctx.out.result("nb.help.command/1", helpData().commands.find((c) => c.name === name), () => commandHelp(spec));
}

/** @param {Context} ctx */
export async function version(ctx) {
  let server = null;
  try {
    const health = /** @type {any} */ (await ctx.api.request("GET", "/api/v1/health", { auth: false, timeoutMs: 5000 }));
    server = health?.version ?? health?.status ?? "reachable";
  } catch {
    server = null;
  }
  const data = { cli: ctx.version, node: process.versions.node, platform: `${process.platform}-${process.arch}`, server: ctx.profile.origin, serverStatus: server };
  ctx.out.result("nb.version/1", data, (d) => [`nb ${d.cli}`, `node ${d.node} · ${d.platform}`, `server ${d.server}${d.serverStatus ? "" : " (not reachable)"}`]);
}

/** Shell completion from the command table (A6.6). @param {Context} ctx */
export async function completion(ctx) {
  const shell = ctx.positionals[0];
  const names = [...new Set(COMMANDS.map((c) => c.name.split(" ")[0]))];
  const subs = /** @type {Record<string, string[]>} */ ({});
  for (const c of COMMANDS) {
    const [head, sub] = c.name.split(" ");
    if (sub && head) (subs[head] ??= []).push(sub);
  }
  const scripts = /** @type {Record<string, string>} */ ({
    zsh: `#compdef nb\n_nb() {\n  local -a cmds\n  if (( CURRENT == 2 )); then cmds=(${names.join(" ")}); _describe 'command' cmds; return; fi\n  case $words[2] in\n${Object.entries(subs).map(([h, s]) => `    ${h}) cmds=(${s.join(" ")}); _describe 'subcommand' cmds;;`).join("\n")}\n  esac\n}\ncompdef _nb nb`,
    bash: `_nb() {\n  local cur=\${COMP_WORDS[COMP_CWORD]}\n  if [ "$COMP_CWORD" -eq 1 ]; then COMPREPLY=($(compgen -W "${names.join(" ")}" -- "$cur")); return; fi\n  case \${COMP_WORDS[1]} in\n${Object.entries(subs).map(([h, s]) => `    ${h}) COMPREPLY=($(compgen -W "${s.join(" ")}" -- "$cur"));;`).join("\n")}\n  esac\n}\ncomplete -F _nb nb`,
    fish: [`complete -c nb -f -n '__fish_use_subcommand' -a '${names.join(" ")}'`, ...Object.entries(subs).map(([h, s]) => `complete -c nb -f -n '__fish_seen_subcommand_from ${h}' -a '${s.join(" ")}'`)].join("\n"),
    powershell: `Register-ArgumentCompleter -Native -CommandName nb -ScriptBlock {\n  param($word, $ast)\n  $parts = $ast.CommandElements | ForEach-Object { $_.ToString() }\n  $subs = @{ ${Object.entries(subs).map(([h, s]) => `'${h}' = @('${s.join("','")}')`).join("; ")} }\n  $list = if ($parts.Count -le 2) { @('${names.join("','")}') } else { $subs[$parts[1]] }\n  $list | Where-Object { $_ -like "$word*" } | ForEach-Object { [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_) }\n}`,
  });
  if (!shell || !scripts[shell]) throw usage("Choose a shell: nb completion zsh|bash|fish|powershell");
  ctx.out.raw(`${scripts[shell]}\n`);
}

const SETTINGS = /** @type {Record<string, { describe: string, check: (v: string) => boolean }>} */ ({
  "default-as": { describe: "Role when nb push has no --as: reference, draft or final", check: (v) => ["reference", "draft", "final"].includes(v) },
  editor: { describe: "Editor for nb doc edit and -m with no text", check: (v) => v.length > 0 },
  "base-cache-mb": { describe: "Space for offline diff copies (MB)", check: (v) => /^\d+$/.test(v) },
  presence: { describe: "Show teammates what you're editing: on or off", check: (v) => v === "on" || v === "off" },
});

/** @param {Context} ctx */
export async function config(ctx) {
  const [action = "list", key, value] = ctx.positionals;
  const current = readUserConfig(ctx.env);
  if (action === "list") {
    ctx.out.result("nb.config/1", current, (c) => Object.keys(SETTINGS).map((k) => `${k.padEnd(14)} ${c[k] ?? ctx.out.c.muted("(default)")}  ${ctx.out.c.muted(SETTINGS[k]?.describe ?? "")}`));
    return;
  }
  if (!key || !SETTINGS[key]) throw usage(`Unknown setting ${key ?? ""}`.trim(), `Settings: ${Object.keys(SETTINGS).join(", ")}`);
  if (action === "get") return ctx.out.result("nb.config.value/1", { key, value: current[key] ?? null }, (d) => String(d.value ?? ""));
  if (action !== "set" || value === undefined) throw usage("nb config set <key> <value>");
  if (!SETTINGS[key].check(value)) throw usage(`${value} isn't a valid value for ${key}`, SETTINGS[key].describe);
  writeUserConfig({ ...current, [key]: value }, ctx.env);
  ctx.out.result("nb.config.value/1", { key, value }, (d) => `Set ${d.key} to ${d.value}`);
}

/** Opens a URL with the system browser, without a shell (finding 4: `cmd start` broke on "&"). @param {string} url */
export function openInBrowser(url) {
  const [cmd, args] =
    process.platform === "darwin" ? ["open", [url]] :
    process.platform === "win32" ? ["rundll32", ["url.dll,FileProtocolHandler", url]] :
    ["xdg-open", [url]];
  return new Promise((resolve) => execFile(/** @type {string} */ (cmd), /** @type {string[]} */ (args), { windowsHide: true }, (error) => resolve(!error)));
}

/** @param {Context} ctx */
export async function open(ctx) {
  const target = ctx.positionals[0];
  const slug = ctx.project?.slug ?? ctx.flags.workspace;
  if (!slug) throw new CliError("NOT_LINKED", "No workspace to open", { hint: "Run nb init <workspace>, or pass --workspace" });
  const base = `${ctx.profile.origin}/workspaces/${encodeURIComponent(slug)}`;
  const url = !target ? base : /^#?\d+$/.test(target) ? `${base}?tab=tasks&task=${target.replace("#", "")}` : `${base}?tab=files&path=${encodeURIComponent(target.startsWith("/") ? target : `/${target}`)}`;
  const opened = await openInBrowser(url);
  ctx.out.result("nb.open/1", { url, opened }, (d) => (d.opened ? `Opened ${d.url}` : `Open ${d.url}`));
}

/** Health checks with a next step each (A6.4). @param {Context} ctx */
export async function doctor(ctx) {
  const checks = await runChecks(ctx);
  const failed = checks.filter((c) => !c.ok);
  ctx.out.result("nb.doctor/1", { ok: failed.length === 0, checks }, (d) =>
    d.checks.map((c) => `${c.ok ? ctx.out.c.success(ctx.out.sym.check) : ctx.out.c.danger(ctx.out.sym.error)} ${c.check.padEnd(10)} ${c.detail}${c.fix ? `\n  ${ctx.out.c.muted(c.fix)}` : ""}`));
  return failed.length ? 1 : 0;
}

/**
 * A report to send with a problem (A13.9): doctor's checks without tokens, names or paths (unless
 * --include-paths). Nothing is sent from here; there is no telemetry.
 * @param {Context} ctx
 */
export async function feedback(ctx) {
  const checks = await runChecks(ctx);
  const scrub = (/** @type {string} */ s) => {
    let out = s.replace(/nb_(pat|dev|agt)_[A-Za-z0-9_-]+/g, "nb_$1_…");
    out = out.replace(/@[\w.-]+/g, "@<you>");
    if (!ctx.flags["include-paths"]) {
      if (ctx.root) out = out.split(ctx.root).join("<folder>");
      if (ctx.project?.slug) out = out.split(ctx.project.slug).join("<workspace>");
      out = out.split(os.homedir()).join("~");
    }
    return out;
  };
  const report = { cli: ctx.version, node: process.versions.node, platform: `${process.platform} ${os.release()} ${process.arch}`, checks: checks.map((c) => ({ ...c, detail: scrub(c.detail) })) };
  // ponytail: printed, not sent; a form on networkbase.in when one exists (A13.9).
  ctx.out.result("nb.feedback/1", report, (d) => [
    "Send this to support@networkbase.in with what you were doing:",
    "",
    JSON.stringify(d, null, 2),
  ]);
}

/** One short line for your shell prompt: the linked workspace and started task. No network; empty outside a link. @param {Context} ctx */
export async function prompt(ctx) {
  if (!ctx.project || !ctx.root) return;
  const { branchTask } = await import("./tasks.mjs");
  const number = ctx.project.startedTask?.number ?? branchTask(ctx.root);
  // "2 changed": tracked files whose size or time moved since the last sync, by stat only (it runs on every prompt).
  // ponytail: new untracked files aren't counted, and past 3,000 tracked files the count is left out.
  let changed = 0;
  try {
    const { readState } = await import("../sync/state.mjs");
    const { toRelative } = await import("../sync/local.mjs");
    const entries = Object.entries(readState(ctx.root, ctx.project.workspaceId).files);
    if (entries.length <= 3000) {
      for (const [remotePath, base] of entries) {
        const rel = toRelative(ctx.project.remoteRoot ?? "/", remotePath);
        if (rel === null) continue;
        try {
          const st = fs.statSync(path.join(ctx.root, ...rel.split("/")));
          if (st.size !== base.size || Math.trunc(st.mtimeMs) !== Math.trunc(base.mtimeMs)) changed++;
        } catch {
          changed++;
        }
      }
    }
  } catch {
    // No sync yet: nothing to count.
  }
  const parts = [number ? `#${number}` : safe(ctx.project.slug ?? "nb"), changed ? `${changed} changed` : null].filter(Boolean);
  // A trailing space, so `PS1='$(nb prompt)'$PS1` reads well and adds nothing outside linked folders.
  ctx.out.raw(`[${parts.join(" · ")}] `);
}

const RC = /** @type {Record<string, { file: (home: string) => string, line: string, prompt: string }>} */ ({
  zsh: { file: (h) => path.join(h, ".zshrc"), line: "command -v nb >/dev/null && source <(nb completion zsh)", prompt: "setopt PROMPT_SUBST; PROMPT='$(nb prompt 2>/dev/null)'$PROMPT" },
  bash: { file: (h) => path.join(h, ".bashrc"), line: "command -v nb >/dev/null && source <(nb completion bash)", prompt: "PS1='$(nb prompt 2>/dev/null)'$PS1" },
  fish: { file: (h) => path.join(h, ".config", "fish", "conf.d", "nb.fish"), line: "type -q nb; and nb completion fish | source", prompt: "functions -q _nb_prompt_was; or functions -c fish_prompt _nb_prompt_was; function fish_prompt; nb prompt 2>/dev/null; _nb_prompt_was; end" },
});

/** Adds completions to your shell's startup file, after a yes (A6.6). @param {Context} ctx */
export async function setupShell(ctx) {
  const shell = ctx.positionals[0] ?? path.basename(ctx.env.SHELL ?? (process.platform === "win32" ? "powershell" : ""));
  if (shell === "powershell" || shell === "pwsh") {
    return ctx.out.result("nb.setup.shell/1", { shell: "powershell", added: false }, () => ["Add this line to your PowerShell profile (notepad $PROFILE):", "  nb completion powershell | Out-String | Invoke-Expression"]);
  }
  const rc = RC[shell];
  if (!rc) throw usage(`No setup for ${shell || "this shell"}`, "nb setup shell zsh|bash|fish|powershell");
  if (/[\\/]_npx[\\/]/.test(process.argv[1] ?? "")) ctx.out.warn("nb isn't installed, so completions won't find it: npm i -g @networkbase/cli");
  const file = rc.file(os.homedir());
  const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const { confirm } = await import("../tui/ask.mjs");
  /** @type {string[]} */
  const lines = [];
  if (!current.includes("nb completion")) {
    if (!(await confirm(ctx, { key: "shell", question: `Add nb completions to ${file}?`, preview: rc.line, yesLabel: "Add", defaultYes: true }))) return 130;
    lines.push(rc.line);
  }
  // The current task in the prompt, [#4 · 2 changed] (C8): a separate yes, since it changes how the prompt looks.
  if (!current.includes("nb prompt") && (await confirm(ctx, { key: "prompt", question: `Show the current task in your prompt too, like [#4 · 2 changed]?`, preview: rc.prompt, yesLabel: "Add", defaultYes: true }).catch(() => false))) lines.push(rc.prompt);
  if (!lines.length) return ctx.out.result("nb.setup.shell/1", { shell, file, added: false }, () => `Already set up in ${file}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${current && !current.endsWith("\n") ? "\n" : ""}# NetworkBase CLI\n${lines.join("\n")}\n`);
  ctx.out.result("nb.setup.shell/1", { shell, file, added: true, prompt: lines.includes(rc.prompt) }, (d) => [
    `${ctx.out.c.success(ctx.out.sym.done)} Added ${lines.includes(rc.line) ? "completions" : ""}${lines.length === 2 ? " and " : ""}${d.prompt ? "the task in your prompt" : ""} to ${file}; open a new terminal to use ${lines.length === 2 ? "them" : "it"}`,
  ]);
}

/** @param {Context} ctx */
async function runChecks(ctx) {
  /** @type {Array<{ check: string, ok: boolean, detail: string, fix?: string }>} */
  const checks = [];
  const add = (/** @type {string} */ check, /** @type {boolean} */ ok, /** @type {string} */ detail, /** @type {string} */ fix = "") => checks.push({ check, ok, detail, ...(fix ? { fix } : {}) });

  const major = Number(process.versions.node.split(".")[0]);
  add("Node", major >= 20, process.versions.node, major >= 20 ? "" : "Install Node 22 LTS from nodejs.org");

  // Version: what the daily update check last saw (no extra request here).
  const { newer } = await import("../print/notices.mjs");
  const { globalDir, readJson } = await import("../config.mjs");
  const latest = (() => { try { return readJson(path.join(globalDir(ctx.env), "update.json"))?.latest ?? null; } catch { return null; } })();
  add("Version", !(latest && newer(latest, ctx.version)), latest && newer(latest, ctx.version) ? `${ctx.version}; ${latest} is out` : ctx.version, latest && newer(latest, ctx.version) ? "npm i -g @networkbase/cli" : "");

  // Proxy and company certificates (A6.4): Node ignores HTTPS_PROXY unless told to.
  const proxy = ctx.env.HTTPS_PROXY || ctx.env.https_proxy || ctx.env.HTTP_PROXY || ctx.env.http_proxy;
  if (proxy) add("Proxy", Boolean(ctx.env.NODE_USE_ENV_PROXY), ctx.env.NODE_USE_ENV_PROXY ? "used (NODE_USE_ENV_PROXY=1)" : "set but Node won't use it", ctx.env.NODE_USE_ENV_PROXY ? "" : "export NODE_USE_ENV_PROXY=1");
  const ca = ctx.env.NODE_EXTRA_CA_CERTS;
  if (ca) add("Certificates", fs.existsSync(ca), fs.existsSync(ca) ? `extra certificates from ${ca}` : `NODE_EXTRA_CA_CERTS points to a missing file: ${ca}`, fs.existsSync(ca) ? "" : "Fix the path or unset it");

  const started = Date.now();
  let serverDate = null;
  try {
    const res = await fetch(new URL("/api/v1/health", ctx.profile.origin), { signal: AbortSignal.timeout(8000) });
    serverDate = res.headers.get("date");
    add("Server", res.ok, `${new URL(ctx.profile.origin).host} answered in ${Date.now() - started} ms`);
  } catch (error) {
    const code = /** @type {any} */ (error)?.cause?.code;
    const certificate = /CERT|ISSUER/.test(String(code));
    add("Server", false, `can't reach ${new URL(ctx.profile.origin).host} (${code ?? "network error"})`,
      certificate ? "Your network uses its own certificate: set NODE_EXTRA_CA_CERTS to its file" :
      ctx.env.HTTPS_PROXY || ctx.env.https_proxy ? "A proxy is set: run with NODE_USE_ENV_PROXY=1 so Node uses it" : "Check your connection");
  }
  if (serverDate) {
    const skew = Math.abs(Date.now() - Date.parse(serverDate));
    add("Clock", skew < 120_000, `${Math.round(skew / 1000)} s from the server`, skew < 120_000 ? "" : "Turn on automatic time in your system settings");
  }

  if (!ctx.profile.token) add("Signed in", false, `not signed in to ${new URL(ctx.profile.origin).host}`, "Run nb login");
  else {
    try {
      const me = /** @type {any} */ (await ctx.api.get("/api/v1/me"));
      add("Signed in", true, `@${safe(me.user.username ?? me.user.id)} (${ctx.profile.profile?.source === "env" ? "token from environment" : `profile ${ctx.profile.name}`})`);
    } catch (error) {
      add("Signed in", false, error instanceof Error ? error.message : String(error), "Run nb login");
    }
  }

  if (!ctx.root) add("Folder", true, "not linked (fine outside a project)");
  else {
    const dir = path.join(ctx.root, DIR_NAME);
    let writable = true;
    try { fs.accessSync(ctx.root, fs.constants.W_OK); } catch { writable = false; }
    add("Folder", writable, `${ctx.root} → ${ctx.project?.slug ?? ctx.project?.workspaceId}`, writable ? "" : "This folder is read-only for you");
    const leftovers = fs.readdirSync(dir).filter((f) => f.includes(".nbtmp-") || f === "lock");
    const lockStale = leftovers.includes("lock");
    if (ctx.flags.repair) for (const f of leftovers) fs.rmSync(path.join(dir, f), { force: true });
    add("State", !leftovers.length || Boolean(ctx.flags.repair), leftovers.length ? `${leftovers.length} leftover file(s)${ctx.flags.repair ? " removed" : ""}` : "clean",
      leftovers.length && !ctx.flags.repair ? `Run nb doctor --repair${lockStale ? " (only when no other nb is running)" : ""}` : "");

    // Case: on a case-insensitive disk, Report.md and report.md in the workspace are one file here (A1.16).
    const probe = path.join(dir, `CaseProbe-${process.pid}`);
    let insensitive = false;
    try { fs.writeFileSync(probe, ""); insensitive = fs.existsSync(path.join(dir, path.basename(probe).toLowerCase())); } catch { /* read-only */ } finally { fs.rmSync(probe, { force: true }); }
    add("Names", true, insensitive ? "this disk ignores letter case: files differing only in case are skipped on pull" : "this disk keeps letter case");

    // Free space: a pull needs room for the files plus a temp copy of the largest one.
    try {
      const st = fs.statfsSync(ctx.root);
      const free = st.bavail * st.bsize;
      add("Disk", free > 500 * 1024 * 1024, `${(free / 1024 / 1024 / 1024).toFixed(1)} GB free`, free > 500 * 1024 * 1024 ? "" : "Free some space before pulling");
    } catch { /* statfs isn't on every platform */ }

    // Role: viewers can pull but not push.
    if (ctx.profile.token && ctx.project?.workspaceId) {
      try {
        const w = /** @type {any} */ (await ctx.api.get(`/api/v1/workspaces/${encodeURIComponent(ctx.project.workspaceId)}`));
        add("Role", true, `${w.role ?? "member"}${w.canWrite === false ? " (can pull, can't push)" : ""}`);
      } catch (error) {
        add("Role", false, error instanceof Error ? error.message : String(error), "Ask the workspace owner to add you, or nb init another workspace");
      }
    }

    // Agents connected here (A7.8).
    const { agentRows } = await import("./agent.mjs");
    const on = agentRows(ctx.root, ctx.env).filter((a) => a.server).map((a) => a.name);
    add("Agents", true, on.length ? `${on.join(", ")} connected` : "none connected (nb agent setup claude)");
  }

  return checks;
}
