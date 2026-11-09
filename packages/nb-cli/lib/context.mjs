// What every command gets: output, flags, the linked folder, the signed-in profile and an API client.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createApi } from "./api.mjs";
import { currentProfile, findRoot, readProjectConfig } from "./config.mjs";
import { CliError } from "./errors.mjs";
import { createOutput } from "./print/out.mjs";

const PACKAGE_JSON = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json");
/** The version comes from package.json only, so it can't drift (finding 92). */
export const VERSION = JSON.parse(fs.readFileSync(PACKAGE_JSON, "utf8")).version;

/**
 * @param {{ flags: Record<string, any>, positionals: string[], cwd?: string, env?: NodeJS.ProcessEnv, fetchImpl?: typeof fetch }} input
 */
export function createContext({ flags, positionals, cwd = process.cwd(), env = process.env, fetchImpl }) {
  const out = createOutput({ json: Boolean(flags.json || env.NB_JSON === "1"), quiet: Boolean(flags.quiet), plain: Boolean(flags.plain), verbose: Boolean(flags.verbose) });
  const root = findRoot(cwd);
  const project = root ? readProjectConfig(root, (m) => out.warn(m)) : null;
  const profile = currentProfile({ flags, env, project });
  const api = createApi({
    origin: profile.origin,
    token: profile.token,
    version: VERSION,
    fetchImpl,
    onRetry: ({ waitMs, reason }) => out.note(out.c.muted(`${reason}; retrying in ${Math.max(1, Math.round(waitMs / 1000))} s`)),
  });

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
      if (flags.workspace) return /** @type {string} */ (flags.workspace);
      if (project?.workspaceId) return project.workspaceId;
      throw new CliError("NOT_LINKED", "This folder isn't linked to a workspace", { hint: "Run nb init <workspace>, or pass --workspace <slug>" });
    },
    /** The linked folder; commands that sync files need one. */
    requireRoot() {
      if (!root || !project) throw new CliError("NOT_LINKED", "This folder isn't linked to a workspace", { hint: "Run nb init <workspace> here" });
      return { root, project };
    },
  };
}

/** @typedef {ReturnType<typeof createContext>} Context */
