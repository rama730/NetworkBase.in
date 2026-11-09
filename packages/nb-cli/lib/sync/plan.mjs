// Three-way decisions (report A1.5, A1.6): for each path, compare your file, the server's file and what was
// last synced (the base). Pure — no I/O — so every row of the table is tested directly.

/**
 * @typedef {{ nodeId: string, version: number, hash: string | null, size: number, updatedAt?: string | null }} RemoteFile
 * @typedef {"unchanged" | "modified" | "added" | "deleted" | "remote-modified" | "remote-added" | "remote-deleted" | "conflict" | "same-change" | "moved"} FileState
 * @typedef {"none" | "push" | "pull" | "adopt" | "remove-local" | "restore" | "conflict" | "keep-local" | "delete-remote" | "move"} FileAction
 * @typedef {{ path: string, state: FileState, action: FileAction, local?: import("./local.mjs").LocalFile, remote?: RemoteFile, base?: import("./state.mjs").BaseEntry, note?: string, from?: string }} PlanItem
 */

/**
 * @param {{ base: Record<string, import("./state.mjs").BaseEntry>, local: Map<string, import("./local.mjs").LocalFile>, remote: Map<string, RemoteFile> }} input
 * @returns {PlanItem[]}
 */
export function planSync({ base, local, remote }) {
  const paths = new Set([...Object.keys(base), ...local.keys(), ...remote.keys()]);
  /** @type {PlanItem[]} */
  const items = [];
  for (const p of [...paths].sort()) {
    const b = base[p];
    const l = local.get(p);
    const r = remote.get(p);
    const localChanged = Boolean(l && b && l.hash !== b.baseHash);
    const remoteChanged = Boolean(r && b && (r.version !== b.baseVersion && r.hash !== b.baseHash));
    /** @param {FileState} state @param {FileAction} action @param {string} [note] */
    const add = (state, action, note) => items.push({ path: p, state, action, ...(l ? { local: l } : {}), ...(r ? { remote: r } : {}), ...(b ? { base: b } : {}), ...(note ? { note } : {}) });

    if (b) {
      if (l && r) {
        if (!localChanged && !remoteChanged) add("unchanged", r.version !== b.baseVersion ? "adopt" : "none");
        else if (localChanged && !remoteChanged) add("modified", "push");
        else if (!localChanged && remoteChanged) add("remote-modified", "pull");
        else if (l.hash === r.hash) add("same-change", "adopt");
        else add("conflict", "conflict", "changed here and on the server");
      } else if (!l && r) {
        if (remoteChanged) add("remote-modified", "restore", "deleted here but changed on the server: restoring the server's version");
        else add("deleted", "delete-remote");
      } else if (l && !r) {
        if (localChanged) add("added", "keep-local", "deleted on the server after you changed it: kept here as a new file");
        else add("remote-deleted", "remove-local");
      } else {
        add("unchanged", "none", "gone everywhere");
      }
    } else if (l && r) {
      if (l.hash === r.hash) add("unchanged", "adopt");
      else add("conflict", "conflict", "a file with this name exists on the server with different content");
    } else if (l) add("added", "push");
    else if (r) add("remote-added", "pull");
  }
  return detectMoves(items);
}

/**
 * A file deleted here and a new file with the same content is a move or rename (A1.17): one "move" item keeps the
 * file's history on the server instead of a delete and a new upload. Only unambiguous pairs (one each per hash).
 * @param {PlanItem[]} items
 */
export function detectMoves(items) {
  /** @param {PlanItem[]} list */
  const byHash = (list, hashOf = (/** @type {PlanItem} */ i) => i.local?.hash) => {
    /** @type {Map<string, PlanItem[]>} */
    const m = new Map();
    for (const i of list) { const h = hashOf(i); if (h) m.set(h, [...(m.get(h) ?? []), i]); }
    return m;
  };
  const gone = byHash(items.filter((i) => i.action === "delete-remote"), (i) => i.base?.baseHash);
  const added = byHash(items.filter((i) => i.action === "push" && !i.base && !i.remote));
  /** @type {Set<PlanItem>} */
  const drop = new Set();
  for (const [hash, [to, ...moreTo]] of added) {
    const from = gone.get(hash);
    if (!to || moreTo.length || from?.length !== 1) continue;
    const old = /** @type {PlanItem} */ (from[0]);
    drop.add(old);
    Object.assign(to, { state: "moved", action: "move", from: old.path, base: old.base, remote: old.remote });
  }
  return drop.size ? items.filter((i) => !drop.has(i)) : items;
}

/** The status words `nb status` prints (A1.5). @param {PlanItem} item */
export function stateLabel(item) {
  switch (item.state) {
    case "modified": return "modified";
    case "added": return "added";
    case "deleted": return "deleted";
    case "remote-modified": return item.action === "restore" ? "restore" : "remote changed";
    case "remote-added": return "remote new";
    case "remote-deleted": return "remote deleted";
    case "conflict": return "conflict";
    case "same-change": return "same change";
    case "moved": return `moved from ${item.from}`;
    default: return "unchanged";
  }
}
