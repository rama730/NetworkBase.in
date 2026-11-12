#!/usr/bin/env node
// NetworkBase CLI entry: parse, run one command, print, exit (report A13.1). Commands return data; nothing
// else here decides output.
const [major] = process.versions.node.split(".").map(Number);
if ((major ?? 0) < 20) {
  process.stderr.write(`NetworkBase CLI needs Node 20 or newer (you have ${process.versions.node}). Install Node 22 LTS from https://nodejs.org\n`);
  process.exit(1);
}

const { commandHelp, overviewHelp, parseFlags, resolveCommand } = await import("../lib/args.mjs");
const { CliError, EXIT, toCliError } = await import("../lib/errors.mjs");
const { createOutput } = await import("../lib/print/out.mjs");

const argv = process.argv.slice(2);

// A company proxy or certificates (C6, nb config set proxy|ca-file, or HTTPS_PROXY): start once more with them set.
{
  const { readUserConfig } = await import("../lib/config.mjs");
  const { networkEnv } = await import("../lib/network.mjs");
  let userConfig = {};
  try { userConfig = readUserConfig(process.env); } catch { /* unreadable config: carry on without */ }
  const add = networkEnv(userConfig, process.env, process.versions.node);
  if (add) {
    const { spawnSync } = await import("node:child_process");
    const again = spawnSync(process.execPath, process.argv.slice(1), { stdio: "inherit", env: { ...process.env, ...add } });
    process.exit(again.status ?? 1);
  }
}

/** Errors before a command is known still honour --json. */
const early = createOutput({ json: argv.includes("--json") || process.env.NB_JSON === "1", plain: argv.includes("--plain") });

// Always give the terminal its cursor back, whatever happens.
const restoreCursor = () => { if (process.stderr.isTTY) process.stderr.write("\x1b[?25h"); };
process.on("exit", restoreCursor);
for (const signal of /** @type {const} */ (["SIGINT", "SIGTERM"])) process.on(signal, () => { restoreCursor(); process.exit(EXIT.cancelled); });

/** The command being run, so a usage error can point at its help (C5). @type {string | null} */
let commandName = null;
try {
  if (argv.length === 1 && (argv[0] === "--version" || argv[0] === "-v")) {
    const { VERSION } = await import("../lib/context.mjs");
    process.stdout.write(`${VERSION}\n`);
    process.exit(EXIT.ok);
  }
  const { spec, rest, alias } = resolveCommand(argv);
  commandName = spec?.name ?? null;
  if (!spec) {
    if (argv.includes("--json")) {
      const { helpData } = await import("../lib/args.mjs");
      process.stdout.write(`${JSON.stringify({ ok: true, schema: "nb.help/1", data: helpData() })}\n`);
    } else process.stdout.write(`${overviewHelp(process.stdout.columns)}\n`);
    process.exit(argv.length === 0 || argv.includes("--help") || argv.includes("-h") || argv.includes("--json") ? EXIT.ok : EXIT.usage);
  }
  const { positionals, flags } = parseFlags(spec, rest);
  if (flags.help) {
    process.stdout.write(`${commandHelp(spec)}\n`);
    process.exit(EXIT.ok);
  }
  const { createContext } = await import("../lib/context.mjs");
  // nb prompt runs on every shell prompt: errors only, no notices.
  // push and pull plan their own dry run; for every other command the API client stops at the first write.
  const ownDryRun = Boolean(spec.flags?.["dry-run"]);
  const ctx = createContext({ flags: spec.name === "prompt" ? { ...flags, quiet: true } : { ...flags, ownDryRun }, positionals });
  if (alias) {
    const { remindOnce } = await import("../lib/print/remind.mjs");
    remindOnce(ctx, `alias:${alias.from}`, alias.shortcut ? `nb ${alias.from} is short for nb ${alias.to}` : `nb ${alias.from} is now nb ${alias.to} (the old name works until 3.0)`);
  }
  // login is what signs you in, so it can't look a workspace up first; an agent's workspace is picked on the approval page.
  if (spec.name !== "login") await ctx.resolveWorkspace();
  const mod = await import(`../lib/commands/${spec.module}.mjs`);
  const run = mod[spec.fn];
  if (typeof run !== "function") throw new CliError("INTERNAL", `nb ${spec.name} isn't built yet`);
  let code;
  try {
    code = await run(ctx);
  } catch (error) {
    // The server held an agent's change for the person's yes (report §26.6): ask at a terminal, then run it again.
    const held = /** @type {any} */ (error instanceof CliError && error.code === "NEEDS_CONFIRMATION" ? error.details : null);
    if (!held?.confirmToken || !ctx.out.interactive) throw error;
    const { confirm } = await import("../lib/tui/ask.mjs");
    if (!(await confirm(ctx, { key: "server-confirm", question: String(held.summary ?? "Make this change?"), ...(held.preview ? { preview: String(held.preview) } : {}), yesLabel: "Yes, do it", defaultYes: false }))) throw new CliError("CANCELLED", "Nothing was changed");
    code = await run(createContext({ flags: { ...flags, confirm: held.confirmToken }, positionals }));
  }
  process.exitCode = typeof code === "number" ? code : EXIT.ok;
  await (await import("../lib/print/notices.mjs")).afterCommand(ctx);
} catch (error) {
  const cliError = toCliError(error);
  // A dry run ends at the first change: that's its answer, not an error (C3).
  if (cliError.code === "DRY_RUN") {
    const d = /** @type {any} */ (cliError.details);
    if (argv.includes("--json") || process.env.NB_JSON === "1") process.stdout.write(`${JSON.stringify({ ok: true, schema: "nb.dry-run/1", data: { wouldSend: d } })}\n`);
    else process.stdout.write(`Dry run, nothing changed. Would ${d.method} ${d.path}${d.body ? `\n  ${JSON.stringify(d.body).slice(0, 400)}` : ""}\n`);
    process.exit(EXIT.ok);
  }
  // A usage error's next step is the command's own help (C5).
  if (!cliError.hint && cliError.exitCode === EXIT.usage && commandName) cliError.hint = `See nb ${commandName} --help`;
  early.error(cliError);
  if (cliError.code === "INTERNAL" && process.env.NB_DEBUG === "1" && error instanceof Error) process.stderr.write(`${error.stack}\n`);
  process.exitCode = cliError.exitCode;
}
