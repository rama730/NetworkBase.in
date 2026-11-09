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

/** Errors before a command is known still honour --json. */
const early = createOutput({ json: argv.includes("--json") || process.env.NB_JSON === "1", plain: argv.includes("--plain") });

// Always give the terminal its cursor back, whatever happens.
const restoreCursor = () => { if (process.stderr.isTTY) process.stderr.write("\x1b[?25h"); };
process.on("exit", restoreCursor);
for (const signal of /** @type {const} */ (["SIGINT", "SIGTERM"])) process.on(signal, () => { restoreCursor(); process.exit(EXIT.cancelled); });

try {
  if (argv.length === 1 && (argv[0] === "--version" || argv[0] === "-v")) {
    const { VERSION } = await import("../lib/context.mjs");
    process.stdout.write(`${VERSION}\n`);
    process.exit(EXIT.ok);
  }
  const { spec, rest, alias } = resolveCommand(argv);
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
  const ctx = createContext({ flags: spec.name === "prompt" ? { ...flags, quiet: true } : flags, positionals });
  if (alias) {
    const { remindOnce } = await import("../lib/print/remind.mjs");
    remindOnce(ctx, `alias:${alias.from}`, `nb ${alias.from} is now nb ${alias.to} (the old name works until 3.0)`);
  }
  await ctx.resolveWorkspace();
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
  early.error(cliError);
  if (cliError.code === "INTERNAL" && process.env.NB_DEBUG === "1" && error instanceof Error) process.stderr.write(`${error.stack}\n`);
  process.exitCode = cliError.exitCode;
}
