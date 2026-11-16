// Live capture (report G8): saved files go into the open change set while you or an agent work, after the file has
// settled (500 ms checks, 2 s of quiet), as `nb watch` waits. A burst of events (a git checkout, an install) is one
// rescan when it goes quiet, never one upload per event. Where recursive watching isn't available, it polls.
import fs from "node:fs";
import path from "node:path";

import { CliError } from "../errors.mjs";
import { currentChange, draftItems, setCurrentChange, syncDraft, writeJournal } from "./capture.mjs";

const CHECK_MS = 500;
const QUIET_MS = 2000;
const POLL_MS = 2000;
const SKIP = /(^|\/)(\.networkbase|\.git|node_modules|\.tasks)(\/|$)|\.nbtmp-|\.swp$|~$|(^|\/)\.#|(^|\/)4913$/;

/**
 * @param {{ api: import("../api.mjs").Api, root: string, project: { workspaceId: string, remoteRoot: string }, autoTitle?: (() => string) | null, log?: (line: string) => void }} opts
 *   autoTitle: open a change set by itself on the first save (nb mcp); without it, saves wait for nb change start.
 * @returns {{ stop: () => void, flush: () => Promise<void> }}
 */
export function startCapture({ api, root, project, autoTitle = null, log = () => {} }) {
  let changedAt = 0;
  let busy = false;
  let off = false;
  /** @type {fs.FSWatcher | null} */
  let watcher = null;
  try {
    watcher = fs.watch(root, { recursive: true }, (_event, name) => {
      const rel = name ? String(name).split(path.sep).join("/") : "";
      if (rel && SKIP.test(rel)) return;
      changedAt = Date.now();
    });
    watcher.on("error", () => { watcher?.close(); watcher = null; });
  } catch {
    watcher = null; // some network drives: polling below
  }
  let polledAt = 0;

  async function flush() {
    if (off || busy) return;
    busy = true;
    try {
      const { items } = await draftItems(root, project);
      let id = currentChange(root);
      if (!items.length && !id) return;
      if (!id) {
        if (!autoTitle) { log("Saves wait for a change set: nb change start \"what you're doing\""); off = true; return; }
        const res = /** @type {any} */ (await api.post(`/api/v1/workspaces/${encodeURIComponent(project.workspaceId)}/change-sets`, { title: autoTitle().slice(0, 120) }));
        id = /** @type {string} */ (res.changeSet.id);
        setCurrentChange(root, id);
        writeJournal(root, { id, title: res.changeSet.title, sent: {}, missing: [] });
        log(`Started the change set "${res.changeSet.title}"`);
      }
      const sync = await syncDraft(api, root, id, items);
      if (sync.sent || sync.dropped || sync.uploaded) log(`Change set: ${items.length} file${items.length === 1 ? "" : "s"}${sync.pending ? `, ${sync.pending} still uploading` : ""}`);
    } catch (error) {
      const e = error instanceof CliError ? error : null;
      // Change sets are off here, or the set was closed elsewhere: stop capturing, keep the files.
      if (e?.code === "CHANGE_SETS_OFF") off = true;
      if (e?.code === "CHANGE_SET_CLOSED") setCurrentChange(root, null);
      log(`Change set capture: ${e?.message ?? String(error)}`);
    } finally {
      busy = false;
    }
  }

  const timer = setInterval(() => {
    const now = Date.now();
    if (!watcher && now - polledAt >= POLL_MS) { polledAt = now; changedAt = changedAt || now - QUIET_MS; }
    if (!changedAt || now - changedAt < QUIET_MS) return;
    changedAt = 0;
    void flush();
  }, CHECK_MS);
  timer.unref?.();
  return { stop: () => { clearInterval(timer); watcher?.close(); }, flush };
}
