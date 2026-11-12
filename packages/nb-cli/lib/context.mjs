// What every command gets: output, flags, the linked folder, the signed-in profile and an API client.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createApi } from "./api.mjs";
import { currentProfile, findRoot, readProjectConfig } from "./config.mjs";
import { CliError } from "./errors.mjs";
import { createOutput } from "./print/out.mjs";
import { appendUndo } from "./undo-log.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PACKAGE_JSON = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json");
/** The version comes from package.json only, so it can't drift (finding 92). */
export const VERSION = JSON.parse(fs.readFileSync(PACKAGE_JSON, "utf8")).version;

/**
 * @param {{ flags: Record<string, any>, positionals: string[], cwd?: string, env?: NodeJS.ProcessEnv, fetchImpl?: typeof fetch, io?: Parameters<typeof createOutput>[1] }} input
 */
export function createContext({ flags, positionals, cwd = process.cwd(), env = process.env, fetchImpl, io }) {
  const out = createOutput({ json: Boolean(flags.json || env.NB_JSON === "1"), quiet: Boolean(flags.quiet), plain: Boolean(flags.plain), verbose: Boolean(flags.verbose), fields: flags.fields ? String(flags.fields).split(",").map((f) => f.trim()).filter(Boolean) : null, pager: !flags["no-pager"] }, io);
  const root = findRoot(cwd);
  const project = root ? readProjectConfig(root, (m) => out.warn(m)) : null;
  const profile = currentProfile({ flags, env, project });
  const api = createApi({
    origin: profile.origin,
    token: profile.token,
    version: VERSION,
    fetchImpl,
    confirmToken: typeof flags.confirm === "string" ? flags.confirm : null,
    onUndo: (u) => appendUndo(env, { token: u.token, at: Date.now(), method: u.method, path: u.path, origin: profile.origin, session: env.NB_AGENT_SESSION ?? null }),
    onRetry: ({ waitMs, reason }) => out.note(out.c.muted(`${reason}; retrying in ${Math.max(1, Math.round(waitMs / 1000))} s`)),
    // Commands with their own --dry-run (push, pull) plan without writing; every other one stops at its first write.
    dryRun: Boolean(flags["dry-run"]) && !flags.ownDryRun,
  });

  // The first step comes first (C1): signed out, "link this folder" is the wrong advice.
  const signedInFirst = () => {
    if (!profile.token) throw new CliError("NOT_SIGNED_IN", "Sign in first: nb login", { hint: "Then run this again" });
  };

  return {
    out,
    flags,
    positionals,
    cwd,
    env,
    root,
    project,
    profile,
    api,
    version: VERSION,
    /** Workspace id from --workspace or the link; an error naming the fix otherwise. */
    requireWorkspace() {
      signedInFirst();
      if (flags.workspace) return /** @type {string} */ (flags.workspace);
      if (project?.workspaceId) return project.workspaceId;
      // A default for scripts, CI and the hosted MCP server (an agent token's own workspace).
      if (env.NB_WORKSPACE) return env.NB_WORKSPACE;
      throw new CliError("NOT_LINKED", "This folder isn't linked to a workspace", { hint: "Run nb init <workspace>, or pass --workspace <slug>" });
    },
    /** --workspace takes a slug or title; the API needs the id, so it's looked up once before the command runs. */
    async resolveWorkspace() {
      const given = flags.workspace;
      if (!given || UUID.test(given)) return;
      const { workspaces } = /** @type {any} */ (await api.get("/api/v1/extension/workspaces"));
      const want = String(given).toLowerCase();
      const found = workspaces.find((/** @type {any} */ w) => String(w.slug).toLowerCase() === want) ?? workspaces.find((/** @type {any} */ w) => String(w.title).toLowerCase() === want);
      if (!found) throw new CliError("WORKSPACE_NOT_FOUND", `No workspace ${given} in your list`, { hint: workspaces.length ? `Yours: ${workspaces.slice(0, 8).map((/** @type {any} */ w) => w.slug).join(", ")}` : "Create one at networkbase.in first" });
      flags.workspace = found.id;
    },
    /** The linked folder; commands that sync files need one. */
    requireRoot() {
      signedInFirst();
      if (!root || !project) throw new CliError("NOT_LINKED", "This folder isn't linked to a workspace", { hint: "Run nb init <workspace> here" });
      return { root, project };
    },
  };
}

/** @typedef {ReturnType<typeof createContext>} Context */
