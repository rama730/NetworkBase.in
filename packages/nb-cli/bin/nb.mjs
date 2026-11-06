#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import crypto from "node:crypto";
import readline from "node:readline";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const CLI_SCRIPT_PATH = fileURLToPath(import.meta.url);

const CLI_VERSION = "1.0.0";
const DEFAULT_API_URL = process.env.NETWORKBASE_API_URL || "https://networkbase.in";
const GLOBAL_CONFIG_DIR = path.join(os.homedir(), ".networkbase");
const GLOBAL_CREDENTIALS_PATH = path.join(GLOBAL_CONFIG_DIR, "credentials.json");

const MIME_MAP = {
  ".ts": "text/typescript",
  ".tsx": "text/typescript",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".cjs": "application/javascript",
  ".jsx": "text/javascript",
  ".json": "application/json",
  ".md": "text/markdown",
  ".mdx": "text/markdown",
  ".css": "text/css",
  ".html": "text/html",
  ".py": "text/x-python",
  ".sql": "application/sql",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".yml": "text/yaml",
  ".yaml": "text/yaml",
};

const SECRET_PATTERNS = [
  { name: "AWS Access Key ID", regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "Private Key Block", regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  { name: "GitHub Personal Access Token", regex: /\bgh[pousr]_[A-Za-z0-9_]{36,}\b/ },
  { name: "OpenAI API Key", regex: /\bsk-[A-Za-z0-9]{20}T3BlbkFJ[A-Za-z0-9]{20}\b/ },
];

const IGNORED_DIRS = new Set([
  ".git",
  ".next",
  "node_modules",
  ".networkbase",
  "dist",
  "build",
  ".turbo",
  "coverage",
  "Library",
  "Applications",
  "Movies",
  "Music",
  "Pictures",
  ".Trash",
  ".npm",
  ".cache",
  ".gemini",
  "venv",
  ".venv",
  "__pycache__",
]);

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  }
}

function readJsonSafe(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonSafe(filePath, data, mode = 0o600) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", { encoding: "utf8", mode });
}

function getLocalNbDir(cwd = process.cwd()) {
  return path.join(cwd, ".networkbase");
}

function getLocalConfig(cwd = process.cwd()) {
  return readJsonSafe(path.join(getLocalNbDir(cwd), "config.json"), {});
}

function saveLocalConfig(config, cwd = process.cwd()) {
  writeJsonSafe(path.join(getLocalNbDir(cwd), "config.json"), config, 0o644);
}

function getLocalState(cwd = process.cwd()) {
  return readJsonSafe(path.join(getLocalNbDir(cwd), "state.json"), {});
}

function saveLocalState(state, cwd = process.cwd()) {
  writeJsonSafe(path.join(getLocalNbDir(cwd), "state.json"), state, 0o600);
}

function getLocalCache(cwd = process.cwd()) {
  return readJsonSafe(path.join(getLocalNbDir(cwd), "cache.json"), { tasks: [], updatedAt: null });
}

function saveLocalCache(cache, cwd = process.cwd()) {
  writeJsonSafe(path.join(getLocalNbDir(cwd), "cache.json"), cache, 0o644);
}

function getLocalManifest(cwd = process.cwd()) {
  return readJsonSafe(path.join(getLocalNbDir(cwd), "manifest.json"), {
    projectId: null,
    files: {},
    updatedAt: null,
  });
}

function saveLocalManifest(manifest, cwd = process.cwd()) {
  writeJsonSafe(path.join(getLocalNbDir(cwd), "manifest.json"), manifest, 0o644);
}

function updateManifestFiles(projectId, fileRecords, cwd = process.cwd()) {
  const current = getLocalManifest(cwd);
  const filesMap = current.projectId === projectId && current.files ? { ...current.files } : {};
  for (const item of fileRecords) {
    if (!item || !item.path) continue;
    const normPath = item.path.startsWith("/") ? item.path : `/${item.path}`;
    filesMap[normPath] = {
      nodeId: item.nodeId || filesMap[normPath]?.nodeId || null,
      version: item.version || item.currentVersion || filesMap[normPath]?.version || 1,
      contentHash: (item.contentHash || filesMap[normPath]?.contentHash || "").toLowerCase(),
      size: item.size ?? filesMap[normPath]?.size ?? 0,
      syncedAt: new Date().toISOString(),
    };
  }
  saveLocalManifest(
    {
      projectId,
      files: filesMap,
      updatedAt: new Date().toISOString(),
    },
    cwd,
  );
}

function getLocalMirrorDir(cwd = process.cwd()) {
  return path.join(getLocalNbDir(cwd), "mirror");
}

function getLocalTasksDir(cwd = process.cwd()) {
  return path.join(getLocalNbDir(cwd), "tasks");
}

function formatRoleLabel(role) {
  if (role === "deliverable") return "Final Deliverable (#deliverable)";
  if (role === "reference") return "Reference Spec (#reference)";
  return "Working Draft (#editor_working)";
}

function writeLocalTaskIntelligence(projectId, workspaceTitle, tasksList, cwd = process.cwd()) {
  const tasksDir = getLocalTasksDir(cwd);
  ensureDir(tasksDir);
  const state = getLocalState(cwd);
  const activeTaskId = state?.activeTaskId || null;

  const snapshot = {
    projectId,
    workspaceTitle: workspaceTitle || projectId,
    activeTaskId,
    updatedAt: new Date().toISOString(),
    totalTasks: tasksList.length,
    openTasksCount: tasksList.filter((t) => t.status !== "done").length,
    doneTasksCount: tasksList.filter((t) => t.status === "done").length,
    tasks: tasksList.map((t) => ({
      ...t,
      isActive: t.id === activeTaskId,
      files: (t.files || []).map((f) => ({
        ...f,
        localMirrorPath: `.networkbase/mirror/${(f.path || f.name || "").replace(/^\/+/, "")}`,
      })),
    })),
  };

  writeJsonSafe(path.join(tasksDir, "tasks.json"), snapshot, 0o644);
  saveLocalCache({ tasks: snapshot.tasks, updatedAt: snapshot.updatedAt }, cwd);

  const lines = [
    `# NetworkBase Workspace Tasks · ${workspaceTitle || projectId}`,
    ``,
    `- **Workspace ID:** \`${projectId}\``,
    `- **Updated At:** \`${snapshot.updatedAt}\``,
    `- **Total Tasks:** ${snapshot.totalTasks} (${snapshot.openTasksCount} open, ${snapshot.doneTasksCount} done)`,
    activeTaskId
      ? `- **Active Bound Task:** \`${state.activeTaskTitle || activeTaskId}\` (\`${activeTaskId}\`)`
      : `- **Active Bound Task:** None bound (run \`nb task work <#number>\` to bind)`,
    ``,
    `> **AI & Developer Note:** All attached task files below are automatically mirrored inside \`.networkbase/mirror/\`. You can read and edit them directly on disk with zero permission prompts, and push updates via \`nb sync\` or \`nb push --deliverable\`.`,
    ``,
    `---`,
    ``,
  ];

  if (snapshot.tasks.length === 0) {
    lines.push(`_No tasks found in this workspace._`, ``);
  } else {
    for (const t of snapshot.tasks) {
      const numLabel = t.taskNumber ? `#${t.taskNumber}` : t.id.slice(0, 8);
      const activeTag = t.isActive ? " ⭐ [ACTIVE TASK]" : "";
      const statusUpper = String(t.status || "todo").toUpperCase();
      const prioUpper = String(t.priority || "medium").toUpperCase();
      lines.push(`## ${numLabel}: ${t.title}${activeTag}`);
      lines.push(`- **Task ID:** \`${t.id}\``);
      lines.push(`- **Status:** \`${statusUpper}\` | **Priority:** \`${prioUpper}\`${t.storyPoints ? ` | **Points:** \`${t.storyPoints}\`` : ""}${t.sprintName ? ` | **Sprint:** ${t.sprintName}` : ""}`);
      if (t.assigneeName || t.assigneeUsername) {
        lines.push(`- **Assignee:** ${t.assigneeName || `@${t.assigneeUsername}`}`);
      }
      if (t.dueDate) {
        lines.push(`- **Due Date:** \`${t.dueDate}\``);
      }
      lines.push(``);
      lines.push(`### Description`);
      lines.push(t.description && t.description.trim() ? t.description.trim() : `_No description provided._`);
      lines.push(``);

      const subtasks = t.subtasks || [];
      const stCompleted = subtasks.filter((s) => s.completed).length;
      lines.push(`### Subtasks (${stCompleted}/${subtasks.length} Completed)`);
      if (subtasks.length === 0) {
        lines.push(`_No subtasks defined for this task._`);
      } else {
        for (let i = 0; i < subtasks.length; i++) {
          const st = subtasks[i];
          const idx = st.index || i + 1;
          lines.push(`- [${st.completed ? "x" : " "}] **${idx}.** ${st.title} _(id: \`${st.id}\`)_`);
        }
      }
      lines.push(``);

      const files = t.files || [];
      lines.push(`### Attached & Linked Files (${files.length})`);
      if (files.length === 0) {
        lines.push(`_No files attached to this task yet._`);
      } else {
        for (const f of files) {
          const roleText = formatRoleLabel(f.role);
          lines.push(
            `- **\`${f.path || f.name}\`** · \`v${f.currentVersion || 1}\` · **${roleText}** · Local Mirror: \`${f.localMirrorPath}\`${f.annotation ? ` · Note: _${f.annotation}_` : ""}`,
          );
        }
      }
      lines.push(``, `---`, ``);
    }
  }

  fs.writeFileSync(path.join(tasksDir, "TASKS.md"), lines.join("\n"), { mode: 0o644 });
  return {
    tasksMdPath: path.join(tasksDir, "TASKS.md"),
    tasksJsonPath: path.join(tasksDir, "tasks.json"),
    snapshot,
  };
}

function resolveTaskIdentifier(rawInput, cwd = process.cwd()) {
  if (!rawInput) return null;
  const trimmed = String(rawInput).trim();
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (UUID_REGEX.test(trimmed)) return trimmed;

  const numCleaned = trimmed.replace(/^(?:[a-zA-Z]+-)?#?/, "");
  if (/^\d+$/.test(numCleaned)) {
    const targetNum = Number(numCleaned);
    const localSnapshot = readJsonSafe(path.join(getLocalTasksDir(cwd), "tasks.json"), null);
    const candidateList = localSnapshot?.tasks || getLocalCache(cwd)?.tasks || [];
    const matched = candidateList.find((t) => Number(t.taskNumber) === targetNum);
    if (matched?.id) return matched.id;
    return String(targetNum);
  }
  return trimmed;
}

function getLastSyncReceipt(cwd = process.cwd()) {
  return readJsonSafe(path.join(getLocalNbDir(cwd), "last-sync.json"), null);
}

function saveLastSyncReceipt(receipt, cwd = process.cwd()) {
  writeJsonSafe(
    path.join(getLocalNbDir(cwd), "last-sync.json"),
    {
      ...receipt,
      timestamp: new Date().toISOString(),
    },
    0o644,
  );
}

function getDaemonStatus(cwd = process.cwd()) {
  const pidPath = path.join(getLocalNbDir(cwd), "daemon.pid");
  const info = readJsonSafe(pidPath, null);
  if (!info || !info.pid) return { running: false, pid: null, projectId: null };
  try {
    process.kill(info.pid, 0);
    return { running: true, pid: info.pid, projectId: info.projectId || null, startedAt: info.startedAt };
  } catch {
    return { running: false, pid: null, projectId: null };
  }
}

function stopBackgroundDaemon(cwd = process.cwd()) {
  const pidPath = path.join(getLocalNbDir(cwd), "daemon.pid");
  const info = readJsonSafe(pidPath, null);
  if (info && info.pid) {
    try {
      process.kill(info.pid, "SIGTERM");
    } catch {
      // Ignore already-stopped process
    }
  }
  try {
    if (fs.existsSync(pidPath)) fs.unlinkSync(pidPath);
  } catch {
    // Ignore
  }
}

function ensureBackgroundDaemon(projectId, cwd = process.cwd()) {
  const status = getDaemonStatus(cwd);
  if (status.running && status.projectId === projectId) {
    return status;
  }
  if (status.running) {
    stopBackgroundDaemon(cwd);
  }
  try {
    const nbDir = getLocalNbDir(cwd);
    ensureDir(nbDir);
    const child = spawn(
      process.execPath,
      [CLI_SCRIPT_PATH, "watch", "--daemon-worker", "--workspace", projectId],
      {
        cwd,
        detached: true,
        stdio: "ignore",
      },
    );
    child.unref();
    if (child.pid) {
      const pidInfo = {
        pid: child.pid,
        projectId,
        startedAt: new Date().toISOString(),
      };
      writeJsonSafe(path.join(nbDir, "daemon.pid"), pidInfo, 0o644);
      return { running: true, ...pidInfo };
    }
  } catch {
    // Non-fatal if background spawn is disallowed in constrained environments
  }
  return { running: false, pid: null, projectId };
}

function getCredentials() {
  const creds = readJsonSafe(GLOBAL_CREDENTIALS_PATH, null);
  if (process.env.NETWORKBASE_TOKEN) {
    return {
      token: process.env.NETWORKBASE_TOKEN,
      apiUrl: process.env.NETWORKBASE_API_URL || creds?.apiUrl || DEFAULT_API_URL,
      clientSessionId: creds?.clientSessionId || crypto.randomUUID(),
    };
  }
  return creds;
}

function saveCredentials(creds) {
  writeJsonSafe(GLOBAL_CREDENTIALS_PATH, {
    ...creds,
    clientSessionId: creds.clientSessionId || crypto.randomUUID(),
    savedAt: new Date().toISOString(),
  });
}

function parseFlags(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const eqIdx = arg.indexOf("=");
      if (eqIdx !== -1) {
        flags[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
      } else {
        const key = arg.slice(2);
        const next = argv[i + 1];
        if (next && !next.startsWith("-")) {
          flags[key] = next;
          i++;
        } else {
          flags[key] = true;
        }
      }
    } else if (arg === "-m" && argv[i + 1]) {
      flags.message = argv[++i];
    } else if (arg === "-j") {
      flags.json = true;
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function outputResult(data, flags, humanFormatter) {
  if (flags.json) {
    process.stdout.write(JSON.stringify(data, null, 2) + "\n");
  } else if (humanFormatter) {
    humanFormatter(data);
  } else {
    console.log(data);
  }
}

async function apiRequest(endpoint, options = {}) {
  const creds = getCredentials();
  const localCfg = getLocalConfig();
  const baseUrl = (options.apiUrl || localCfg.apiUrl || creds?.apiUrl || DEFAULT_API_URL).replace(/\/+$/, "");
  const token = options.token || creds?.token;

  if (!token && !options.allowUnauthenticated) {
    throw new Error("Not signed in. Run `nb auth login --token <token>` or `nb auth login` first.");
  }

  const headers = {
    "Content-Type": "application/json",
    "User-Agent": `networkbase-cli/${CLI_VERSION} (${process.platform}-${process.arch})`,
    "x-extension-version": CLI_VERSION,
    "x-editor-host": "cli",
    "x-editor-name": "NetworkBase CLI",
    "x-editor-platform": `${process.platform}-${process.arch}`,
    "x-editor-version": process.version,
    ...(options.headers || {}),
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const timeoutMs = options.timeoutMs || 10000;
  let response;
  try {
    response = await fetch(`${baseUrl}${endpoint}`, {
      method: options.method || "GET",
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (fetchErr) {
    if (baseUrl !== "http://localhost:3000" && !options.apiUrl) {
      response = await fetch(`http://localhost:3000${endpoint}`, {
        method: options.method || "GET",
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } else {
      throw fetchErr;
    }
  }

  if (response.status === 304) {
    return { notModified: true, etag: response.headers.get("etag") };
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok || (payload && payload.success === false)) {
    const errMsg = payload?.message || payload?.error || `HTTP ${response.status} from ${endpoint}`;
    const err = new Error(errMsg);
    err.status = response.status;
    err.errorCode = payload?.errorCode;
    err.details = payload;
    throw err;
  }

  return payload?.data !== undefined ? payload.data : payload;
}

function detectMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_MAP[ext] || "application/octet-stream";
}

function computeFileSha256(filePath) {
  const buf = fs.readFileSync(filePath);
  const hash = crypto.createHash("sha256").update(buf).digest("hex");
  return { hash, size: buf.length, buffer: buf };
}

function scanFileForSecrets(relativePath, buffer) {
  const baseName = path.basename(relativePath);
  if (baseName === ".env" || (baseName.startsWith(".env.") && !baseName.endsWith(".example"))) {
    return `Environment secret file (${baseName}) should not be pushed directly`;
  }
  if (buffer.length > 2 * 1024 * 1024) return null;
  const text = buffer.toString("utf8");
  for (const rule of SECRET_PATTERNS) {
    if (rule.regex.test(text)) {
      return `Detected potential ${rule.name}`;
    }
  }
  return null;
}

function collectLocalFiles(targetPaths, cwd = process.cwd(), scopeDir = null, { maxFiles = 2000, maxDepth = 8 } = {}) {
  const files = [];
  const mirrorDir = getLocalMirrorDir(cwd);
  const rootDir = scopeDir ? path.resolve(cwd, scopeDir) : cwd;

  // Never recursively walk the entire OS home directory when no explicit path/scope is given
  if (targetPaths.length === 0 && !scopeDir && path.resolve(cwd) === path.resolve(os.homedir())) {
    if (fs.existsSync(mirrorDir)) {
      return collectLocalFiles([], cwd, mirrorDir, { maxFiles, maxDepth });
    }
    return files;
  }

  function walk(currentPath, depth = 0) {
    if (files.length >= maxFiles || depth > maxDepth) return;
    let stat;
    try {
      stat = fs.statSync(currentPath);
    } catch {
      return;
    }
    if (stat.isDirectory()) {
      const base = path.basename(currentPath);
      const isInsideMirror = currentPath === mirrorDir || currentPath.startsWith(mirrorDir + path.sep);
      if (depth > 0 && !isInsideMirror && (IGNORED_DIRS.has(base) || base.startsWith("."))) return;
      let entries;
      try {
        entries = fs.readdirSync(currentPath);
      } catch {
        return;
      }
      for (const entry of entries) {
        if (files.length >= maxFiles) break;
        walk(path.join(currentPath, entry), depth + 1);
      }
    } else if (stat.isFile()) {
      const baseName = path.basename(currentPath);
      if (targetPaths.length === 0 && baseName.startsWith(".") && baseName !== ".env.example") {
        return;
      }
      if (currentPath.startsWith(mirrorDir + path.sep)) {
        const mirrorRel = path.relative(mirrorDir, currentPath).replace(/\\/g, "/");
        files.push({ absPath: currentPath, relativePath: mirrorRel, fromMirror: true });
        return;
      }
      const rel = path.relative(cwd, currentPath).replace(/\\/g, "/");
      if (rel.startsWith(".networkbase/") || rel.startsWith(".git/")) return;
      files.push({ absPath: currentPath, relativePath: rel });
    }
  }

  if (targetPaths.length > 0) {
    const manifest = getLocalManifest(cwd);
    const manifestFiles = manifest?.files || {};
    for (const p of targetPaths) {
      const cleanRel = p.replace(/^\/+/, "");
      const mirrorCandidate = path.join(mirrorDir, cleanRel);
      const cwdCandidate = path.resolve(cwd, p);

      // Prefer .networkbase/mirror/<p> if it exists and has uncommitted edits relative to manifest, or if cwdCandidate doesn't exist
      if (fs.existsSync(mirrorCandidate) && fs.statSync(mirrorCandidate).isFile()) {
        const normKey = `/${cleanRel}`;
        const mirrorHash = computeFileSha256(mirrorCandidate).hash.toLowerCase();
        const manifestHash = (manifestFiles[normKey]?.contentHash || "").toLowerCase();
        if (!fs.existsSync(cwdCandidate) || (manifestHash && mirrorHash !== manifestHash)) {
          walk(mirrorCandidate, 0);
          continue;
        }
      }
      if (fs.existsSync(cwdCandidate)) {
        walk(cwdCandidate, 0);
      } else if (fs.existsSync(mirrorCandidate)) {
        walk(mirrorCandidate, 0);
      }
    }
  } else if (fs.existsSync(rootDir)) {
    // If .networkbase/mirror/ has mirrored workspace files, scope default push/sync to the mirror
    if (rootDir === cwd && fs.existsSync(mirrorDir)) {
      walk(mirrorDir, 0);
      if (files.length > 0) {
        return files;
      }
    }
    walk(rootDir, 0);
  }
  return files;
}

function inferActiveTaskId(flags, cwd = process.cwd()) {
  if ((typeof flags.task === "string" || typeof flags.task === "number") && String(flags.task).trim()) {
    return resolveTaskIdentifier(flags.task, cwd);
  }
  const state = getLocalState(cwd);
  if (state.activeTaskId) return state.activeTaskId;

  try {
    const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString("utf8")
      .trim();
    const uuidMatch = branch.match(
      /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i,
    );
    if (uuidMatch) return uuidMatch[0];
  } catch {}
  return null;
}

function resolveRoleFromFlags(flags) {
  if (flags.deliverable) return "deliverable";
  if (flags.draft || flags.working) return "working";
  if (flags.reference || flags.spec) return "reference";
  if (typeof flags.role === "string" && ["deliverable", "working", "reference"].includes(flags.role)) {
    return flags.role;
  }
  return null;
}

// ============================================================================
// NETWORKBASE TUI DESIGN SYSTEM (Claude Code / Clack Grade Interactive Engine)
// ============================================================================

const USE_COLOR = Boolean(
  process.stdout.isTTY &&
    !process.env.NO_COLOR &&
    process.env.FORCE_COLOR !== "0" &&
    process.env.TERM !== "dumb",
);

const c = {
  reset: USE_COLOR ? "\x1b[0m" : "",
  bold: USE_COLOR ? "\x1b[1m" : "",
  dim: USE_COLOR ? "\x1b[38;2;82;82;91m" : "",
  muted: USE_COLOR ? "\x1b[38;2;161;161;170m" : "",
  ink: USE_COLOR ? "\x1b[38;2;250;250;250m" : "",
  accent: USE_COLOR ? "\x1b[38;2;56;189;248m" : "",
  emerald: USE_COLOR ? "\x1b[38;2;52;211;153m" : "",
  amber: USE_COLOR ? "\x1b[38;2;251;191;36m" : "",
  red: USE_COLOR ? "\x1b[38;2;248;113;113m" : "",
};

const RAIL = `${c.dim}│${c.reset}`;
const RAIL_END = `${c.dim}└${c.reset}`;
const STEP_ACTIVE = `${c.accent}◆${c.reset}`;
const STEP_DONE = `${c.emerald}◇${c.reset}`;
const STEP_WARN = `${c.amber}▲${c.reset}`;
const STEP_ERR = `${c.red}✖${c.reset}`;
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

// Always restore cursor visibility on exit
process.on("exit", () => {
  if (process.stdout.isTTY) {
    process.stdout.write("\x1b[?25h");
  }
});

function stripAnsi(str) {
  return String(str).replace(/\x1b\[[0-9;]*m/g, "");
}

function fitTerminalLine(str) {
  const cols = Math.max(50, (process.stdout.columns || 80) - 2);
  const plain = stripAnsi(str);
  if (plain.length <= cols) return str;
  // Truncate visible characters while preserving ANSI resets
  let visible = 0;
  let out = "";
  let i = 0;
  while (i < str.length && visible < cols - 1) {
    if (str[i] === "\x1b") {
      const m = str.slice(i).match(/^\x1b\[[0-9;]*m/);
      if (m) {
        out += m[0];
        i += m[0].length;
        continue;
      }
    }
    out += str[i];
    visible++;
    i++;
  }
  return `${out}…${c.reset}`;
}

function formatBytes(bytes) {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatStatusBadge(status) {
  const s = String(status || "").toLowerCase();
  if (s === "in_progress") return `${c.accent}[IN PROGRESS]${c.reset}`;
  if (s === "done" || s === "completed") return `${c.emerald}[DONE]${c.reset}`;
  if (s === "todo") return `${c.muted}[TODO]${c.reset}`;
  if (s === "blocked") return `${c.red}[BLOCKED]${c.reset}`;
  if (s === "deliverable") return `${c.emerald}[Final file]${c.reset}`;
  if (s === "working") return `${c.amber}[Draft file]${c.reset}`;
  if (s === "reference") return `${c.accent}[Reference]${c.reset}`;
  return `${c.muted}[${String(status).toUpperCase()}]${c.reset}`;
}

function formatPriorityBadge(priority) {
  const p = String(priority || "medium").toLowerCase();
  if (p === "urgent") return `${c.red}[URGENT]${c.reset}`;
  if (p === "high") return `${c.amber}[HIGH]${c.reset}`;
  if (p === "low") return `${c.dim}[LOW]${c.reset}`;
  return `${c.muted}[MEDIUM]${c.reset}`;
}

function renderBrandHeader({ subtitle = "High-EQ Workspace, Task & File Sync", contextRows = [] } = {}) {
  const width = Math.min(68, Math.max(54, (process.stdout.columns || 80) - 6));
  const inner = width - 2;
  const top = `${c.dim}╭${"─".repeat(inner)}╮${c.reset}`;
  const divider = `${c.dim}├${"─".repeat(inner)}┤${c.reset}`;
  const bottom = `${c.dim}╰${"─".repeat(inner)}╯${c.reset}`;

  const leftBrand = `  ${c.ink}●${c.reset} ${c.bold}${c.ink}NetworkBase${c.reset}`;
  const rightVer = `${c.muted}CLI v${CLI_VERSION}${c.reset}  `;
  const padLen = Math.max(1, inner - stripAnsi(leftBrand).length - stripAnsi(rightVer).length);
  const titleRow = `${c.dim}│${c.reset}${leftBrand}${" ".repeat(padLen)}${rightVer}${c.dim}│${c.reset}`;

  const subText = `  ${c.muted}${subtitle}${c.reset}`;
  const subPad = Math.max(1, inner - stripAnsi(subText).length);
  const subRow = `${c.dim}│${c.reset}${subText}${" ".repeat(subPad)}${c.dim}│${c.reset}`;

  const lines = ["", top, titleRow, subRow];

  if (contextRows.length > 0) {
    lines.push(divider);
    for (const row of contextRows) {
      const label = row.label.padEnd(13);
      const content = `  ${c.muted}${label}${c.reset}${row.value}`;
      const visLen = stripAnsi(content).length;
      const clipped =
        visLen > inner - 1
          ? content.slice(0, content.length - (visLen - (inner - 2))) + "…" + c.reset
          : content;
      const rowPad = Math.max(0, inner - stripAnsi(clipped).length);
      lines.push(`${c.dim}│${c.reset}${clipped}${" ".repeat(rowPad)}${c.dim}│${c.reset}`);
    }
  }

  lines.push(bottom);
  process.stdout.write(lines.join("\n") + "\n");
}

function createLiveRenderer() {
  let renderedLineCount = 0;

  return {
    render(lines) {
      if (renderedLineCount > 0) {
        process.stdout.write(`\x1b[${renderedLineCount}A`);
        for (let i = 0; i < renderedLineCount; i++) {
          process.stdout.write("\x1b[2K\x1b[1B");
        }
        process.stdout.write(`\x1b[${renderedLineCount}A`);
      }
      const safeLines = lines.map((l) => fitTerminalLine(l));
      process.stdout.write(safeLines.join("\n") + "\n");
      renderedLineCount = safeLines.length;
    },
    clear() {
      if (renderedLineCount > 0) {
        process.stdout.write(`\x1b[${renderedLineCount}A`);
        for (let i = 0; i < renderedLineCount; i++) {
          process.stdout.write("\x1b[2K\x1b[1B");
        }
        process.stdout.write(`\x1b[${renderedLineCount}A`);
        renderedLineCount = 0;
      }
    },
  };
}

async function withSpinner(label, asyncFn, { silent = false } = {}) {
  if (silent || !process.stdout.isTTY) {
    return asyncFn();
  }
  const live = createLiveRenderer();
  let frameIdx = 0;
  const startedAt = Date.now();
  process.stdout.write("\x1b[?25l");

  const renderFrame = () => {
    const elapsed = Math.floor((Date.now() - startedAt) / 1000);
    const timeSuffix = elapsed >= 2 ? ` ${c.dim}(${elapsed}s)${c.reset}` : "";
    const spinner = `${c.accent}${SPINNER_FRAMES[frameIdx % SPINNER_FRAMES.length]}${c.reset}`;
    live.render([RAIL, `${ spinner }  ${c.ink}${label}${c.reset}${timeSuffix}`]);
    frameIdx++;
  };

  renderFrame();
  const interval = setInterval(renderFrame, 80);

  try {
    const res = await asyncFn();
    clearInterval(interval);
    live.clear();
    process.stdout.write("\x1b[?25h");
    return res;
  } catch (err) {
    clearInterval(interval);
    live.clear();
    process.stdout.write("\x1b[?25h");
    throw err;
  }
}

function printStepDone(label, value) {
  console.log(`${RAIL}`);
  console.log(`${STEP_DONE}  ${c.muted}${label}${c.reset} ${c.dim}·${c.reset} ${c.bold}${c.ink}${value}${c.reset}`);
}

/**
 * Arrow-Key Interactive Single-Select Menu with Live Search Filter & In-Place Collapse
 */
async function tuiSelect({
  title,
  stepLabel = title,
  items,
  initialIndex = 0,
  searchable = false,
  allowCancel = false,
}) {
  if (!items || items.length === 0) return null;
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return items[Math.min(initialIndex, items.length - 1)].value;
  }

  const live = createLiveRenderer();
  let cursor = Math.max(0, Math.min(initialIndex, items.length - 1));
  let filterQuery = "";
  const maxVisible = 7;

  function getFilteredItems() {
    if (!filterQuery) return items;
    const q = filterQuery.toLowerCase();
    return items.filter(
      (item) =>
        String(item.label || "").toLowerCase().includes(q) ||
        String(item.hint || "").toLowerCase().includes(q) ||
        String(item.badge || "").toLowerCase().includes(q),
    );
  }

  function renderMenu() {
    const filtered = getFilteredItems();
    if (cursor >= filtered.length) {
      cursor = Math.max(0, filtered.length - 1);
    }

    const lines = [RAIL, `${STEP_ACTIVE}  ${c.bold}${c.ink}${title}${c.reset}`];

    if (searchable || filterQuery.length > 0) {
      const filterDisplay = filterQuery
        ? `${c.accent}${filterQuery}${c.reset}`
        : `${c.dim}type to filter (${items.length} items)${c.reset}`;
      lines.push(`${RAIL}  ${c.muted}Filter:${c.reset} ${filterDisplay}`);
    }

    if (filtered.length === 0) {
      lines.push(`${RAIL}  ${c.amber}No matches for "${filterQuery}" (press Backspace)${c.reset}`);
    } else {
      let start = 0;
      if (filtered.length > maxVisible) {
        start = Math.max(
          0,
          Math.min(cursor - Math.floor(maxVisible / 2), filtered.length - maxVisible),
        );
      }
      const end = Math.min(filtered.length, start + maxVisible);

      if (start > 0) {
        lines.push(`${RAIL}    ${c.dim}↑ ${start} more above${c.reset}`);
      }

      for (let i = start; i < end; i++) {
        const item = filtered[i];
        const isSelected = i === cursor;
        const pointer = isSelected ? `${c.accent}❯ ●${c.reset}` : `  ${c.dim}○${c.reset}`;
        const labelText = isSelected
          ? `${c.bold}${c.ink}${item.label}${c.reset}`
          : `${c.muted}${item.label}${c.reset}`;
        const hintText = item.hint ? `  ${c.dim}${item.hint}${c.reset}` : "";
        const badgeText = item.badge ? `  ${item.badge}` : "";
        lines.push(`${RAIL}  ${pointer} ${labelText}${hintText}${badgeText}`);
        if (isSelected && item.description) {
          lines.push(`${RAIL}      ${c.dim}${item.description}${c.reset}`);
        }
      }

      if (end < filtered.length) {
        lines.push(`${RAIL}    ${c.dim}↓ ${filtered.length - end} more below${c.reset}`);
      }
    }

    const helpHint = searchable
      ? `↑/↓ move · Enter select · type to filter${allowCancel ? " · Esc skip" : " · Ctrl+C cancel"}`
      : `↑/↓ move · Enter select${allowCancel ? " · Esc skip" : " · Ctrl+C cancel"}`;
    lines.push(`${RAIL_END}  ${c.dim}${helpHint}${c.reset}`);
    live.render(lines);
  }

  return new Promise((resolve) => {
    readline.emitKeypressEvents(process.stdin);
    const wasRaw = process.stdin.isRaw;
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdout.write("\x1b[?25l");

    renderMenu();

    function cleanup() {
      process.stdin.removeListener("keypress", onKeypress);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(Boolean(wasRaw));
      }
      process.stdin.pause();
      process.stdout.write("\x1b[?25h");
    }

    function onKeypress(str, key = {}) {
      if (key.ctrl && key.name === "c") {
        live.clear();
        cleanup();
        console.log(`${RAIL_END}  ${STEP_ERR} ${c.muted}Cancelled.${c.reset}\n`);
        process.exit(130);
      }

      if (key.name === "escape") {
        if (filterQuery.length > 0) {
          filterQuery = "";
          cursor = 0;
          renderMenu();
          return;
        }
        if (allowCancel) {
          live.clear();
          cleanup();
          printStepDone(stepLabel, "Skipped");
          resolve(null);
          return;
        }
      }

      const filtered = getFilteredItems();

      if (key.name === "up" || (!searchable && !filterQuery && key.name === "k")) {
        if (filtered.length > 0) {
          cursor = (cursor - 1 + filtered.length) % filtered.length;
        }
        renderMenu();
        return;
      }

      if (key.name === "down" || (!searchable && !filterQuery && key.name === "j")) {
        if (filtered.length > 0) {
          cursor = (cursor + 1) % filtered.length;
        }
        renderMenu();
        return;
      }

      if (key.name === "return" || key.name === "enter") {
        const chosen = filtered[cursor];
        if (!chosen) return;
        live.clear();
        cleanup();
        printStepDone(stepLabel, chosen.summaryLabel || chosen.label);
        resolve(chosen.value);
        return;
      }

      if (key.name === "backspace") {
        if (filterQuery.length > 0) {
          filterQuery = filterQuery.slice(0, -1);
          cursor = 0;
          renderMenu();
        }
        return;
      }

      // Number shortcut 1..9 when not filtering
      if (!searchable && !filterQuery && str && /^[1-9]$/.test(str)) {
        const idx = parseInt(str, 10) - 1;
        if (idx >= 0 && idx < filtered.length) {
          cursor = idx;
          renderMenu();
        }
        return;
      }

      // Live search typing
      if (str && !key.ctrl && !key.meta && str.length === 1 && str >= " " && str <= "~") {
        if (searchable || items.length > 4) {
          filterQuery += str;
          cursor = 0;
          renderMenu();
        }
      }
    }

    process.stdin.on("keypress", onKeypress);
  });
}

/**
 * Arrow-Key Interactive Multi-Select Checkbox Menu (Space to toggle, Enter to confirm)
 */
async function tuiMultiSelect({ title, stepLabel = title, items }) {
  if (!items || items.length === 0) return [];
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return items.map((i) => i.value);
  }

  const live = createLiveRenderer();
  let cursor = 0;
  const checked = new Set(items.map((_, idx) => idx));
  const maxVisible = 8;

  function renderMenu(validationError = "") {
    const lines = [
      RAIL,
      `${STEP_ACTIVE}  ${c.bold}${c.ink}${title}${c.reset} ${c.muted}(${checked.size}/${items.length} selected)${c.reset}`,
    ];

    let start = 0;
    if (items.length > maxVisible) {
      start = Math.max(0, Math.min(cursor - Math.floor(maxVisible / 2), items.length - maxVisible));
    }
    const end = Math.min(items.length, start + maxVisible);

    if (start > 0) {
      lines.push(`${RAIL}    ${c.dim}↑ ${start} more above${c.reset}`);
    }

    for (let i = start; i < end; i++) {
      const item = items[i];
      const isCur = i === cursor;
      const isChecked = checked.has(i);
      const pointer = isCur ? `${c.accent}❯${c.reset}` : " ";
      const box = isChecked ? `${c.emerald}◼${c.reset}` : `${c.dim}◻${c.reset}`;
      const labelText = isCur
        ? `${c.bold}${c.ink}${item.label}${c.reset}`
        : isChecked
          ? `${c.ink}${item.label}${c.reset}`
          : `${c.muted}${item.label}${c.reset}`;
      const badgeText = item.badge ? `  ${item.badge}` : "";
      const hintText = item.hint ? `  ${c.dim}${item.hint}${c.reset}` : "";
      lines.push(`${RAIL}  ${pointer} ${box} ${labelText}${badgeText}${hintText}`);
    }

    if (end < items.length) {
      lines.push(`${RAIL}    ${c.dim}↓ ${items.length - end} more below${c.reset}`);
    }

    if (validationError) {
      lines.push(`${RAIL}  ${STEP_WARN} ${c.amber}${validationError}${c.reset}`);
    }

    lines.push(
      `${RAIL_END}  ${c.dim}↑/↓ move · Space toggle · a toggle all · Enter confirm${c.reset}`,
    );
    live.render(lines);
  }

  return new Promise((resolve) => {
    readline.emitKeypressEvents(process.stdin);
    const wasRaw = process.stdin.isRaw;
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdout.write("\x1b[?25l");

    renderMenu();

    function cleanup() {
      process.stdin.removeListener("keypress", onKeypress);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(Boolean(wasRaw));
      }
      process.stdin.pause();
      process.stdout.write("\x1b[?25h");
    }

    function onKeypress(str, key = {}) {
      if (key.ctrl && key.name === "c") {
        live.clear();
        cleanup();
        console.log(`${RAIL_END}  ${STEP_ERR} ${c.muted}Cancelled.${c.reset}\n`);
        process.exit(130);
      }

      if (key.name === "up" || key.name === "k") {
        cursor = (cursor - 1 + items.length) % items.length;
        renderMenu();
        return;
      }

      if (key.name === "down" || key.name === "j") {
        cursor = (cursor + 1) % items.length;
        renderMenu();
        return;
      }

      if (key.name === "space") {
        if (checked.has(cursor)) checked.delete(cursor);
        else checked.add(cursor);
        renderMenu();
        return;
      }

      if (str === "a" || str === "A") {
        if (checked.size === items.length) {
          checked.clear();
        } else {
          items.forEach((_, idx) => checked.add(idx));
        }
        renderMenu();
        return;
      }

      if (key.name === "return" || key.name === "enter") {
        if (checked.size === 0) {
          renderMenu("Select at least 1 file with Spacebar before pressing Enter.");
          return;
        }
        const selectedValues = items.filter((_, idx) => checked.has(idx)).map((i) => i.value);
        live.clear();
        cleanup();
        printStepDone(stepLabel, `${selectedValues.length} file(s) selected`);
        resolve(selectedValues);
      }
    }

    process.stdin.on("keypress", onKeypress);
  });
}

/**
 * Arrow-Key Horizontal Yes/No Toggle
 */
async function tuiConfirm({
  title,
  stepLabel = title,
  yesLabel = "Yes",
  noLabel = "No",
  initialValue = true,
}) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return initialValue;
  }

  const live = createLiveRenderer();
  let value = Boolean(initialValue);

  function renderToggle() {
    const yesBtn = value
      ? `${c.accent}[ ● ${c.bold}${c.ink}${yesLabel}${c.reset}${c.accent} ]${c.reset}`
      : `  ${c.dim}○ ${noLabel ? c.muted : ""}${yesLabel}${c.reset}  `;
    const noBtn = !value
      ? `${c.accent}[ ● ${c.bold}${c.ink}${noLabel}${c.reset}${c.accent} ]${c.reset}`
      : `  ${c.dim}○ ${c.muted}${noLabel}${c.reset}  `;

    live.render([
      RAIL,
      `${STEP_ACTIVE}  ${c.bold}${c.ink}${title}${c.reset}`,
      `${RAIL}    ${yesBtn}    ${noBtn}`,
      `${RAIL_END}  ${c.dim}←/→ or y/n to toggle · Enter to confirm${c.reset}`,
    ]);
  }

  return new Promise((resolve) => {
    readline.emitKeypressEvents(process.stdin);
    const wasRaw = process.stdin.isRaw;
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdout.write("\x1b[?25l");

    renderToggle();

    function cleanup() {
      process.stdin.removeListener("keypress", onKeypress);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(Boolean(wasRaw));
      }
      process.stdin.pause();
      process.stdout.write("\x1b[?25h");
    }

    function onKeypress(str, key = {}) {
      if (key.ctrl && key.name === "c") {
        live.clear();
        cleanup();
        console.log(`${RAIL_END}  ${STEP_ERR} ${c.muted}Cancelled.${c.reset}\n`);
        process.exit(130);
      }

      if (key.name === "left" || key.name === "right" || key.name === "tab" || key.name === "h" || key.name === "l") {
        value = !value;
        renderToggle();
        return;
      }

      if (str === "y" || str === "Y") {
        value = true;
        renderToggle();
        return;
      }

      if (str === "n" || str === "N") {
        value = false;
        renderToggle();
        return;
      }

      if (key.name === "return" || key.name === "enter") {
        live.clear();
        cleanup();
        printStepDone(stepLabel, value ? yesLabel : noLabel);
        resolve(value);
      }
    }

    process.stdin.on("keypress", onKeypress);
  });
}

/**
 * Styled Inline Text / Token Input Along the Vertical Rail
 */
async function tuiTextInput({ title, stepLabel = title, hint = "", placeholder = "", mask = false }) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return promptLine(`${title}: `);
  }

  const live = createLiveRenderer();
  let val = "";

  function renderInput(errText = "") {
    const displayVal = val.length > 0
      ? mask
        ? `${val.slice(0, 10)}${"•".repeat(Math.min(24, Math.max(0, val.length - 10)))}`
        : val
      : `${c.dim}${placeholder}${c.reset}`;

    const lines = [RAIL, `${STEP_ACTIVE}  ${c.bold}${c.ink}${title}${c.reset}`];
    if (hint) {
      lines.push(`${RAIL}  ${c.muted}${hint}${c.reset}`);
    }
    lines.push(`${RAIL}  ${c.accent}❯${c.reset} ${displayVal}${c.accent}█${c.reset}`);
    if (errText) {
      lines.push(`${RAIL}  ${STEP_WARN} ${c.amber}${errText}${c.reset}`);
    }
    lines.push(`${RAIL_END}  ${c.dim}Paste or type value · Enter to submit · Ctrl+C to cancel${c.reset}`);
    live.render(lines);
  }

  return new Promise((resolve) => {
    readline.emitKeypressEvents(process.stdin);
    const wasRaw = process.stdin.isRaw;
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdout.write("\x1b[?25l");

    renderInput();

    function cleanup() {
      process.stdin.removeListener("keypress", onKeypress);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(Boolean(wasRaw));
      }
      process.stdin.pause();
      process.stdout.write("\x1b[?25h");
    }

    function onKeypress(str, key = {}) {
      if (key.ctrl && key.name === "c") {
        live.clear();
        cleanup();
        console.log(`${RAIL_END}  ${STEP_ERR} ${c.muted}Cancelled.${c.reset}\n`);
        process.exit(130);
      }

      if (key.name === "return" || key.name === "enter") {
        const trimmed = val.trim();
        if (!trimmed) {
          renderInput("Please enter a value before pressing Enter.");
          return;
        }
        live.clear();
        cleanup();
        const summary = mask && trimmed.length > 12 ? `${trimmed.slice(0, 11)}…` : trimmed;
        printStepDone(stepLabel, summary);
        resolve(trimmed);
        return;
      }

      if (key.name === "backspace") {
        val = val.slice(0, -1);
        renderInput();
        return;
      }

      if (str && !key.ctrl && !key.meta) {
        // Support multi-character paste bursts cleanly
        const clean = str.replace(/[\r\n]+/g, "");
        if (clean) {
          val += clean;
          renderInput();
        }
      }
    }

    process.stdin.on("keypress", onKeypress);
  });
}

async function resolveBestApiUrl(explicitUrl) {
  if (explicitUrl) return explicitUrl.replace(/\/+$/, "");
  if (process.env.NETWORKBASE_API_URL) return process.env.NETWORKBASE_API_URL.replace(/\/+$/, "");
  const localCfg = getLocalConfig();
  if (localCfg?.apiUrl) return localCfg.apiUrl.replace(/\/+$/, "");
  const creds = getCredentials();
  if (creds?.apiUrl) return creds.apiUrl.replace(/\/+$/, "");

  // Probe local development server (http://localhost:3000) before defaulting to production
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 600);
    const res = await fetch("http://localhost:3000/api/v1/extension/session", {
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.status === 200 || res.status === 401) {
      return "http://localhost:3000";
    }
  } catch {
    // Local dev server not running; fall back to production URL
  }
  return DEFAULT_API_URL.replace(/\/+$/, "");
}

function openBrowserUrl(url) {
  try {
    if (process.platform === "darwin") {
      execFileSync("open", [url], { stdio: "ignore" });
      return true;
    }
    if (process.platform === "win32") {
      execFileSync("cmd", ["/c", "start", "", url], { stdio: "ignore" });
      return true;
    }
    execFileSync("xdg-open", [url], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function loginWithBrowser(apiUrl, flags = {}) {
  const state = crypto.randomBytes(24).toString("hex");

  return new Promise((resolve, reject) => {
    let timeoutHandle;
    const server = http.createServer(async (req, res) => {
      try {
        const reqUrl = new URL(req.url || "/", "http://127.0.0.1");
        if (reqUrl.pathname !== "/auth-callback") {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("Not found");
          return;
        }

        const error = reqUrl.searchParams.get("error");
        const message = reqUrl.searchParams.get("message");
        const code = reqUrl.searchParams.get("code");
        const returnedState = reqUrl.searchParams.get("state");

        if (error) {
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end(`<!doctype html><html><body style="font-family:system-ui,sans-serif;padding:40px;text-align:center;">
            <h2>Authorization Cancelled</h2>
            <p>${message || error}</p>
            <p>You can close this window and return to your terminal.</p>
          </body></html>`);
          clearTimeout(timeoutHandle);
          server.close();
          reject(new Error(message || `Browser authorization failed: ${error}`));
          return;
        }

        if (!code || returnedState !== state) {
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end(`<!doctype html><html><body style="font-family:system-ui,sans-serif;padding:40px;text-align:center;">
            <h2>Invalid Callback State</h2>
            <p>Please restart sign-in from your terminal.</p>
          </body></html>`);
          clearTimeout(timeoutHandle);
          server.close();
          reject(new Error("Invalid state or missing authorization code from browser callback."));
          return;
        }

        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<!doctype html><html><body style="font-family:system-ui,-apple-system,sans-serif;background:#0a0a0a;color:#fafafa;padding:64px 24px;text-align:center;">
          <div style="max-width:420px;margin:0 auto;border:1px solid #262626;border-radius:12px;padding:32px;background:#121212;">
            <div style="font-size:28px;margin-bottom:12px;">✔</div>
            <h2 style="margin:0 0 8px;font-size:18px;font-weight:600;">NetworkBase CLI Connected</h2>
            <p style="margin:0;color:#a1a1aa;font-size:14px;line-height:1.5;">Your terminal is now authenticated. You can close this tab and return to your terminal.</p>
          </div>
        </body></html>`);

        clearTimeout(timeoutHandle);
        server.close();

        const exchanged = await apiRequest("/api/v1/extension/auth-code", {
          method: "POST",
          apiUrl,
          body: { code, state },
        });

        const token = exchanged.token;
        const sessionInfo = await apiRequest("/api/v1/extension/session", {
          apiUrl,
          token,
        });

        saveCredentials({
          token,
          apiUrl,
          sessionId: sessionInfo.sessionId,
          tokenType: sessionInfo.tokenType || "device",
          user: sessionInfo.user || null,
        });

        resolve({
          authenticated: true,
          method: "browser",
          apiUrl,
          sessionId: sessionInfo.sessionId,
          tokenType: sessionInfo.tokenType || "device",
          user: sessionInfo.user,
        });
      } catch (err) {
        clearTimeout(timeoutHandle);
        server.close();
        reject(err);
      }
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      const callbackUrl = `http://127.0.0.1:${port}/auth-callback`;
      const authorizeUrl = `${apiUrl}/authorize?callback=${encodeURIComponent(callbackUrl)}&state=${encodeURIComponent(state)}`;

      const opened = openBrowserUrl(authorizeUrl);
      if (!flags.json) {
        console.log(`\n→ ${opened ? "Opened" : "Open"} your browser to approve NetworkBase CLI access:`);
        console.log(`  ${authorizeUrl}`);
        console.log(`→ Waiting for approval in browser... (Press Ctrl+C to cancel)\n`);
      }

      timeoutHandle = setTimeout(() => {
        server.close();
        reject(
          new Error(
            `Browser login timed out after 120s. Run \`nb auth login --token <nb_pat_...>\` or open: ${authorizeUrl}`,
          ),
        );
      }, 120000);
    });
  });
}

async function loginWithToken(rawToken, apiUrl, explicitUrl = null) {
  const token = rawToken ? rawToken.trim() : "";
  if (!token || (!token.startsWith("nb_dev_") && !token.startsWith("nb_pat_"))) {
    throw new Error("A valid `nb_dev_...` or `nb_pat_...` token is required.");
  }

  let resolvedUrl = apiUrl;
  let sessionInfo;
  try {
    sessionInfo = await apiRequest("/api/v1/extension/session", {
      apiUrl: resolvedUrl,
      token,
    });
  } catch (err) {
    if (!explicitUrl && resolvedUrl !== "http://localhost:3000") {
      resolvedUrl = "http://localhost:3000";
      sessionInfo = await apiRequest("/api/v1/extension/session", {
        apiUrl: resolvedUrl,
        token,
      });
    } else {
      throw err;
    }
  }

  if (!sessionInfo.active && !explicitUrl && resolvedUrl !== "http://localhost:3000") {
    try {
      const localInfo = await apiRequest("/api/v1/extension/session", {
        apiUrl: "http://localhost:3000",
        token,
      });
      if (localInfo?.active) {
        resolvedUrl = "http://localhost:3000";
        sessionInfo = localInfo;
      }
    } catch {
      // Ignore fallback failure
    }
  }

  if (!sessionInfo.active) {
    throw new Error("This token is expired or has been revoked.");
  }

  saveCredentials({
    token,
    apiUrl: resolvedUrl,
    sessionId: sessionInfo.sessionId,
    tokenType: sessionInfo.tokenType || (token.startsWith("nb_pat_") ? "pat" : "device"),
    user: sessionInfo.user || null,
  });

  return {
    authenticated: true,
    method: "token",
    apiUrl: resolvedUrl,
    sessionId: sessionInfo.sessionId,
    tokenType: sessionInfo.tokenType || (token.startsWith("nb_pat_") ? "pat" : "device"),
    user: sessionInfo.user,
  };
}

async function promptLine(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function performInteractiveOrFlagLogin(flags, positionalToken = null) {
  const explicitUrl =
    typeof flags["api-url"] === "string"
      ? flags["api-url"]
      : typeof flags.url === "string"
        ? flags.url
        : null;
  const apiUrl = await resolveBestApiUrl(explicitUrl);
  const directToken = typeof flags.token === "string" ? flags.token.trim() : positionalToken?.trim();

  if (directToken) {
    return withSpinner(
      `Verifying token against ${apiUrl}…`,
      () => loginWithToken(directToken, apiUrl, explicitUrl),
      { silent: Boolean(flags.json) },
    );
  }

  if (flags.web || flags.browser || !process.stdin.isTTY) {
    return loginWithBrowser(apiUrl, flags);
  }

  const method = await tuiSelect({
    title: `Step 1 of 3 · Authenticate with NetworkBase (${apiUrl})`,
    stepLabel: "Authentication Method",
    items: [
      {
        label: "Login with Web Browser",
        value: "browser",
        badge: `${c.emerald}[Recommended]${c.reset}`,
        description: "Opens /authorize in your browser for 1-click Approve (zero copy-pasting)",
      },
      {
        label: "Paste Personal Access Token",
        value: "token",
        badge: `${c.muted}[nb_pat_ / nb_dev_]${c.reset}`,
        description: `Paste a token generated in ${apiUrl}/settings?tab=integrations`,
      },
    ],
  });

  if (method === "token") {
    const entered = await tuiTextInput({
      title: "Paste your NetworkBase Access Token",
      stepLabel: "Token",
      hint: `Generate at ${apiUrl}/settings?tab=integrations#settings-integrations-pat`,
      placeholder: "nb_pat_... or nb_dev_...",
      mask: true,
    });
    return withSpinner(
      `Verifying token with ${apiUrl}…`,
      () => loginWithToken(entered, apiUrl, explicitUrl),
      { silent: Boolean(flags.json) },
    );
  }

  return loginWithBrowser(apiUrl, flags);
}

// ============================================================================
// COMMAND HANDLERS
// ============================================================================

async function handleAuth(sub, positional, flags) {
  if (!sub || sub === "login") {
    if (!flags.json && process.stdout.isTTY) {
      renderBrandHeader({ subtitle: "Account Authentication & Device Session" });
    }
    const res = await performInteractiveOrFlagLogin(flags, positional[0]);
    outputResult(res, flags, (out) => {
      const identity = out.user?.username
        ? `@${out.user.username}`
        : out.user?.email || out.sessionId;
      console.log(`${RAIL}`);
      console.log(
        `${c.dim}╰─${c.reset} ${c.emerald}✔${c.reset} Signed in as ${c.bold}${c.ink}${identity}${c.reset} ${c.muted}(${out.tokenType || "device"} session · ${out.apiUrl})${c.reset}\n`,
      );
    });
    return;
  }

  if (sub === "logout") {
    const creds = getCredentials();
    if (creds?.token) {
      await apiRequest("/api/v1/extension/session", { method: "POST" }).catch(() => {});
    }
    if (fs.existsSync(GLOBAL_CREDENTIALS_PATH)) {
      fs.unlinkSync(GLOBAL_CREDENTIALS_PATH);
    }
    outputResult({ loggedOut: true }, flags, () => {
      console.log(`\n${c.emerald}✔${c.reset} Signed out and revoked local NetworkBase credentials.\n`);
    });
    return;
  }

  if (sub === "whoami" || sub === "status") {
    await handleStatus(flags);
    return;
  }

  if (sub === "setup-git") {
    const creds = getCredentials();
    const apiUrl = creds?.apiUrl || DEFAULT_API_URL;
    execFileSync("git", [
      "config",
      "--global",
      `credential.${apiUrl}.helper`,
      "!nb auth git-credential",
    ]);
    outputResult({ configured: true, apiUrl }, flags, () => {
      console.log(`\n${c.emerald}✔${c.reset} Configured Git HTTPS credential helper for ${apiUrl}\n`);
    });
    return;
  }

  if (sub === "git-credential") {
    const creds = getCredentials();
    if (creds?.token) {
      process.stdout.write(`username=token\npassword=${creds.token}\n\n`);
    }
    return;
  }

  throw new Error(`Unknown auth subcommand: ${sub}. Available: login, logout, whoami, setup-git`);
}

async function handleInit(positional, flags, { skipHeader = false } = {}) {
  const requestedId = typeof flags.workspace === "string" ? flags.workspace : positional[0];
  const requestedTaskId = typeof flags.task === "string" ? flags.task : null;
  const explicitUrl =
    typeof flags["api-url"] === "string"
      ? flags["api-url"]
      : typeof flags.url === "string"
        ? flags.url
        : null;

  if (!flags.json && !skipHeader) {
    renderBrandHeader({ subtitle: "Interactive Workspace & Sprint Task Setup" });
  }

  // Step 1: Check or Perform Authentication
  let creds = getCredentials();
  let apiUrl = await resolveBestApiUrl(explicitUrl);
  let activeSession = null;

  if (creds?.token && !flags.reauth) {
    try {
      const check = await withSpinner(
        "Verifying active session…",
        () =>
          apiRequest("/api/v1/extension/session", {
            apiUrl: explicitUrl ? apiUrl : creds.apiUrl || apiUrl,
            token: creds.token,
          }),
        { silent: Boolean(flags.json) },
      );
      if (check?.active) {
        activeSession = check;
        apiUrl = (explicitUrl ? apiUrl : creds.apiUrl || apiUrl).replace(/\/+$/, "");
      }
    } catch {
      activeSession = null;
    }
  }

  if (!activeSession) {
    const loginRes = await performInteractiveOrFlagLogin(flags);
    apiUrl = loginRes.apiUrl;
    creds = getCredentials();
    if (!flags.json) {
      const identity = loginRes.user?.username
        ? `@${loginRes.user.username}`
        : loginRes.user?.email || loginRes.sessionId;
      printStepDone("Authenticated", `${identity} (${apiUrl})`);
    }
  } else if (!flags.json) {
    const identity = activeSession.user?.username
      ? `@${activeSession.user.username}`
      : activeSession.user?.email || activeSession.sessionId;
    printStepDone("Authenticated", `${identity} (${apiUrl})`);
  }

  // Step 2: Workspace Selection & Binding
  const { workspaces } = await withSpinner(
    "Loading accessible workspaces…",
    () => apiRequest("/api/v1/extension/workspaces", { apiUrl }),
    { silent: Boolean(flags.json) },
  );

  if (!workspaces || workspaces.length === 0) {
    throw new Error("No accessible workspaces found for your account.");
  }

  const currentLinkedId = getLocalConfig()?.projectId;
  let chosen = null;

  if (requestedId) {
    chosen =
      workspaces.find((w) => w.id === requestedId || w.slug === requestedId) || {
        id: requestedId,
        title: requestedId,
        slug: requestedId,
      };
    if (!flags.json) {
      printStepDone("Workspace", `${chosen.title} (${chosen.slug || chosen.id})`);
    }
  } else if (!process.stdin.isTTY || flags.json) {
    chosen = workspaces[0];
  } else {
    const defaultIdx = Math.max(
      0,
      workspaces.findIndex((w) => w.id === currentLinkedId),
    );
    chosen = await tuiSelect({
      title: "Step 2 of 3 · Select a Workspace to link to this folder",
      stepLabel: "Workspace",
      searchable: workspaces.length > 4,
      initialIndex: defaultIdx,
      items: workspaces.map((ws) => ({
        label: ws.title,
        summaryLabel: `${ws.title} (${ws.slug || ws.id})`,
        hint: ws.slug || ws.id.slice(0, 8),
        badge: `${c.muted}[${ws.role || "member"}]${c.reset}${ws.id === currentLinkedId ? ` ${c.emerald}● current${c.reset}` : ""}`,
        value: ws,
      })),
    });
  }

  const config = {
    projectId: chosen.id,
    title: chosen.title,
    slug: chosen.slug,
    apiUrl,
    linkedAt: new Date().toISOString(),
  };
  saveLocalConfig(config);

  // Step 3: Optional Active Task Binding
  let boundTask = null;
  let loadedTasks = null;
  if (requestedTaskId) {
    try {
      const detail = await withSpinner(
        "Loading task details…",
        () =>
          apiRequest(
            `/api/v1/extension/task-detail?projectId=${chosen.id}&taskId=${encodeURIComponent(requestedTaskId)}`,
            { apiUrl },
          ),
        { silent: Boolean(flags.json) },
      );
      if (detail?.task) {
        boundTask = detail.task;
      }
    } catch {
      boundTask = { id: requestedTaskId, title: requestedTaskId, status: "in_progress" };
    }
    if (!flags.json && boundTask) {
      printStepDone("Active Task", `${boundTask.title}`);
    }
  } else if (process.stdin.isTTY && !flags.json && !flags["no-task"]) {
    try {
      const taskData = await withSpinner(
        `Loading sprint tasks for ${chosen.title}…`,
        () =>
          apiRequest(
            `/api/v1/extension/workspace-tasks?projectId=${chosen.id}&scope=all`,
            { apiUrl },
          ),
        { silent: Boolean(flags.json) },
      );
      loadedTasks = taskData?.tasks || [];
      const openTasks = loadedTasks.filter((t) => t.status !== "done");
      if (openTasks.length > 0) {
        const currentTaskId = getLocalState()?.activeTaskId;
        const taskItems = [
          ...openTasks.map((t) => {
            const num = t.taskNumber ? `#${t.taskNumber} ` : "";
            const stSum = t.subtaskSummary || { completed: 0, total: (t.subtasks || []).length };
            const stText = stSum.total > 0 ? ` · ☑ ${stSum.completed}/${stSum.total} subtasks` : "";
            const fCount = t.filesCount ?? (t.files || []).length;
            const fText = fCount > 0 ? ` · 📎 ${fCount} file(s)` : "";
            return {
              label: `${num}${t.title}`,
              summaryLabel: `${num}${t.title}`,
              badge: `${formatStatusBadge(t.status)} ${formatPriorityBadge(t.priority)}`,
              description: `${t.id === currentTaskId ? "Currently bound · " : ""}${
                (t.descriptionPreview || t.description || "No description").replace(/\s+/g, " ").slice(0, 68)
              }${stText}${fText}`,
              value: t,
            };
          }),
          {
            label: "Skip for now (push to workspace without a specific task)",
            summaryLabel: "None (workspace level)",
            badge: `${c.dim}[Workspace Root]${c.reset}`,
            value: null,
          },
        ];

        const initialTaskIdx = Math.max(
          0,
          openTasks.findIndex((t) => t.id === currentTaskId),
        );

        boundTask = await tuiSelect({
          title: "Step 3 of 3 · Bind an Active Sprint Task (Optional)",
          stepLabel: "Active Task",
          searchable: openTasks.length > 5,
          allowCancel: true,
          initialIndex: initialTaskIdx,
          items: taskItems,
        });
      } else {
        printStepDone("Active Task", "No open tasks in workspace");
      }
    } catch {
      // Non-fatal if workspace has no tasks
    }
  }

  if (boundTask) {
    saveLocalState({
      ...getLocalState(),
      activeTaskId: boundTask.id,
      activeTaskTitle: boundTask.title,
      startedAt: new Date().toISOString(),
    });
    if (boundTask.status === "todo" && boundTask.updatedAt) {
      await apiRequest("/api/v1/extension/task-update", {
        method: "PATCH",
        apiUrl,
        body: {
          kind: "status",
          projectId: chosen.id,
          taskId: boundTask.id,
          status: "in_progress",
          expectedUpdatedAt: new Date(boundTask.updatedAt).toISOString(),
        },
      }).catch(() => {});
      boundTask.status = "in_progress";
    }
  } else if (!requestedTaskId) {
    const prev = getLocalState();
    delete prev.activeTaskId;
    delete prev.activeTaskTitle;
    saveLocalState(prev);
  }

  let mirrorSummary = null;
  if (!flags["no-mirror"]) {
    try {
      const [mSum, fetchedTaskData] = await withSpinner(
        `Syncing ${chosen.title} files & tasks to local mirror (.networkbase/)…`,
        () =>
          Promise.all([
            hydrateWorkspaceMirror(chosen.id),
            loadedTasks
              ? Promise.resolve({ tasks: loadedTasks })
              : apiRequest(`/api/v1/extension/workspace-tasks?projectId=${chosen.id}&scope=all`, { apiUrl }).catch(
                  () => ({ tasks: [] }),
                ),
          ]),
        { silent: Boolean(flags.json || flags.silent) },
      );
      mirrorSummary = mSum;
      loadedTasks = fetchedTaskData?.tasks || [];
      writeLocalTaskIntelligence(chosen.id, chosen.title, loadedTasks);
    } catch {
      // Non-fatal if workspace is empty
    }
  } else if (loadedTasks) {
    writeLocalTaskIntelligence(chosen.id, chosen.title, loadedTasks);
  }

  const daemon = flags["no-daemon"] ? { running: false } : ensureBackgroundDaemon(chosen.id);

  if (flags.silent) {
    return;
  }

  outputResult(
    {
      ...config,
      activeTask: boundTask ? { id: boundTask.id, title: boundTask.title } : null,
      mirrorDir: mirrorSummary?.mirrorDir || getLocalMirrorDir(),
      tasksBriefingPath: path.join(getLocalTasksDir(), "TASKS.md"),
      mirroredFilesCount: (mirrorSummary?.downloadedCount || 0) + (mirrorSummary?.upToDateCount || 0),
      tasksCount: (loadedTasks || []).length,
      daemonRunning: daemon.running,
      daemonPid: daemon.pid || null,
    },
    flags,
    (res) => {
      if (mirrorSummary) {
        printStepDone(
          "Local Mirror",
          `.networkbase/mirror/ (${res.mirroredFilesCount} file(s)) & .networkbase/tasks/TASKS.md (${res.tasksCount} task(s))`,
        );
      }
      if (res.daemonRunning) {
        printStepDone(
          "Auto-Sync",
          `Background watcher active (PID ${res.daemonPid} · saves push automatically in <400ms)`,
        );
      }
      console.log(`${RAIL}`);
      console.log(
        `${c.dim}╰─${c.reset} ${c.emerald}✔${c.reset} ${c.bold}${c.ink}Workspace ready!${c.reset} Edit files in ${c.accent}.networkbase/mirror/${c.reset} or run ${c.accent}nb task${c.reset}.\n`,
      );
    },
  );
}

async function handleStatus(flags) {
  const creds = getCredentials();
  const localCfg = getLocalConfig();
  const localState = getLocalState();
  const apiUrl = await resolveBestApiUrl(localCfg?.apiUrl || creds?.apiUrl);

  let sessionInfo = { active: false, user: null, sessionId: null, tokenType: null };
  if (creds?.token) {
    try {
      sessionInfo = await apiRequest("/api/v1/extension/session", { apiUrl, token: creds.token });
    } catch {
      sessionInfo = { active: false, user: creds.user || null, sessionId: creds.sessionId, tokenType: creds.tokenType };
    }
  }

  const localFilesCount = localCfg?.projectId ? collectLocalFiles([], process.cwd()).length : 0;

  const statusPayload = {
    authenticated: Boolean(sessionInfo.active),
    apiUrl,
    sessionId: sessionInfo.sessionId || null,
    tokenType: sessionInfo.tokenType || creds?.tokenType || null,
    user: sessionInfo.user || creds?.user || null,
    workspace: localCfg?.projectId ? localCfg : null,
    activeTask: localState?.activeTaskId
      ? { id: localState.activeTaskId, title: localState.activeTaskTitle }
      : null,
    localFilesCount,
  };

  outputResult(statusPayload, flags, (res) => {
    const identity = res.authenticated
      ? `${c.emerald}●${c.reset} ${c.bold}${c.ink}${res.user?.username ? `@${res.user.username}` : res.user?.email || res.sessionId}${c.reset} ${c.muted}(${res.tokenType || "device"})${c.reset}`
      : `${c.amber}○ Not signed in${c.reset}`;

    const wsDisplay = res.workspace?.projectId
      ? `${c.bold}${c.ink}${res.workspace.title || res.workspace.projectId}${c.reset} ${c.muted}(${res.workspace.slug || res.workspace.projectId.slice(0, 8)})${c.reset}`
      : `${c.muted}Not linked (run \`nb init\`)${c.reset}`;

    const taskDisplay = res.activeTask
      ? `${c.ink}${res.activeTask.title || res.activeTask.id}${c.reset}`
      : `${c.muted}None bound${c.reset}`;

    renderBrandHeader({
      subtitle: `Server: ${res.apiUrl}`,
      contextRows: [
        { label: "Account", value: identity },
        { label: "Workspace", value: wsDisplay },
        { label: "Active Task", value: taskDisplay },
        { label: "Local Tree", value: `${c.ink}${res.localFilesCount} tracked file(s)${c.reset}` },
      ],
    });
    console.log("");
  });

  return statusPayload;
}

async function handleWorkspace(sub, positional, flags) {
  if (sub === "switch" || (!sub && process.stdin.isTTY && !flags.json)) {
    const target = positional[0] || flags.workspace;
    if (target) {
      await handleInit([target], { ...flags, "no-task": true });
      return;
    }
    await handleInit([], flags);
    return;
  }

  if (!sub || sub === "list" || sub === "ls") {
    const data = await apiRequest("/api/v1/extension/workspaces");
    const currentId = getLocalConfig().projectId;
    outputResult(data, flags, (res) => {
      renderBrandHeader({ subtitle: `Accessible Workspaces (${res.workspaces.length})` });
      console.log(RAIL);
      for (const ws of res.workspaces) {
        const marker = ws.id === currentId ? `${c.emerald}●${c.reset}` : `${c.dim}○${c.reset}`;
        console.log(
          `${RAIL}  ${marker} ${c.bold}${c.ink}${ws.title}${c.reset} ${c.muted}(${ws.slug || ws.id})${c.reset} ${formatStatusBadge(ws.role)}`,
        );
      }
      console.log(`${c.dim}╰─${c.reset} Run ${c.accent}nb workspace switch${c.reset} to switch interactively.\n`);
    });
    return;
  }

  if (sub === "info") {
    const cfg = getLocalConfig();
    if (!cfg.projectId) throw new Error("No workspace linked. Run `nb init` first.");
    const summary = await apiRequest(`/api/v1/extension/workspace-summary?projectId=${cfg.projectId}`);
    outputResult({ workspace: cfg, summary }, flags, (res) => {
      renderBrandHeader({
        subtitle: "Workspace Summary",
        contextRows: [
          { label: "Workspace", value: `${c.bold}${c.ink}${res.workspace.title}${c.reset}` },
          { label: "Project ID", value: `${c.muted}${res.workspace.projectId}${c.reset}` },
          { label: "Total Tasks", value: `${c.ink}${res.summary.taskCount}${c.reset}` },
        ],
      });
      console.log("");
    });
    return;
  }

  throw new Error(`Unknown workspace subcommand: ${sub}`);
}

async function hydrateTaskAttachedFiles(projectId, attachedFiles, cwd = process.cwd()) {
  if (!attachedFiles || attachedFiles.length === 0) return 0;
  const mirrorDir = getLocalMirrorDir(cwd);
  ensureDir(mirrorDir);
  const manifest = getLocalManifest(cwd);
  const manifestFiles = manifest.projectId === projectId && manifest.files ? manifest.files : {};
  const manifestUpdates = [];
  let hydratedCount = 0;

  const candidates = attachedFiles.filter(
    (f) => f.type !== "folder" && (f.size ?? 0) <= 512 * 1024 && (f.path || f.name),
  );

  for (let offset = 0; offset < candidates.length; offset += 8) {
    const chunk = candidates.slice(offset, offset + 8);
    await Promise.all(
      chunk.map(async (f) => {
        const rawPath = f.path || `/${f.name}`;
        const normPath = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
        const cleanRel = normPath.replace(/^\/+/, "");
        const mirrorDest = path.join(mirrorDir, cleanRel);
        const expectedHash = (f.contentHash || manifestFiles[normPath]?.contentHash || "").toLowerCase();

        if (expectedHash && fs.existsSync(mirrorDest)) {
          try {
            const localHash = computeFileSha256(mirrorDest).hash.toLowerCase();
            if (localHash === expectedHash) {
              hydratedCount++;
              return;
            }
          } catch {
            // Re-download if unreadable
          }
        }

        try {
          const { buffer, meta } = await downloadRemoteFileBuffer(projectId, normPath);
          if (buffer) {
            ensureDir(path.dirname(mirrorDest));
            fs.writeFileSync(mirrorDest, buffer);
            hydratedCount++;
            manifestUpdates.push({
              path: normPath,
              nodeId: meta?.nodeId || f.nodeId || f.id,
              version: meta?.currentVersion || f.currentVersion || 1,
              contentHash:
                meta?.contentHash || f.contentHash || crypto.createHash("sha256").update(buffer).digest("hex"),
              size: buffer.length,
            });
          }
        } catch {
          // Ignore unavailable file
        }
      }),
    );
  }

  if (manifestUpdates.length > 0) {
    updateManifestFiles(projectId, manifestUpdates, cwd);
  }
  return hydratedCount;
}

function renderTaskDetailCard(res, cfg, hydratedCount = 0) {
  const t = res.task;
  const numStr = t.taskNumber ? `#${t.taskNumber}` : t.id.slice(0, 8);
  const subtasks = res.subtasks || [];
  const stSummary = res.subtaskSummary || {
    completed: subtasks.filter((s) => s.completed).length,
    total: subtasks.length,
  };
  const files = res.files || [];
  const comments = res.comments || [];
  const pushes = res.pushes || [];

  const contextRows = [
    { label: "Title", value: `${c.bold}${c.ink}${t.title}${c.reset}` },
    {
      label: "Status",
      value: `${formatStatusBadge(t.status)} · Priority: ${formatPriorityBadge(t.priority)}${
        t.storyPoints ? ` · Points: ${c.ink}${t.storyPoints}${c.reset}` : ""
      }`,
    },
  ];

  if (t.sprint?.name || t.assignee?.name || t.assignee?.username) {
    const sprintPart = t.sprint?.name ? `Sprint: ${c.ink}${t.sprint.name}${c.reset}` : "";
    const assigneePart =
      t.assignee?.name || t.assignee?.username
        ? `Assignee: ${c.ink}${t.assignee.username ? `@${t.assignee.username}` : t.assignee.name}${c.reset}`
        : "";
    contextRows.push({
      label: "Assignment",
      value: [sprintPart, assigneePart].filter(Boolean).join(" · "),
    });
  }
  if (t.reviewStatus && t.reviewStatus !== "none") {
    contextRows.push({
      label: "Review",
      value: `${c.amber}${t.reviewStatus.toUpperCase()}${c.reset}${
        t.reviewReason ? ` · "${t.reviewReason}"` : ""
      }`,
    });
  }
  contextRows.push({ label: "Task ID", value: `${c.muted}${t.id}${c.reset}` });

  renderBrandHeader({
    subtitle: `Task ${numStr} · ${cfg?.title || t.projectId}`,
    contextRows,
  });

  console.log(RAIL);
  console.log(`${STEP_ACTIVE}  ${c.bold}${c.ink}Description${c.reset}`);
  if (t.description && t.description.trim()) {
    for (const line of t.description.trim().split("\n")) {
      console.log(`${RAIL}  ${c.ink}${line}${c.reset}`);
    }
  } else {
    console.log(`${RAIL}  ${c.muted}No description provided.${c.reset}`);
  }

  console.log(RAIL);
  console.log(
    `${stSummary.total > 0 && stSummary.completed === stSummary.total ? STEP_DONE : STEP_ACTIVE}  ${c.bold}${c.ink}Subtasks (${stSummary.completed}/${stSummary.total} Completed)${c.reset}`,
  );
  if (subtasks.length === 0) {
    console.log(`${RAIL}  ${c.muted}No subtasks defined for this task.${c.reset}`);
  } else {
    for (let i = 0; i < subtasks.length; i++) {
      const st = subtasks[i];
      const idx = st.index || i + 1;
      const box = st.completed ? `${c.emerald}[x]${c.reset}` : `${c.muted}[ ]${c.reset}`;
      const textStyle = st.completed ? c.muted : c.ink;
      console.log(`${RAIL}  ${box} ${c.bold}${idx}.${c.reset} ${textStyle}${st.title}${c.reset}`);
    }
  }

  console.log(RAIL);
  console.log(
    `${files.length > 0 ? STEP_DONE : STEP_ACTIVE}  ${c.bold}${c.ink}Attached & Linked Files (${files.length})${c.reset}${
      hydratedCount > 0 ? ` ${c.muted}— Synced to .networkbase/mirror/${c.reset}` : ""
    }`,
  );
  if (files.length === 0) {
    console.log(`${RAIL}  ${c.muted}No files attached yet. Push with \`nb push <file> --deliverable\` to attach.${c.reset}`);
  } else {
    for (const f of files) {
      const cleanRel = (f.path || f.name || "").replace(/^\/+/, "");
      const mirrorPath = `.networkbase/mirror/${cleanRel}`;
      const roleBadge = formatStatusBadge(f.role || "working");
      console.log(
        `${RAIL}  • ${c.bold}${c.ink}${f.path || f.name}${c.reset} ${c.accent}[v${f.currentVersion || 1}]${c.reset} ${c.muted}(${formatBytes(f.size || 0)})${c.reset} ${roleBadge} ${c.dim}-> ${mirrorPath}${c.reset}`,
      );
      if (f.annotation && !f.annotation.startsWith("#")) {
        console.log(`${RAIL}      ${c.muted}Note: "${f.annotation}"${c.reset}`);
      }
    }
  }

  if (comments.length > 0) {
    console.log(RAIL);
    console.log(`${STEP_ACTIVE}  ${c.bold}${c.ink}Discussion Comments (${comments.length})${c.reset}`);
    for (const cm of comments.slice(0, 5)) {
      console.log(
        `${RAIL}  • ${c.bold}${c.ink}${cm.authorUsername ? `@${cm.authorUsername}` : cm.authorName}:${c.reset} ${c.muted}${cm.content.replace(/\s+/g, " ")}${c.reset}`,
      );
    }
  }

  if (pushes.length > 0) {
    console.log(RAIL);
    console.log(`${STEP_DONE}  ${c.bold}${c.ink}Recent Pushes (${pushes.length})${c.reset}`);
    for (const p of pushes.slice(0, 4)) {
      console.log(
        `${RAIL}  • ${c.ink}${p.message || "Update"}${c.reset} ${c.muted}by ${p.pushedByName} (${p.filesCount} file(s))${c.reset}`,
      );
    }
  }

  console.log(
    `${c.dim}╰─${c.reset} ${c.emerald}✔${c.reset} Run ${c.accent}nb task check${c.reset} to toggle subtasks or edit ${c.accent}.networkbase/mirror/${c.reset} directly.\n`,
  );
}

async function handleTask(sub, positional, flags) {
  const cwd = process.cwd();
  const cfg = getLocalConfig(cwd);
  const projectId = typeof flags.workspace === "string" ? flags.workspace : cfg.projectId;

  // Support `nb task list --all` / `nb task --all-workspaces` across all accessible workspaces
  if ((!sub || sub === "list" || sub === "ls") && (flags.all || flags["all-workspaces"])) {
    const wsData = await withSpinner(
      "Loading all accessible workspaces & tasks…",
      () => apiRequest("/api/v1/extension/workspaces"),
      { silent: Boolean(flags.json) },
    );
    const workspaces = wsData?.workspaces || [];
    const results = await Promise.all(
      workspaces.map(async (ws) => {
        try {
          const td = await apiRequest(
            `/api/v1/extension/workspace-tasks?projectId=${ws.id}&scope=${flags.mine ? "mine" : "all"}`,
          );
          return { workspace: ws, tasks: td?.tasks || [] };
        } catch {
          return { workspace: ws, tasks: [] };
        }
      }),
    );

    const totalTasks = results.reduce((acc, r) => acc + r.tasks.length, 0);
    outputResult({ workspaces: results, totalTasks }, flags, (res) => {
      renderBrandHeader({
        subtitle: `All Workspaces Task Overview (${res.totalTasks} total task(s) across ${res.workspaces.length} workspace(s))`,
      });
      for (const group of res.workspaces) {
        if (group.tasks.length === 0) continue;
        console.log(RAIL);
        console.log(
          `${STEP_ACTIVE}  ${c.bold}${c.ink}${group.workspace.title}${c.reset} ${c.muted}(${group.workspace.slug || group.workspace.id} · ${group.tasks.length} task(s))${c.reset}`,
        );
        for (const t of group.tasks) {
          const num = t.taskNumber ? `#${t.taskNumber}` : t.id.slice(0, 8);
          const stSum = t.subtaskSummary || { completed: 0, total: (t.subtasks || []).length };
          const stBadge = stSum.total > 0 ? ` · ${c.muted}☑ ${stSum.completed}/${stSum.total} subtasks${c.reset}` : "";
          const fBadge = t.filesCount > 0 ? ` · ${c.muted}📎 ${t.filesCount} file(s)${c.reset}` : "";
          console.log(
            `${RAIL}    • ${formatStatusBadge(t.status)} ${formatPriorityBadge(t.priority)} ${c.bold}${c.ink}${num}${c.reset} ${c.ink}${t.title}${c.reset}${stBadge}${fBadge}`,
          );
        }
      }
      console.log(`${c.dim}╰─${c.reset}\n`);
    });
    return;
  }

  if (!projectId) throw new Error("No workspace linked. Run `nb init` first.");

  // Allow shorthand `nb task #4` or `nb task 4` to directly open `nb task view #4`
  if (sub && (/^#?\d+$/.test(sub) || /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(sub))) {
    positional = [sub, ...positional];
    sub = "view";
  }

  if (sub === "work") {
    let rawTarget = positional[0];
    if (!rawTarget && process.stdin.isTTY && !flags.json) {
      renderBrandHeader({ subtitle: `Select Active Sprint Task · ${cfg.title || projectId}` });
      const data = await withSpinner("Loading workspace tasks…", () =>
        apiRequest(`/api/v1/extension/workspace-tasks?projectId=${projectId}&scope=all`),
      );
      const allTasks = data?.tasks || [];
      writeLocalTaskIntelligence(projectId, cfg.title || projectId, allTasks, cwd);
      const openTasks = allTasks.filter((t) => t.status !== "done");
      if (openTasks.length === 0) {
        console.log(`${RAIL}\n${c.dim}╰─${c.reset} No open tasks found in this workspace.\n`);
        return;
      }
      const chosenTask = await tuiSelect({
        title: "Choose a task to work on",
        stepLabel: "Active Task",
        searchable: openTasks.length > 5,
        items: openTasks.map((t) => {
          const num = t.taskNumber ? `#${t.taskNumber} ` : "";
          const stSum = t.subtaskSummary || { completed: 0, total: (t.subtasks || []).length };
          const stPart = stSum.total > 0 ? ` · ☑ ${stSum.completed}/${stSum.total} subtasks` : "";
          const fPart = (t.filesCount || 0) > 0 ? ` · 📎 ${t.filesCount} file(s)` : "";
          return {
            label: `${num}${t.title}`,
            badge: `${formatStatusBadge(t.status)} ${formatPriorityBadge(t.priority)}`,
            description: `${(t.descriptionPreview || t.description || "No description").replace(/\s+/g, " ").slice(0, 68)}${stPart}${fPart}`,
            value: t,
          };
        }),
      });
      if (!chosenTask) return;
      rawTarget = chosenTask.id;
    }

    if (!rawTarget) throw new Error("Usage: nb task work <#number-or-task-id>");
    const resolvedId = resolveTaskIdentifier(rawTarget, cwd);
    const detail = await withSpinner(
      "Loading task intelligence & attached files…",
      () =>
        apiRequest(
          `/api/v1/extension/task-detail?projectId=${projectId}&taskId=${encodeURIComponent(resolvedId)}`,
        ),
      { silent: Boolean(flags.json) },
    );
    const task = detail.task;
    saveLocalState(
      {
        ...getLocalState(cwd),
        activeTaskId: task.id,
        activeTaskTitle: task.title,
        startedAt: new Date().toISOString(),
      },
      cwd,
    );
    if (task.status === "todo") {
      await apiRequest("/api/v1/extension/task-update", {
        method: "PATCH",
        body: {
          kind: "status",
          projectId,
          taskId: task.id,
          status: "in_progress",
          expectedUpdatedAt: new Date(task.updatedAt).toISOString(),
        },
      }).catch(() => {});
      detail.task.status = "in_progress";
    }

    const hydratedCount = await hydrateTaskAttachedFiles(projectId, detail.files || [], cwd);

    // Refresh local TASKS.md with newly bound activeTaskId
    const cachedTasks = getLocalCache(cwd)?.tasks || [];
    if (cachedTasks.length > 0) {
      writeLocalTaskIntelligence(projectId, cfg.title || projectId, cachedTasks, cwd);
    }

    outputResult(
      {
        activeTaskId: task.id,
        taskNumber: task.taskNumber,
        title: task.title,
        description: task.description,
        status: detail.task.status,
        subtasks: detail.subtasks || [],
        files: detail.files || [],
        hydratedFilesCount: hydratedCount,
      },
      flags,
      () => {
        renderTaskDetailCard(detail, cfg, hydratedCount);
      },
    );
    return;
  }

  if (!sub || sub === "list" || sub === "ls") {
    const scope = flags.mine ? "mine" : flags.scope || "all";
    const renderTaskListCard = (tasks, isOffline = false) => {
      const activeId = getLocalState(cwd)?.activeTaskId;
      const openCount = tasks.filter((t) => t.status !== "done").length;
      const doneCount = tasks.filter((t) => t.status === "done").length;
      const activeTaskObj = tasks.find((t) => t.id === activeId);

      renderBrandHeader({
        subtitle: `Workspace Tasks · ${cfg.title || projectId} (${openCount} open, ${doneCount} done)${isOffline ? " [Local Mirror]" : ""}`,
        contextRows: activeTaskObj
          ? [
              {
                label: "Active Task",
                value: `${c.emerald}●${c.reset} ${c.bold}${c.ink}${
                  activeTaskObj.taskNumber ? `#${activeTaskObj.taskNumber} ` : ""
                }${activeTaskObj.title}${c.reset}`,
              },
              {
                label: "Local Brief",
                value: `${c.muted}.networkbase/tasks/TASKS.md (synced)${c.reset}`,
              },
            ]
          : [
              {
                label: "Local Brief",
                value: `${c.muted}.networkbase/tasks/TASKS.md (synced)${c.reset}`,
              },
            ],
      });
      console.log(RAIL);
      if (tasks.length === 0) {
        console.log(`${RAIL}  ${c.muted}No tasks found in this workspace.${c.reset}`);
      }
      for (const t of tasks) {
        const num = t.taskNumber ? `#${t.taskNumber}` : t.id.slice(0, 8);
        const marker = t.id === activeId ? `${c.emerald}●${c.reset}` : `${c.dim}○${c.reset}`;
        const stSum = t.subtaskSummary || { completed: 0, total: (t.subtasks || []).length };
        const stInfo =
          stSum.total > 0
            ? ` · ${stSum.completed === stSum.total ? c.emerald : c.ink}☑ ${stSum.completed}/${stSum.total} subtasks${c.reset}`
            : "";
        const fCount = t.filesCount ?? (t.files || []).length;
        const fInfo = fCount > 0 ? ` · ${c.accent}📎 ${fCount} attached file(s)${c.reset}` : "";
        console.log(
          `${RAIL}  ${marker} ${c.bold}${c.ink}${num.padEnd(4)}${c.reset} ${c.bold}${c.ink}${t.title}${c.reset}`,
        );
        console.log(
          `${RAIL}         ${formatStatusBadge(t.status)} · ${formatPriorityBadge(t.priority)}${stInfo}${fInfo}`,
        );
        if (t.description && t.description.trim()) {
          const snippet = t.description.trim().replace(/\s+/g, " ").slice(0, 78);
          console.log(
            `${RAIL}         ${c.muted}"${snippet}${t.description.trim().length > 78 ? "…" : ""}"${c.reset}`,
          );
        }
        if ((t.subtasks || []).length > 0) {
          for (const st of (t.subtasks || []).slice(0, 4)) {
            const box = st.completed ? `${c.emerald}[x]${c.reset}` : `${c.muted}[ ]${c.reset}`;
            console.log(`${RAIL}           ${box} ${c.muted}${st.index}. ${st.title}${c.reset}`);
          }
        }
        if ((t.files || []).length > 0) {
          for (const f of (t.files || []).slice(0, 3)) {
            const cleanRel = (f.path || f.name || "").replace(/^\/+/, "");
            console.log(
              `${RAIL}           ${c.accent}📎 ${f.path || f.name}${c.reset} ${c.muted}[v${f.currentVersion || 1}]${c.reset} ${formatStatusBadge(f.role)} ${c.dim}(.networkbase/mirror/${cleanRel})${c.reset}`,
            );
          }
        }
        console.log(RAIL);
      }
      console.log(
        `${c.dim}╰─${c.reset} Run ${c.accent}nb task <number>${c.reset} (e.g. ${c.accent}nb task 4${c.reset}) to inspect or ${c.accent}nb task work <number>${c.reset} to bind.\n`,
      );
    };

    try {
      const data = await withSpinner(
        `Loading tasks for ${cfg.title || projectId}…`,
        () => apiRequest(`/api/v1/extension/workspace-tasks?projectId=${projectId}&scope=${scope}`),
        { silent: Boolean(flags.json) },
      );
      const list = data.tasks || [];
      writeLocalTaskIntelligence(projectId, cfg.title || projectId, list, cwd);

      const allAttachedFiles = list
        .filter((t) => t.status !== "done")
        .flatMap((t) => t.files || []);
      if (allAttachedFiles.length > 0) {
        await hydrateTaskAttachedFiles(projectId, allAttachedFiles, cwd);
      }

      outputResult(data, flags, (res) => renderTaskListCard(res.tasks || [], false));
    } catch (err) {
      const snapshot = readJsonSafe(path.join(getLocalTasksDir(cwd), "tasks.json"), null);
      const cachedTasks = snapshot?.tasks || getLocalCache(cwd)?.tasks || [];
      if (cachedTasks.length) {
        outputResult({ tasks: cachedTasks, offlineCache: true }, flags, (res) =>
          renderTaskListCard(res.tasks || [], true),
        );
        return;
      }
      throw err;
    }
    return;
  }

  if (sub === "view" || sub === "inspect" || sub === "show") {
    const rawTarget = positional[0] || inferActiveTaskId(flags, cwd);
    if (!rawTarget) {
      throw new Error("Usage: nb task view <#number-or-task-id> (or bind an active task with `nb task work`)");
    }
    const resolvedId = resolveTaskIdentifier(rawTarget, cwd);
    let detail;
    let hydratedCount = 0;
    try {
      detail = await withSpinner(
        "Loading complete task briefing, subtasks & attached files…",
        () =>
          apiRequest(
            `/api/v1/extension/task-detail?projectId=${projectId}&taskId=${encodeURIComponent(resolvedId)}`,
          ),
        { silent: Boolean(flags.json) },
      );
      hydratedCount = await hydrateTaskAttachedFiles(projectId, detail.files || [], cwd);
    } catch (err) {
      const snapshot = readJsonSafe(path.join(getLocalTasksDir(cwd), "tasks.json"), null);
      const cachedTasks = snapshot?.tasks || getLocalCache(cwd)?.tasks || [];
      const matched = cachedTasks.find(
        (t) => t.id === resolvedId || String(t.taskNumber) === String(resolvedId).replace(/^#/, ""),
      );
      if (!matched) throw err;
      detail = {
        task: matched,
        subtasks: matched.subtasks || [],
        subtaskSummary: matched.subtaskSummary || {
          completed: (matched.subtasks || []).filter((s) => s.completed).length,
          total: (matched.subtasks || []).length,
        },
        files: matched.files || [],
        comments: matched.comments || [],
        pushes: matched.pushes || [],
        offlineCache: true,
      };
    }

    const enrichedDetail = {
      ...detail,
      files: (detail.files || []).map((f) => ({
        ...f,
        localMirrorPath: `.networkbase/mirror/${(f.path || f.name || "").replace(/^\/+/, "")}`,
      })),
    };

    outputResult(enrichedDetail, flags, (res) => {
      renderTaskDetailCard(res, cfg, hydratedCount);
    });
    return;
  }

  if (sub === "check" || sub === "subtask" || sub === "subtasks") {
    const rawTaskTarget = flags.task ? String(flags.task) : inferActiveTaskId(flags, cwd);
    let targetTaskId = rawTaskTarget ? resolveTaskIdentifier(rawTaskTarget, cwd) : null;
    let targetArgs = [...positional];

    // If first positional arg looks like `#4` and there are more args (e.g., `nb task check #4 1 2`)
    if (!targetTaskId && targetArgs.length > 0) {
      targetTaskId = resolveTaskIdentifier(targetArgs.shift(), cwd);
    } else if (targetArgs.length > 1 && /^#\d+$/.test(targetArgs[0])) {
      targetTaskId = resolveTaskIdentifier(targetArgs.shift(), cwd);
    }

    if (!targetTaskId) {
      throw new Error("No active task bound. Run `nb task work <#number>` or pass `--task <#number>`.");
    }

    const detail = await apiRequest(
      `/api/v1/extension/task-detail?projectId=${projectId}&taskId=${encodeURIComponent(targetTaskId)}`,
    );
    const task = detail.task;
    const subtasks = detail.subtasks || [];

    if (subtasks.length === 0) {
      outputResult({ taskId: task.id, subtasks: [], updatedCount: 0 }, flags, () => {
        console.log(`${RAIL}\n${c.dim}╰─${c.reset} Task "${task.title}" has no subtasks.\n`);
      });
      return;
    }

    const desiredCompletionById = new Map();

    if (flags.all) {
      const targetVal = !flags.uncheck;
      for (const st of subtasks) {
        if (st.completed !== targetVal) {
          desiredCompletionById.set(st.id, targetVal);
        }
      }
    } else if (targetArgs.length > 0) {
      const targetVal = !flags.uncheck;
      for (const arg of targetArgs) {
        const cleaned = String(arg).replace(/^#/, "");
        const matched = subtasks.find(
          (st, idx) =>
            st.id === cleaned ||
            String(st.index || idx + 1) === cleaned ||
            st.title.toLowerCase().includes(cleaned.toLowerCase()),
        );
        if (matched && matched.completed !== targetVal) {
          desiredCompletionById.set(matched.id, targetVal);
        }
      }
    } else if (process.stdin.isTTY && !flags.json) {
      renderBrandHeader({
        subtitle: `Subtasks Checklist · ${task.taskNumber ? `#${task.taskNumber} ` : ""}${task.title}`,
      });
      const selectedIds = await tuiMultiSelect({
        title: "Toggle completed subtasks (Space to toggle, A for all, Enter to save)",
        stepLabel: "Subtasks",
        items: subtasks.map((st, idx) => ({
          label: `${st.index || idx + 1}. ${st.title}`,
          badge: st.completed ? `${c.emerald}[Completed]${c.reset}` : `${c.muted}[Pending]${c.reset}`,
          value: st.id,
          checked: Boolean(st.completed),
        })),
      });
      const selectedSet = new Set(selectedIds);
      for (const st of subtasks) {
        const nextVal = selectedSet.has(st.id);
        if (Boolean(st.completed) !== nextVal) {
          desiredCompletionById.set(st.id, nextVal);
        }
      }
    } else {
      throw new Error("Usage: nb task check <subtask-number...> or `nb task check --all`");
    }

    let updatedCount = 0;
    for (const st of subtasks) {
      if (!desiredCompletionById.has(st.id)) continue;
      const nextCompleted = desiredCompletionById.get(st.id);
      await apiRequest("/api/v1/extension/task-update", {
        method: "PATCH",
        body: {
          kind: "subtask",
          projectId,
          taskId: task.id,
          subtaskId: st.id,
          completed: nextCompleted,
          expectedUpdatedAt: new Date(st.updatedAt).toISOString(),
        },
      });
      st.completed = nextCompleted;
      updatedCount++;
    }

    // Refresh local TASKS.md
    try {
      const refreshed = await apiRequest(`/api/v1/extension/workspace-tasks?projectId=${projectId}&scope=all`);
      writeLocalTaskIntelligence(projectId, cfg.title || projectId, refreshed.tasks || [], cwd);
    } catch {
      // Non-fatal
    }

    const completedTotal = subtasks.filter((s) => s.completed).length;
    outputResult(
      {
        taskId: task.id,
        title: task.title,
        updatedCount,
        subtaskSummary: { completed: completedTotal, total: subtasks.length },
        subtasks,
      },
      flags,
      (res) => {
        console.log(RAIL);
        console.log(
          `${STEP_DONE}  ${c.bold}${c.ink}Updated ${res.updatedCount} subtask(s)${c.reset} ${c.muted}(${res.subtaskSummary.completed}/${res.subtaskSummary.total} completed on "${res.title}")${c.reset}`,
        );
        for (const st of res.subtasks) {
          const box = st.completed ? `${c.emerald}[x]${c.reset}` : `${c.muted}[ ]${c.reset}`;
          console.log(`${RAIL}    ${box} ${c.bold}${st.index}.${c.reset} ${c.ink}${st.title}${c.reset}`);
        }
        console.log(`${c.dim}╰─${c.reset}\n`);
      },
    );
    return;
  }

  if (sub === "done") {
    const rawTarget = positional[0] || inferActiveTaskId(flags, cwd);
    if (!rawTarget) throw new Error("Usage: nb task done <#number-or-task-id>");
    const resolvedId = resolveTaskIdentifier(rawTarget, cwd);
    const detail = await apiRequest(
      `/api/v1/extension/task-detail?projectId=${projectId}&taskId=${encodeURIComponent(resolvedId)}`,
    );
    const task = detail.task;
    const updated = await apiRequest("/api/v1/extension/task-update", {
      method: "PATCH",
      body: {
        kind: "status",
        projectId,
        taskId: task.id,
        status: "done",
        expectedUpdatedAt: new Date(task.updatedAt).toISOString(),
      },
    });
    outputResult(updated, flags, () => {
      console.log(
        `\n${c.emerald}✔${c.reset} Task ${c.bold}${c.ink}"${task.title}"${c.reset} marked as ${formatStatusBadge("done")}\n`,
      );
    });
    return;
  }

  if (sub === "status") {
    let tasks = [];
    let offlineCache = false;
    try {
      const data = await apiRequest(`/api/v1/extension/workspace-tasks?projectId=${projectId}&scope=all`);
      tasks = data.tasks || [];
      writeLocalTaskIntelligence(projectId, cfg.title || projectId, tasks, cwd);
    } catch {
      const cached = getLocalCache(cwd);
      tasks = cached.tasks || [];
      offlineCache = true;
    }
    const todoCount = tasks.filter((t) => t.status === "todo").length;
    const inProgressCount = tasks.filter((t) => t.status === "in_progress").length;
    const doneCount = tasks.filter((t) => t.status === "done").length;
    const completionPct = tasks.length > 0 ? Math.round((doneCount / tasks.length) * 100) : 0;
    outputResult(
      {
        projectId,
        totalTasks: tasks.length,
        todoCount,
        inProgressCount,
        doneCount,
        completionPct,
        offlineCache,
      },
      flags,
      (res) => {
        renderBrandHeader({
          subtitle: `Sprint & Task Health${res.offlineCache ? " (Offline Cache)" : ""}`,
          contextRows: [
            {
              label: "Completion",
              value: `${c.bold}${c.emerald}${res.completionPct}%${c.reset} ${c.muted}(${res.totalTasks} total tasks)${c.reset}`,
            },
            { label: "In Progress", value: `${c.accent}${res.inProgressCount}${c.reset}` },
            { label: "Todo", value: `${c.muted}${res.todoCount}${c.reset}` },
            { label: "Done", value: `${c.emerald}${res.doneCount}${c.reset}` },
          ],
        });
        console.log("");
      },
    );
    return;
  }

  if (sub === "comment") {
    const rawTarget = positional[0] || inferActiveTaskId(flags, cwd);
    const content = flags.message || positional.slice(1).join(" ").trim();
    if (!rawTarget || !content) {
      throw new Error("Usage: nb task comment <#number-or-task-id> <message>");
    }
    const resolvedId = resolveTaskIdentifier(rawTarget, cwd);
    const detail = await apiRequest(
      `/api/v1/extension/task-detail?projectId=${projectId}&taskId=${encodeURIComponent(resolvedId)}`,
    );
    const created = await apiRequest("/api/v1/extension/comments", {
      method: "POST",
      body: { taskId: detail.task.id, content },
    });
    outputResult(created, flags, () => {
      console.log(`\n${c.emerald}✔${c.reset} Posted comment to task "${detail.task.title}"\n`);
    });
    return;
  }

  throw new Error(`Unknown task subcommand: ${sub}`);
}

async function fetchWorkspaceFiles(projectId, query = "") {
  const allFiles = [];
  let cursor = null;
  for (let page = 0; page < 5; page++) {
    const qs = new URLSearchParams({
      projectId,
      q: query,
      kind: "file",
    });
    if (cursor) qs.set("after", cursor);
    const res = await apiRequest(`/api/v1/extension/search?${qs.toString()}`);
    const pageFiles = res?.files || [];
    allFiles.push(...pageFiles);
    if (!res?.nextCursor || pageFiles.length === 0) break;
    cursor = res.nextCursor;
  }
  return allFiles;
}

async function downloadRemoteFileBuffer(projectId, remotePath, options = {}) {
  const normPath = remotePath.startsWith("/") ? remotePath : `/${remotePath}`;
  const headers = {};
  if (options.ifNoneMatch) {
    headers["If-None-Match"] = `"${options.ifNoneMatch}"`;
  }
  const fileRes = await apiRequest(
    `/api/v1/extension/file?projectId=${projectId}&path=${encodeURIComponent(normPath)}&transfer=inline`,
    { headers },
  );
  if (fileRes?.notModified) {
    return { notModified: true, buffer: null, meta: fileRes };
  }
  if (fileRes?.content !== undefined) {
    const buf =
      fileRes.encoding === "base64"
        ? Buffer.from(fileRes.content || "", "base64")
        : Buffer.from(fileRes.content || "", "utf8");
    return { buffer: buf, meta: fileRes };
  }
  if (fileRes?.signedUrl) {
    const creds = getCredentials();
    const rawRes = await fetch(fileRes.signedUrl, {
      headers: creds?.token ? { Authorization: `Bearer ${creds.token}` } : {},
    });
    if (!rawRes.ok) throw new Error(`Failed to download ${normPath}: HTTP ${rawRes.status}`);
    const arr = await rawRes.arrayBuffer();
    return { buffer: Buffer.from(arr), meta: fileRes };
  }
  throw new Error(`Unable to read remote file content for ${normPath}`);
}

async function handleFile(sub, positional, flags) {
  const cfg = getLocalConfig();
  const projectId = flags.workspace || cfg.projectId;
  if (!projectId) throw new Error("No workspace linked. Run `nb init` first.");

  if (sub === "ls" || !sub) {
    const filterQuery = positional[0] || "";
    const nodes = await withSpinner(
      "Loading remote workspace file tree…",
      () => fetchWorkspaceFiles(projectId, filterQuery),
      { silent: Boolean(flags.json) },
    );
    outputResult({ files: nodes }, flags, (res) => {
      renderBrandHeader({ subtitle: `Workspace Files · ${cfg.title || projectId} (${res.files.length})` });
      console.log(RAIL);
      for (const f of res.files) {
        console.log(
          `${RAIL}  ${c.ink}${f.path}${c.reset}  ${c.accent}[v${f.currentVersion || 1}]${c.reset}  ${c.muted}(${formatBytes(f.size || 0)})${c.reset}`,
        );
      }
      console.log(`${c.dim}╰─${c.reset}\n`);
    });
    return;
  }

  if (sub === "cat" || sub === "view" || sub === "read") {
    const targetPath = positional[0];
    if (!targetPath) throw new Error("Usage: nb file cat <path>");
    const normPath = targetPath.startsWith("/") ? targetPath : `/${targetPath}`;
    const { buffer, meta } = await withSpinner(
      `Reading ${normPath} from NetworkBase…`,
      () => downloadRemoteFileBuffer(projectId, normPath),
      { silent: Boolean(flags.json) },
    );
    const text = buffer.toString("utf8");
    outputResult(
      {
        path: normPath,
        nodeId: meta.nodeId,
        currentVersion: meta.currentVersion,
        contentHash: meta.contentHash,
        size: meta.size,
        content: text,
      },
      flags,
      () => {
        renderBrandHeader({
          subtitle: `${normPath} · v${meta.currentVersion || 1} (${formatBytes(meta.size || buffer.length)})`,
        });
        console.log(text);
      },
    );
    return;
  }

  if (sub === "log") {
    const targetPath = positional[0];
    if (!targetPath) throw new Error("Usage: nb file log <path>");
    const normPath = targetPath.startsWith("/") ? targetPath : `/${targetPath}`;
    const meta = await apiRequest(
      `/api/v1/extension/file?projectId=${projectId}&path=${encodeURIComponent(normPath)}&transfer=metadata`,
    );
    if (!meta?.nodeId) throw new Error(`File not found in workspace: ${targetPath}`);
    const history = await apiRequest(
      `/api/v1/extension/file-history?projectId=${projectId}&nodeId=${meta.nodeId}`,
    );
    outputResult({ path: meta.path, nodeId: meta.nodeId, versions: history.versions || [] }, flags, (res) => {
      renderBrandHeader({ subtitle: `Version History · ${res.path}` });
      console.log(RAIL);
      for (const v of res.versions) {
        console.log(
          `${RAIL}  ${c.accent}v${v.version}${c.reset} · ${c.muted}${v.contentHash?.slice(0, 8) || "no-hash"}${c.reset} · ${c.dim}${v.createdAt}${c.reset} · ${c.ink}${v.comment || "Update"}${c.reset}`,
        );
      }
      console.log(`${c.dim}╰─${c.reset}\n`);
    });
    return;
  }

  if (sub === "diff") {
    const { analysis } = await withSpinner(
      "Comparing local files with remote workspace…",
      () => executePrePushAnalysis(positional, flags),
      { silent: Boolean(flags.json) },
    );
    outputResult(analysis, flags, (res) => {
      renderBrandHeader({
        subtitle: `Diff vs Remote (${res.summary.newCount} new, ${res.summary.modifiedCount} modified, ${res.summary.unchangedCount} unchanged)`,
      });
      console.log(RAIL);
      for (const f of res.files) {
        const badge =
          f.status === "new"
            ? `${c.emerald}NEW      ${c.reset}`
            : f.status === "modified"
              ? `${c.amber}MODIFIED ${c.reset}`
              : `${c.dim}UNCHANGED${c.reset}`;
        console.log(`${RAIL}  ${badge} ${c.ink}${f.path}${c.reset} ${c.accent}(${f.versionTransition})${c.reset}`);
      }
      console.log(`${c.dim}╰─${c.reset}\n`);
    });
    return;
  }

  if (sub === "lock" || sub === "unlock") {
    const targetPath = positional[0];
    if (!targetPath) throw new Error(`Usage: nb file ${sub} <path>`);
    const creds = getCredentials();
    const state = getLocalState();
    const locks = state.locks || {};
    const normPath = targetPath.startsWith("/") ? targetPath : `/${targetPath}`;

    if (sub === "lock") {
      const lease = await apiRequest("/api/v1/extension/file-lock", {
        method: "POST",
        body: {
          action: "acquire",
          projectId,
          path: normPath,
          clientSessionId: creds.clientSessionId,
          clientKind: "cli",
          createIfMissing: true,
        },
      });
      locks[normPath] = lease;
      saveLocalState({ ...state, locks });
      outputResult(lease, flags, (res) => {
        console.log(`🔒 Locked ${normPath} (lease: ${res.leaseId}, fencingToken: ${res.fencingToken})`);
      });
    } else {
      const existingLease = locks[normPath];
      if (!existingLease) throw new Error(`No active local lock recorded for ${normPath}`);
      await apiRequest("/api/v1/extension/file-lock", {
        method: "POST",
        body: {
          action: "release",
          projectId,
          path: normPath,
          clientSessionId: creds.clientSessionId,
          leaseId: existingLease.leaseId,
          fencingToken: existingLease.fencingToken,
        },
      });
      delete locks[normPath];
      saveLocalState({ ...state, locks });
      outputResult({ released: true, path: normPath }, flags, () => {
        console.log(`🔓 Released lock on ${normPath}`);
      });
    }
    return;
  }

  throw new Error(`Unknown file subcommand: ${sub}`);
}

function prepareLocalFilesForPush(targetPaths, flags, cwd = process.cwd()) {
  const cfg = getLocalConfig(cwd);
  const projectId = flags.workspace || cfg.projectId;
  if (!projectId) {
    throw new Error("No workspace linked in this directory. Run `nb init` first.");
  }

  const localFiles = collectLocalFiles(targetPaths, cwd, flags.scope);
  if (localFiles.length === 0) {
    throw new Error("No local files found to analyze or push.");
  }

  const secretViolations = [];
  const explicitRemotePath =
    typeof flags["remote-path"] === "string" && localFiles.length === 1
      ? flags["remote-path"].startsWith("/")
        ? flags["remote-path"]
        : `/${flags["remote-path"]}`
      : null;

  const manifest = getLocalManifest(cwd);
  const manifestMap = manifest.projectId === projectId && manifest.files ? manifest.files : {};

  const allPrepared = localFiles.map((item) => {
    const { hash, size, buffer } = computeFileSha256(item.absPath);
    const violation = scanFileForSecrets(item.relativePath, buffer);
    if (violation) {
      secretViolations.push({ path: item.relativePath, reason: violation });
    }
    const targetRemotePath =
      explicitRemotePath ||
      (item.relativePath.startsWith("/") ? item.relativePath : `/${item.relativePath}`);
    const manifestEntry = manifestMap[targetRemotePath] || null;
    const matchesLocalManifest =
      manifestEntry &&
      manifestEntry.contentHash &&
      manifestEntry.contentHash.toLowerCase() === hash.toLowerCase();

    return {
      absPath: item.absPath,
      path: targetRemotePath,
      relativePath: item.relativePath,
      contentHash: hash,
      size,
      mimeType: detectMimeType(targetRemotePath),
      buffer,
      manifestEntry,
      matchesLocalManifest: Boolean(matchesLocalManifest),
      fromMirror: Boolean(item.fromMirror),
    };
  });

  // Deduplicate by path (preferring .networkbase/mirror/ entries when present)
  const dedupedByPath = new Map();
  for (const item of allPrepared) {
    const prev = dedupedByPath.get(item.path);
    if (!prev || (item.fromMirror && !prev.fromMirror)) {
      dedupedByPath.set(item.path, item);
    }
  }
  const uniquePrepared = Array.from(dedupedByPath.values());

  // When scanning without explicit paths, if .networkbase/mirror/ has tracked files, scope default push to mirror/manifest files
  let preparedFiles = uniquePrepared;
  let skippedByLocalManifestCount = 0;
  if (targetPaths.length === 0 && !flags.all && Object.keys(manifestMap).length > 0) {
    const mirrorOrTracked = uniquePrepared.filter((f) => f.fromMirror || Boolean(f.manifestEntry));
    const candidatePool = mirrorOrTracked.length > 0 ? mirrorOrTracked : uniquePrepared;
    const locallyChanged = candidatePool.filter((f) => !f.matchesLocalManifest);
    if (locallyChanged.length > 0) {
      skippedByLocalManifestCount = candidatePool.length - locallyChanged.length;
      preparedFiles = locallyChanged;
    } else {
      preparedFiles = candidatePool;
    }
  }

  const taskId = inferActiveTaskId(flags, cwd);
  return {
    projectId,
    taskId,
    preparedFiles,
    allPreparedCount: preparedFiles.length + skippedByLocalManifestCount,
    skippedByLocalManifestCount,
    secretViolations,
  };
}

async function executePrePushAnalysis(targetPaths, flags, cwd = process.cwd()) {
  const {
    projectId,
    taskId,
    preparedFiles,
    allPreparedCount,
    skippedByLocalManifestCount,
    secretViolations,
  } = prepareLocalFilesForPush(targetPaths, flags, cwd);

  const analysis = await apiRequest("/api/v1/extension/pre-push", {
    method: "POST",
    body: {
      projectId,
      taskId,
      files: preparedFiles.slice(0, 200).map((f) => ({
        path: f.path,
        contentHash: f.contentHash,
        size: f.size,
      })),
    },
  });

  // Sync unchanged remote versions into local manifest cache
  if (analysis?.files?.length) {
    const unchangedRemote = analysis.files
      .filter((f) => f.status === "unchanged" && f.nodeId)
      .map((f) => {
        const local = preparedFiles.find((p) => p.path === f.path);
        return {
          path: f.path,
          nodeId: f.nodeId,
          version: f.currentVersion,
          contentHash: local?.contentHash,
          size: local?.size,
        };
      });
    if (unchangedRemote.length > 0) {
      updateManifestFiles(projectId, unchangedRemote, cwd);
    }
  }

  return {
    projectId,
    taskId,
    preparedFiles,
    allPreparedCount,
    skippedByLocalManifestCount,
    secretViolations,
    analysis,
  };
}

const FAST_PUSH_INLINE_LIMIT_BYTES = 4 * 1024 * 1024; // 4 MiB

async function executeFastPushRequest({
  projectId,
  taskId,
  selectedRole,
  transitionStatus,
  commitMessage,
  filesToPush,
  cwd = process.cwd(),
}) {
  const fastRes = await apiRequest("/api/v1/extension/fast-push", {
    method: "POST",
    headers: {
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: {
      projectId,
      taskId: taskId || null,
      role: selectedRole || "working",
      transitionStatus: transitionStatus || null,
      message: commitMessage,
      files: filesToPush.map((f) => ({
        path: f.path,
        contentHash: f.contentHash,
        size: f.size,
        mimeType: f.mimeType,
        contentBase64: f.buffer.toString("base64"),
        comment: commitMessage,
      })),
    },
  });

  if (fastRes?.files?.length) {
    updateManifestFiles(projectId, fastRes.files, cwd);
  }
  return fastRes;
}

async function handlePush(positional, flags, { skipHeader = false } = {}) {
  const cfg = getLocalConfig();
  if (!flags.json && !skipHeader && !flags["dry-run"]) {
    renderBrandHeader({
      subtitle: `High-EQ Smart Push · ${cfg.title || flags.workspace || "Workspace"}`,
    });
  }

  const explicitRole = resolveRoleFromFlags(flags);
  const transitionFromFlags = flags.done ? "done" : flags.wip ? "in_progress" : undefined;

  // ULTRA-FAST 1-ROUND-TRIP PATH:
  // When role is already specified (e.g. --deliverable / --draft / --reference / --json) and not dry-run,
  // skip /pre-push completely and execute atomic /fast-push in 1 single HTTP round-trip!
  if (!flags["dry-run"] && (explicitRole || flags.json || !process.stdin.isTTY)) {
    const {
      projectId,
      taskId,
      preparedFiles,
      allPreparedCount,
      skippedByLocalManifestCount,
      secretViolations,
    } = prepareLocalFilesForPush(positional, flags);

    if (secretViolations.length > 0 && !flags["allow-secrets"]) {
      const errPayload = {
        blockedBySecretGuard: true,
        violations: secretViolations,
        hint: "Remove the secrets or add them to .gitignore before pushing.",
      };
      outputResult(errPayload, flags, () => {
        console.error(`\n${STEP_ERR} ${c.red}Pre-Push Secret Guard blocked this push:${c.reset}`);
        for (const v of secretViolations) {
          console.error(`  - ${v.path}: ${v.reason}`);
        }
      });
      process.exitCode = 1;
      return;
    }

    if (
      preparedFiles.length > 0 &&
      preparedFiles.every((f) => f.matchesLocalManifest) &&
      !flags.force &&
      !taskId &&
      !transitionFromFlags
    ) {
      const cachedPayload = {
        pushed: false,
        fastPath: true,
        cachedByManifest: true,
        uploadedCount: 0,
        unchangedCount: allPreparedCount,
        files: preparedFiles.map((f) => ({
          path: f.path,
          nodeId: f.manifestEntry?.nodeId || null,
          status: "unchanged",
          previousVersion: f.manifestEntry?.version || 1,
          version: f.manifestEntry?.version || 1,
          versionTransition: `v${f.manifestEntry?.version || 1} (unchanged · 0ms local cache)`,
          contentHash: f.contentHash,
          size: f.size,
        })),
      };
      outputResult(cachedPayload, flags, (res) => {
        console.log(RAIL);
        console.log(
          `${STEP_DONE}  ${c.bold}${c.ink}All ${res.unchangedCount} file(s) already up to date${c.reset} ${c.muted}(0ms local SHA-256 manifest cache)${c.reset}`,
        );
        for (const f of res.files) {
          console.log(`${RAIL}    ${c.dim}•${c.reset} ${c.ink}${f.path}${c.reset} -> ${c.accent}${f.versionTransition}${c.reset}`);
        }
        console.log(`${c.dim}╰─${c.reset} ${STEP_DONE} Sync complete.\n`);
      });
      return cachedPayload;
    }

    const totalBytes = preparedFiles.reduce((acc, f) => acc + f.size, 0);
    const selectedRole = explicitRole || "working";
    const commitMessage =
      typeof flags.message === "string"
        ? flags.message
        : `Pushed via NetworkBase CLI (${selectedRole} update)`;

    if (preparedFiles.length <= 50 && totalBytes <= FAST_PUSH_INLINE_LIMIT_BYTES) {
      const fastPayload = await withSpinner(
        `Fast-pushing ${preparedFiles.length} file(s) to NetworkBase…`,
        () =>
          executeFastPushRequest({
            projectId,
            taskId,
            selectedRole,
            transitionStatus: transitionFromFlags,
            commitMessage,
            filesToPush: preparedFiles,
          }),
        { silent: Boolean(flags.json) },
      );

      const finalFast = {
        ...fastPayload,
        unchangedCount: (fastPayload.unchangedCount || 0) + skippedByLocalManifestCount,
      };

      outputResult(finalFast, flags, (res) => {
        console.log(RAIL);
        console.log(
          `${STEP_DONE}  ${c.bold}${c.ink}Pushed ${res.uploadedCount} changed file(s)${c.reset} ${c.muted}(${res.unchangedCount} unchanged · 1-RTT fast-path)${c.reset} ${
            res.role ? formatStatusBadge(res.role) : ""
          }`,
        );
        for (const f of res.files || []) {
          if (f.status !== "unchanged" || res.files.length <= 8) {
            console.log(`${RAIL}    • ${c.ink}${f.path}${c.reset} ${c.accent}-> ${f.versionTransition}${c.reset}`);
          }
        }
        if (res.taskPushReceipt) {
          console.log(
            `${c.dim}╰─${c.reset} ${c.emerald}✔${c.reset} Linked to Task ${c.muted}(${res.taskId})${c.reset} · Commit ${c.accent}${res.taskPushReceipt.commitSha?.slice(0, 10) || res.taskPushReceipt.pushId}${c.reset}\n`,
          );
        } else {
          console.log(`${c.dim}╰─${c.reset} ${c.emerald}✔${c.reset} Sync complete.\n`);
        }
      });
      return finalFast;
    }
  }

  const {
    projectId,
    taskId,
    preparedFiles,
    skippedByLocalManifestCount,
    secretViolations,
    analysis,
  } = await withSpinner(
    "Analyzing local files & SHA-256 manifest…",
    () => executePrePushAnalysis(positional, flags),
    { silent: Boolean(flags.json) },
  );

  if (secretViolations.length > 0 && !flags["allow-secrets"]) {
    const errPayload = {
      blockedBySecretGuard: true,
      violations: secretViolations,
      hint: "Remove the secrets or add them to .gitignore before pushing.",
    };
    outputResult(errPayload, flags, () => {
      console.error(`\n${STEP_ERR} ${c.red}Pre-Push Secret Guard blocked this push:${c.reset}`);
      for (const v of secretViolations) {
        console.error(`  - ${v.path}: ${v.reason}`);
      }
    });
    process.exitCode = 1;
    return;
  }

  if (flags["dry-run"]) {
    outputResult(
      {
        dryRun: true,
        ...analysis,
      },
      flags,
      (res) => {
        renderBrandHeader({ subtitle: `Pre-Push Analysis (${res.summary.totalFiles} file(s))` });
        console.log(RAIL);
        if (res.task) {
          console.log(
            `${RAIL}  Linked Task: ${c.bold}${c.ink}${res.task.taskNumber ? `#${res.task.taskNumber} ` : ""}${res.task.title}${c.reset} ${formatStatusBadge(res.task.status)}`,
          );
        }
        for (const f of res.files) {
          const lockNote = f.lockedByTeammate ? ` ${c.red}⚠ LOCKED by ${f.lockedByTeammate.name}${c.reset}` : "";
          console.log(
            `${RAIL}  ${f.status.toUpperCase().padEnd(9)} ${c.ink}${f.path}${c.reset} ${c.accent}(${f.versionTransition})${c.reset}${lockNote}`,
          );
        }
        console.log(`${RAIL}\n${RAIL}  ${c.muted}Delivery Intent Options:${c.reset}`);
        console.log(`${RAIL}    --deliverable  ${formatStatusBadge("deliverable")}`);
        console.log(`${RAIL}    --draft        ${formatStatusBadge("working")}`);
        console.log(`${RAIL}    --reference    ${formatStatusBadge("reference")}`);
        console.log(`${c.dim}╰─${c.reset}\n`);
      },
    );
    return;
  }

  if (!analysis.summary.canPushCleanly) {
    const locked = analysis.files.filter((f) => f.lockedByTeammate);
    throw new Error(
      `Cannot push: ${locked.map((l) => `${l.path} is locked by ${l.lockedByTeammate.name}`).join(", ")}`,
    );
  }

  const changedAnalysisFiles = analysis.files.filter((f) => f.status !== "unchanged");
  let selectedPathsSet = new Set(changedAnalysisFiles.map((f) => f.path));

  let selectedRole = explicitRole;

  // Interactive Multi-File Selection & Role Classification when running in a terminal without flags
  if (process.stdin.isTTY && !flags.json && !selectedRole) {
    if (changedAnalysisFiles.length > 1) {
      const chosenPaths = await tuiMultiSelect({
        title: "Select changed files to include in this push",
        stepLabel: "Files Selected",
        items: changedAnalysisFiles.map((f) => {
          const prep = preparedFiles.find((p) => p.path === f.path);
          const statusTag =
            f.status === "new"
              ? `${c.emerald}NEW${c.reset}`
              : `${c.amber}MODIFIED${c.reset}`;
          return {
            label: f.path,
            badge: `${statusTag} ${c.accent}(${f.versionTransition})${c.reset}`,
            hint: prep ? formatBytes(prep.size) : "",
            value: f.path,
          };
        }),
      });
      selectedPathsSet = new Set(chosenPaths);
    } else if (changedAnalysisFiles.length === 1) {
      const single = changedAnalysisFiles[0];
      printStepDone("File to Push", `${single.path} (${single.versionTransition})`);
    } else {
      printStepDone("Files", `All ${analysis.files.length} file(s) already match remote SHA-256`);
    }

    const taskContextLabel = analysis.task
      ? `for Task ${analysis.task.taskNumber ? `#${analysis.task.taskNumber}` : analysis.task.title}`
      : "for this Workspace push";

    selectedRole = await tuiSelect({
      title: `How should NetworkBase classify this delivery ${taskContextLabel}?`,
      stepLabel: "Delivery Role",
      items: [
        {
          label: "Final Deliverable",
          summaryLabel: "Final Deliverable [Final file]",
          badge: formatStatusBadge("deliverable"),
          description: "Production-ready output · promotes file badge to Final file (#deliverable)",
          value: "deliverable",
        },
        {
          label: "Working Draft",
          summaryLabel: "Working Draft [Draft file]",
          badge: formatStatusBadge("working"),
          description: "Work-in-progress checkpoint · keeps task In Progress (#editor_working)",
          value: "working",
        },
        {
          label: "Reference Material",
          summaryLabel: "Reference Material [Reference]",
          badge: formatStatusBadge("reference"),
          description: "Architecture specification, benchmark, or reference doc (#reference)",
          value: "reference",
        },
      ],
    });
  } else if (!selectedRole) {
    selectedRole = "working";
  }

  const filesToUpload = preparedFiles.filter((f) => selectedPathsSet.has(f.path));

  let transitionStatus = transitionFromFlags;
  if (
    taskId &&
    selectedRole === "deliverable" &&
    !transitionStatus &&
    process.stdin.isTTY &&
    !flags.json
  ) {
    const taskTitle = analysis.task?.title || taskId;
    const markDone = await tuiConfirm({
      title: `Mark linked task ("${taskTitle}") as Done?`,
      stepLabel: "Task Status",
      yesLabel: "Yes, mark Done",
      noLabel: "No, keep In Progress",
      initialValue: false,
    });
    if (markDone) {
      transitionStatus = "done";
    }
  }

  const commitMessage =
    typeof flags.message === "string"
      ? flags.message
      : `Pushed via NetworkBase CLI (${selectedRole || "workspace"} update)`;

  const totalUploadBytes = filesToUpload.reduce((acc, f) => acc + f.size, 0);

  // Use atomic 1-call /fast-push after interactive selection when payload <= 4 MiB
  if (filesToUpload.length <= 50 && totalUploadBytes <= FAST_PUSH_INLINE_LIMIT_BYTES) {
    const filesForFastPush = filesToUpload.length > 0 ? filesToUpload : preparedFiles.slice(0, 50);
    const fastPayload = await withSpinner(
      `Committing ${filesToUpload.length} file(s) to NetworkBase…`,
      () =>
        executeFastPushRequest({
          projectId,
          taskId,
          selectedRole,
          transitionStatus,
          commitMessage,
          filesToPush: filesForFastPush,
        }),
      { silent: Boolean(flags.json) },
    );

    const finalFast = {
      ...fastPayload,
      unchangedCount:
        (fastPayload.unchangedCount || 0) +
        skippedByLocalManifestCount +
        Math.max(0, preparedFiles.length - filesForFastPush.length),
    };

    outputResult(finalFast, flags, (res) => {
      console.log(RAIL);
      console.log(
        `${STEP_DONE}  ${c.bold}${c.ink}Pushed ${res.uploadedCount} changed file(s)${c.reset} ${c.muted}(${res.unchangedCount} unchanged)${c.reset} ${
          res.role ? formatStatusBadge(res.role) : ""
        }`,
      );
      for (const f of res.files || []) {
        if (f.status !== "unchanged" || res.files.length <= 8) {
          console.log(`${RAIL}    • ${c.ink}${f.path}${c.reset} ${c.accent}-> ${f.versionTransition}${c.reset}`);
        }
      }
      if (res.taskPushReceipt) {
        console.log(
          `${c.dim}╰─${c.reset} ${c.emerald}✔${c.reset} Linked to Task ${c.muted}(${res.taskId})${c.reset} · Commit ${c.accent}${res.taskPushReceipt.commitSha?.slice(0, 10) || res.taskPushReceipt.pushId}${c.reset}\n`,
        );
      } else {
        console.log(`${c.dim}╰─${c.reset} ${c.emerald}✔${c.reset} Sync complete.\n`);
      }
    });
    return finalFast;
  }

  // Fallback for large binary batches (> 4 MiB): parallel signed upload + parallel finalize
  const creds = getCredentials();
  const finalizedMap = new Map();

  if (filesToUpload.length > 0) {
    await withSpinner(
      `Uploading & finalizing ${filesToUpload.length} large file(s) to NetworkBase…`,
      async () => {
        for (let i = 0; i < filesToUpload.length; i += 50) {
          const batch = filesToUpload.slice(i, i + 50);
          const intentRes = await apiRequest("/api/v1/extension/bulk-intent", {
            method: "POST",
            body: {
              projectId,
              clientSessionId: creds.clientSessionId,
              files: batch.map((f) => ({
                path: f.path,
                size: f.size,
                mimeType: f.mimeType,
                contentHash: f.contentHash,
                comment: commitMessage,
              })),
            },
          });

          await Promise.all(
            intentRes.files.map(async (slot) => {
              const localFile = batch.find((b) => b.path === slot.path);
              const putRes = await fetch(slot.uploadUrl, {
                method: "PUT",
                headers: {
                  "Content-Type": localFile.mimeType,
                },
                body: localFile.buffer,
              });
              if (!putRes.ok) {
                throw new Error(`Failed uploading ${slot.path} to storage (HTTP ${putRes.status})`);
              }
            }),
          );

          const finalizeRes = await apiRequest("/api/v1/extension/bulk-finalize", {
            method: "POST",
            body: {
              projectId,
              uploadSessionId: intentRes.uploadSessionId,
              files: intentRes.files.map((slot) => {
                const localFile = batch.find((b) => b.path === slot.path);
                return {
                  path: slot.path,
                  uploadIntentId: slot.uploadIntentId,
                  checksum: localFile.contentHash,
                  comment: commitMessage,
                };
              }),
            },
          });

          for (const fin of finalizeRes.files || []) {
            finalizedMap.set(fin.path, fin);
          }
        }
      },
      { silent: Boolean(flags.json) },
    );
  }

  if (finalizedMap.size > 0) {
    updateManifestFiles(projectId, Array.from(finalizedMap.values()));
  }

  // Also include unchanged files when linking to a task if the user explicitly pushed them
  const allTaskFiles = analysis.files
    .map((f) => {
      const fin = finalizedMap.get(f.path);
      if (fin) {
        return {
          nodeId: fin.nodeId,
          version: fin.version,
          contentHash: fin.contentHash,
          role: selectedRole || "working",
        };
      }
      const local = preparedFiles.find((p) => p.path === f.path);
      if (f.nodeId && local) {
        return {
          nodeId: f.nodeId,
          version: f.currentVersion || 1,
          contentHash: local.contentHash,
          role: selectedRole || "working",
        };
      }
      return null;
    })
    .filter(Boolean);

  let taskPushReceipt = null;
  if (taskId && allTaskFiles.length > 0) {
    taskPushReceipt = await withSpinner(
      "Linking delivery to Sprint Task…",
      () =>
        apiRequest("/api/v1/extension/task-push", {
          method: "POST",
          headers: {
            "Idempotency-Key": crypto.randomUUID(),
          },
          body: {
            taskId,
            projectId,
            taskAction: selectedRole === "deliverable" ? "replace_task_version" : "upload_to_task",
            role: selectedRole || "working",
            transitionStatus,
            message: commitMessage,
            files: allTaskFiles,
          },
        }),
      { silent: Boolean(flags.json) },
    );
  }

  const finalPayload = {
    success: true,
    projectId,
    taskId: taskId || null,
    role: selectedRole || null,
    transitionStatus: transitionStatus || null,
    uploadedCount: filesToUpload.length,
    unchangedCount: preparedFiles.length - filesToUpload.length + skippedByLocalManifestCount,
    taskPushReceipt,
    files: analysis.files.map((f) => {
      const fin = finalizedMap.get(f.path);
      return {
        path: f.path,
        status: f.status,
        version: fin ? fin.version : f.currentVersion,
        versionTransition: fin
          ? f.status === "new"
            ? "v1 (new)"
            : `v${f.currentVersion} -> v${fin.version}`
          : f.versionTransition,
      };
    }),
  };

  outputResult(finalPayload, flags, (res) => {
    console.log(RAIL);
    console.log(
      `${STEP_DONE}  ${c.bold}${c.ink}Pushed ${res.uploadedCount} changed file(s)${c.reset} ${c.muted}(${res.unchangedCount} unchanged)${c.reset} ${
        res.role ? formatStatusBadge(res.role) : ""
      }`,
    );
    for (const f of res.files) {
      if (f.status !== "unchanged" || res.files.length <= 8) {
        console.log(`${RAIL}    • ${c.ink}${f.path}${c.reset} ${c.accent}-> ${f.versionTransition}${c.reset}`);
      }
    }
    if (res.taskPushReceipt) {
      console.log(
        `${c.dim}╰─${c.reset} ${c.emerald}✔${c.reset} Linked to Task ${c.muted}(${res.taskId})${c.reset} · Commit ${c.accent}${res.taskPushReceipt.commitSha?.slice(0, 10) || res.taskPushReceipt.pushId}${c.reset}\n`,
      );
    } else {
      console.log(`${c.dim}╰─${c.reset} ${c.emerald}✔${c.reset} Sync complete.\n`);
    }
  });

  return finalPayload;
}

async function handlePull(positional, flags, { skipHeader = false } = {}) {
  const cfg = getLocalConfig();
  const projectId = flags.workspace || cfg.projectId;
  if (!projectId) throw new Error("No workspace linked. Run `nb init` first.");

  if (!flags.json && !skipHeader) {
    renderBrandHeader({ subtitle: `Pull Workspace Files · ${cfg.title || projectId}` });
  }

  const filterPaths = positional.map((p) => (p.startsWith("/") ? p : `/${p}`));
  const outOverride = typeof flags.out === "string" && filterPaths.length === 1 ? flags.out : null;

  // DIRECT-PATH FAST-PATH:
  // When explicit file path(s) (not directory prefixes ending in "/") are provided,
  // download them directly in 1 round-trip without calling /api/v1/extension/search first!
  const allExplicitFilePaths =
    filterPaths.length > 0 && filterPaths.every((fp) => !fp.endsWith("/") && path.extname(fp).length > 0);

  if (allExplicitFilePaths) {
    let downloadedCount = 0;
    let skippedUnchangedCount = 0;
    const manifestUpdates = [];

    await withSpinner(
      `Fast-pulling ${filterPaths.length} file(s) from NetworkBase…`,
      async () => {
        await Promise.all(
          filterPaths.map(async (normPath) => {
            const localDest = outOverride
              ? path.resolve(process.cwd(), outOverride)
              : path.join(process.cwd(), normPath.replace(/^\/+/, ""));
            let localHash = null;
            if (!flags.force && fs.existsSync(localDest)) {
              try {
                localHash = computeFileSha256(localDest).hash;
              } catch {
                localHash = null;
              }
            }
            const { notModified, buffer, meta } = await downloadRemoteFileBuffer(projectId, normPath, {
              ifNoneMatch: localHash,
            });
            if (notModified || !buffer) {
              skippedUnchangedCount++;
              return;
            }
            ensureDir(path.dirname(localDest));
            fs.writeFileSync(localDest, buffer);
            downloadedCount++;
            manifestUpdates.push({
              path: normPath,
              nodeId: meta?.nodeId,
              version: meta?.currentVersion || 1,
              contentHash: meta?.contentHash || crypto.createHash("sha256").update(buffer).digest("hex"),
              size: buffer.length,
            });
          }),
        );
      },
      { silent: Boolean(flags.json) },
    );

    if (manifestUpdates.length > 0) {
      updateManifestFiles(projectId, manifestUpdates);
    }

    outputResult(
      {
        projectId,
        downloadedCount,
        skippedUnchangedCount,
        totalRemoteFiles: filterPaths.length,
        fastPath: true,
      },
      flags,
      (res) => {
        console.log(
          `${RAIL}\n${c.dim}╰─${c.reset} ${c.emerald}✔${c.reset} Pulled ${c.bold}${c.ink}${res.downloadedCount} file(s)${c.reset}${
            res.skippedUnchangedCount > 0 ? ` ${c.muted}(${res.skippedUnchangedCount} already up to date · HTTP 304)${c.reset}` : ""
          } from workspace ${c.muted}(${cfg.title || res.projectId} · 1-RTT fast-path)${c.reset}\n`,
        );
      },
    );
    return;
  }

  const searchQuery = positional.length === 1 ? path.basename(positional[0]) : "";
  const remoteFiles = await withSpinner(
    "Fetching remote workspace manifest…",
    () => fetchWorkspaceFiles(projectId, searchQuery),
    { silent: Boolean(flags.json) },
  );

  const targets =
    filterPaths.length > 0
      ? remoteFiles.filter((f) => filterPaths.some((fp) => f.path === fp || f.path.startsWith(`${fp.replace(/\/+$/, "")}/`)))
      : remoteFiles;

  if (targets.length === 0) {
    throw new Error(
      filterPaths.length > 0
        ? `No matching remote file(s) found for: ${filterPaths.join(", ")}`
        : "No remote files found in workspace.",
    );
  }

  // Deduplicate against local files / manifest unless --force is passed
  const filesToDownload = [];
  let skippedUnchangedCount = 0;

  for (const node of targets) {
    const localDest = outOverride
      ? path.resolve(process.cwd(), outOverride)
      : path.join(process.cwd(), node.path.replace(/^\/+/, ""));
    if (!flags.force && node.contentHash && fs.existsSync(localDest)) {
      try {
        const { hash } = computeFileSha256(localDest);
        if (hash.toLowerCase() === node.contentHash.toLowerCase()) {
          skippedUnchangedCount++;
          continue;
        }
      } catch {
        // Proceed to download if local read fails
      }
    }
    filesToDownload.push({ node, localDest });
  }

  let downloadedCount = 0;
  const manifestUpdates = [...targets];

  if (filesToDownload.length > 0) {
    await withSpinner(
      `Downloading ${filesToDownload.length} changed file(s) in parallel (${skippedUnchangedCount} unchanged)…`,
      async () => {
        for (let offset = 0; offset < filesToDownload.length; offset += 8) {
          const chunk = filesToDownload.slice(offset, offset + 8);
          await Promise.all(
            chunk.map(async ({ node, localDest }) => {
              const { buffer } = await downloadRemoteFileBuffer(projectId, node.path);
              ensureDir(path.dirname(localDest));
              fs.writeFileSync(localDest, buffer);
              downloadedCount++;
            }),
          );
        }
      },
      { silent: Boolean(flags.json) },
    );
  }

  updateManifestFiles(projectId, manifestUpdates);

  outputResult(
    { projectId, downloadedCount, skippedUnchangedCount, totalRemoteFiles: remoteFiles.length },
    flags,
    (res) => {
      console.log(
        `${RAIL}\n${c.dim}╰─${c.reset} ${c.emerald}✔${c.reset} Pulled ${c.bold}${c.ink}${res.downloadedCount} changed file(s)${c.reset} ${c.muted}(${res.skippedUnchangedCount} already up to date)${c.reset} from ${c.bold}${c.ink}${cfg.title || res.projectId}${c.reset}\n`,
      );
    },
  );
}

async function hydrateWorkspaceMirror(projectId, { cwd = process.cwd(), force = false } = {}) {
  const mirrorDir = getLocalMirrorDir(cwd);
  ensureDir(mirrorDir);
  const remoteFiles = await fetchWorkspaceFiles(projectId, "");
  const manifest = getLocalManifest(cwd);
  const manifestFiles = manifest.projectId === projectId && manifest.files ? manifest.files : {};

  const inlineCandidates = remoteFiles.filter((node) => (node.size ?? 0) <= 512 * 1024);
  const toDownload = [];
  let upToDateCount = 0;

  for (const node of inlineCandidates) {
    const cleanRel = node.path.replace(/^\/+/, "");
    const mirrorDest = path.join(mirrorDir, cleanRel);
    const expectedHash = (node.contentHash || manifestFiles[node.path]?.contentHash || "").toLowerCase();
    if (!force && expectedHash && fs.existsSync(mirrorDest)) {
      try {
        const localHash = computeFileSha256(mirrorDest).hash.toLowerCase();
        if (localHash === expectedHash) {
          upToDateCount++;
          continue;
        }
      } catch {
        // Re-download if unreadable
      }
    }
    toDownload.push({ node, mirrorDest });
  }

  let downloadedCount = 0;
  const manifestUpdates = [...remoteFiles];

  for (let offset = 0; offset < toDownload.length; offset += 8) {
    const chunk = toDownload.slice(offset, offset + 8);
    await Promise.all(
      chunk.map(async ({ node, mirrorDest }) => {
        try {
          const { buffer, meta } = await downloadRemoteFileBuffer(projectId, node.path);
          if (buffer) {
            ensureDir(path.dirname(mirrorDest));
            fs.writeFileSync(mirrorDest, buffer);
            downloadedCount++;
            manifestUpdates.push({
              path: node.path,
              nodeId: meta?.nodeId || node.id,
              version: meta?.currentVersion || node.currentVersion || 1,
              contentHash:
                meta?.contentHash || node.contentHash || crypto.createHash("sha256").update(buffer).digest("hex"),
              size: buffer.length,
            });
          }
        } catch {
          // Skip unavailable binary/oversized file in mirror hydration
        }
      }),
    );
  }

  updateManifestFiles(projectId, manifestUpdates, cwd);
  return {
    mirrorDir,
    downloadedCount,
    upToDateCount,
    totalRemoteFiles: remoteFiles.length,
  };
}

async function handleSync(positional, flags) {
  const cwd = process.cwd();
  let cfg = getLocalConfig(cwd);

  // Allow switching workspace in the same single `nb sync --workspace <slug-or-id>` call
  if (typeof flags.workspace === "string" && flags.workspace.trim() && flags.workspace !== cfg.projectId) {
    await handleInit([flags.workspace.trim()], { ...flags, "no-task": true, silent: true }, { skipHeader: true });
    cfg = getLocalConfig(cwd);
  }

  const projectId = cfg.projectId;
  if (!projectId) {
    throw new Error("No workspace linked. Run `nb init` first.");
  }

  if (!flags.json) {
    renderBrandHeader({ subtitle: `Unified One-Permission Sync · ${cfg.title || projectId}` });
  }

  const selectedRole = resolveRoleFromFlags(flags) || "deliverable";
  const transitionStatus = flags.done ? "done" : flags.wip ? "in_progress" : undefined;
  const taskId = inferActiveTaskId(flags, cwd);
  const commitMessage =
    typeof flags.message === "string"
      ? flags.message
      : `Synced via NetworkBase CLI (${selectedRole})`;

  // 1. Check for locally modified files in .networkbase/mirror/ or explicit positional paths
  let pushResult = null;
  const mirrorDir = getLocalMirrorDir(cwd);
  const hasMirrorOrTargets = positional.length > 0 || fs.existsSync(mirrorDir);

  if (hasMirrorOrTargets && !flags["pull-only"]) {
    try {
      const { preparedFiles, secretViolations } = prepareLocalFilesForPush(
        positional,
        { ...flags, scope: positional.length === 0 && fs.existsSync(mirrorDir) ? mirrorDir : flags.scope },
        cwd,
      );
      const changedLocal = preparedFiles.filter((f) => !f.matchesLocalManifest);
      if (secretViolations.length === 0 && changedLocal.length > 0) {
        const totalBytes = changedLocal.reduce((acc, f) => acc + f.size, 0);
        if (changedLocal.length <= 50 && totalBytes <= FAST_PUSH_INLINE_LIMIT_BYTES) {
          pushResult = await withSpinner(
            `Fast-pushing ${changedLocal.length} modified file(s) to ${cfg.title || projectId}…`,
            () =>
              executeFastPushRequest({
                projectId,
                taskId,
                selectedRole,
                transitionStatus,
                commitMessage,
                filesToPush: changedLocal,
                cwd,
              }),
            { silent: Boolean(flags.json) },
          );
          saveLastSyncReceipt(
            {
              status: "pushed",
              projectId,
              uploadedCount: pushResult.uploadedCount,
              files: pushResult.files,
            },
            cwd,
          );
        }
      }
    } catch {
      // No local files yet; proceed to mirror hydration
    }
  }

  // 2. Hydrate .networkbase/mirror/ and .networkbase/tasks/TASKS.md in parallel
  const [mirrorResult, taskData] = await withSpinner(
    `Syncing workspace mirror (.networkbase/mirror/) & task briefing (.networkbase/tasks/TASKS.md)…`,
    () =>
      Promise.all([
        hydrateWorkspaceMirror(projectId, { cwd, force: Boolean(flags.force) }),
        apiRequest(`/api/v1/extension/workspace-tasks?projectId=${projectId}&scope=all`).catch(() => ({
          tasks: [],
        })),
      ]),
    { silent: Boolean(flags.json) },
  );

  const tasksList = taskData?.tasks || [];
  writeLocalTaskIntelligence(projectId, cfg.title || projectId, tasksList, cwd);

  // 3. Ensure background auto-sync daemon is running for 0-permission auto-push on save
  const daemon = flags["no-daemon"] ? { running: false } : ensureBackgroundDaemon(projectId, cwd);

  const payload = {
    synced: true,
    projectId,
    workspaceTitle: cfg.title || projectId,
    mirrorDir: mirrorResult.mirrorDir,
    tasksBriefingPath: path.join(getLocalTasksDir(cwd), "TASKS.md"),
    tasksCount: tasksList.length,
    pushedCount: pushResult?.uploadedCount || 0,
    pushedFiles: pushResult?.files || [],
    pulledCount: mirrorResult.downloadedCount,
    upToDateCount: mirrorResult.upToDateCount,
    totalRemoteFiles: mirrorResult.totalRemoteFiles,
    daemonRunning: daemon.running,
    daemonPid: daemon.pid || null,
  };

  outputResult(payload, flags, (res) => {
    console.log(RAIL);
    if (res.pushedCount > 0) {
      console.log(
        `${STEP_DONE}  ${c.bold}${c.ink}Pushed ${res.pushedCount} modified file(s)${c.reset} ${formatStatusBadge(selectedRole)}`,
      );
      for (const f of res.pushedFiles) {
        if (f.status !== "unchanged") {
          console.log(`${RAIL}    • ${c.ink}${f.path}${c.reset} ${c.accent}-> ${f.versionTransition}${c.reset}`);
        }
      }
    }
    console.log(
      `${STEP_DONE}  ${c.bold}${c.ink}Local Mirror Ready${c.reset} ${c.muted}(.networkbase/mirror/ · ${res.pulledCount} pulled, ${res.upToDateCount} up to date)${c.reset}`,
    );
    console.log(
      `${STEP_DONE}  ${c.bold}${c.ink}Task Briefing Synced${c.reset} ${c.muted}(.networkbase/tasks/TASKS.md · ${res.tasksCount} task(s) with subtasks & attached files)${c.reset}`,
    );
    if (res.daemonRunning) {
      console.log(
        `${STEP_DONE}  ${c.bold}${c.ink}Auto-Sync Daemon Active${c.reset} ${c.muted}(PID ${res.daemonPid} · edits in .networkbase/mirror/ auto-push in <400ms with 0 prompts)${c.reset}`,
      );
    }
    console.log(`${c.dim}╰─${c.reset} ${c.emerald}✔${c.reset} Sync complete.\n`);
  });

  return payload;
}

async function handleWatch(positional, flags) {
  const cwd = process.cwd();
  const cfg = getLocalConfig(cwd);
  const projectId = flags.workspace || cfg.projectId;
  if (!projectId) throw new Error("No workspace linked. Run `nb init` first.");

  const isDaemonWorker = Boolean(flags["daemon-worker"]);
  const role = resolveRoleFromFlags(flags) || "deliverable";
  const taskId = inferActiveTaskId(flags, cwd);
  const mirrorDir = getLocalMirrorDir(cwd);
  ensureDir(mirrorDir);
  const watchTarget = positional[0] ? path.resolve(cwd, positional[0]) : mirrorDir;

  if (!isDaemonWorker) {
    renderBrandHeader({
      subtitle: `Live Auto-Sync Watch · ${cfg.title || projectId}`,
      contextRows: [
        { label: "Watching", value: `${c.ink}${watchTarget}${c.reset}` },
        { label: "Default Role", value: formatStatusBadge(role) },
        { label: "Press", value: `${c.muted}Ctrl+C to stop watching${c.reset}` },
      ],
    });
  }

  const pendingPaths = new Set();
  let debounceTimer = null;

  const flushChanges = async () => {
    const changed = Array.from(pendingPaths);
    pendingPaths.clear();
    if (changed.length === 0) return;

    try {
      const prepared = [];
      for (const absPath of changed) {
        if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) continue;
        const { hash, size, buffer } = computeFileSha256(absPath);
        if (size > FAST_PUSH_INLINE_LIMIT_BYTES) continue;

        const isMirrorFile = absPath.startsWith(mirrorDir + path.sep);
        const rel = isMirrorFile
          ? path.relative(mirrorDir, absPath).replace(/\\/g, "/")
          : path.relative(cwd, absPath).replace(/\\/g, "/");
        if (!isMirrorFile && (rel.startsWith(".networkbase/") || rel.startsWith(".git/"))) continue;
        if (scanFileForSecrets(rel, buffer)) continue;

        const normPath = rel.startsWith("/") ? rel : `/${rel}`;
        const existingHash = getLocalManifest(cwd)?.files?.[normPath]?.contentHash;
        if (existingHash && existingHash.toLowerCase() === hash.toLowerCase()) continue;

        prepared.push({
          path: normPath,
          contentHash: hash,
          size,
          mimeType: detectMimeType(normPath),
          buffer,
        });
      }

      if (prepared.length === 0) return;

      const res = await executeFastPushRequest({
        projectId,
        taskId: inferActiveTaskId(flags, cwd),
        selectedRole: role,
        transitionStatus: undefined,
        commitMessage: `Auto-synced via NetworkBase CLI (${role})`,
        filesToPush: prepared,
        cwd,
      });

      saveLastSyncReceipt(
        {
          status: "synced",
          projectId,
          uploadedCount: res.uploadedCount,
          files: res.files,
        },
        cwd,
      );

      if (!isDaemonWorker) {
        for (const f of res.files || []) {
          if (f.status !== "unchanged") {
            printStepDone("Auto-Synced", `${f.path} (${f.versionTransition})`);
          }
        }
      }
    } catch (err) {
      saveLastSyncReceipt(
        {
          status: "error",
          projectId,
          error: err instanceof Error ? err.message : String(err),
        },
        cwd,
      );
      if (!isDaemonWorker) {
        console.error(
          `${RAIL}  ${STEP_ERR} ${c.red}Auto-sync error: ${err instanceof Error ? err.message : String(err)}${c.reset}`,
        );
      }
    }
  };

  fs.watch(watchTarget, { recursive: true }, (_eventType, filename) => {
    if (!filename) return;
    const rel = String(filename).replace(/\\/g, "/");
    const parts = rel.split("/");
    if (parts.some((p) => IGNORED_DIRS.has(p) || p.startsWith("."))) return;
    const absPath = path.resolve(watchTarget, rel);
    pendingPaths.add(absPath);
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(flushChanges, 180);
  });

  await new Promise(() => {});
}

async function handleInteractiveHub(flags) {
  const creds = getCredentials();
  const localCfg = getLocalConfig();
  const localState = getLocalState();
  const apiUrl = await resolveBestApiUrl(localCfg?.apiUrl || creds?.apiUrl);

  let sessionInfo = { active: false, user: null, sessionId: null, tokenType: null };
  if (creds?.token) {
    try {
      sessionInfo = await apiRequest("/api/v1/extension/session", { apiUrl, token: creds.token });
    } catch {
      sessionInfo = { active: false };
    }
  }

  if (!sessionInfo.active || !localCfg?.projectId) {
    renderBrandHeader({
      subtitle: "Welcome · Let's connect this folder to NetworkBase",
    });
    const shouldSetup = await tuiConfirm({
      title: !sessionInfo.active
        ? "Sign in and link this folder to a NetworkBase workspace now?"
        : "Link this folder to a NetworkBase workspace now?",
      stepLabel: "Quick Setup",
      yesLabel: "Yes, start setup",
      noLabel: "No, exit",
      initialValue: true,
    });
    if (shouldSetup) {
      await handleInit([], flags, { skipHeader: true });
    } else {
      console.log(`${c.dim}╰─${c.reset} Run ${c.accent}nb init${c.reset} whenever you're ready.\n`);
    }
    return;
  }

  const localFilesCount = collectLocalFiles([], process.cwd()).length;
  const identity = `${c.emerald}●${c.reset} ${c.bold}${c.ink}${sessionInfo.user?.username ? `@${sessionInfo.user.username}` : sessionInfo.user?.email || sessionInfo.sessionId}${c.reset} ${c.muted}(${sessionInfo.tokenType || creds?.tokenType || "device"})${c.reset}`;
  const wsDisplay = `${c.bold}${c.ink}${localCfg.title || localCfg.projectId}${c.reset} ${c.muted}(${localCfg.slug || localCfg.projectId.slice(0, 8)})${c.reset}`;
  const taskDisplay = localState?.activeTaskId
    ? `${c.ink}${localState.activeTaskTitle || localState.activeTaskId}${c.reset} ${formatStatusBadge("in_progress")}`
    : `${c.muted}None bound${c.reset}`;

  renderBrandHeader({
    subtitle: `Connected to ${apiUrl}`,
    contextRows: [
      { label: "Account", value: identity },
      { label: "Workspace", value: wsDisplay },
      { label: "Active Task", value: taskDisplay },
      { label: "Local Tree", value: `${c.ink}${localFilesCount} tracked file(s)${c.reset}` },
    ],
  });

  const action = await tuiSelect({
    title: "What would you like to do?",
    stepLabel: "Action",
    allowCancel: true,
    items: [
      {
        label: "Push local files to NetworkBase",
        badge: `${c.emerald}[Smart Push]${c.reset}`,
        description: "Compare SHA-256, select files, and classify as Final Deliverable / Draft / Reference",
        value: "push",
      },
      {
        label: "Switch or bind an Active Sprint Task",
        badge: `${c.accent}[Tasks]${c.reset}`,
        description: `Pick an open task from ${localCfg.title || "this workspace"}`,
        value: "task",
      },
      {
        label: "Pull latest files from Workspace",
        badge: `${c.muted}[Sync Down]${c.reset}`,
        description: "Download remote workspace files into this directory",
        value: "pull",
      },
      {
        label: "Live Auto-Sync Watch Mode",
        badge: `${c.emerald}[nb watch]${c.reset}`,
        description: "Automatically push saved file edits in milliseconds (0ms local SHA-256 diff)",
        value: "watch",
      },
      {
        label: "Inspect remote files & version diffs",
        badge: `${c.muted}[Diff & Tree]${c.reset}`,
        description: "Compare local files against remote v1/v2 versions",
        value: "diff",
      },
      {
        label: "Switch linked Workspace",
        badge: `${c.muted}[Workspace]${c.reset}`,
        description: "Connect this folder to a different NetworkBase workspace",
        value: "workspace",
      },
      {
        label: "Re-authenticate or switch Account",
        badge: `${c.muted}[Auth]${c.reset}`,
        description: "Sign in via Web Browser (/authorize) or Personal Access Token",
        value: "reauth",
      },
      {
        label: "Exit",
        value: "exit",
      },
    ],
  });

  if (!action || action === "exit") {
    console.log(`${c.dim}╰─${c.reset} Bye!\n`);
    return;
  }

  if (action === "push") {
    await handlePush([], flags, { skipHeader: true });
    return;
  }
  if (action === "task") {
    await handleTask("work", [], flags);
    return;
  }
  if (action === "pull") {
    await handlePull([], flags, { skipHeader: true });
    return;
  }
  if (action === "watch") {
    await handleWatch([], flags);
    return;
  }
  if (action === "diff") {
    await handleFile("diff", [], flags);
    return;
  }
  if (action === "workspace") {
    await handleInit([], flags, { skipHeader: true });
    return;
  }
  if (action === "reauth") {
    await handleAuth("login", [], flags);
  }
}

async function handleHookInstall(flags) {
  const gitHooksDir = path.join(process.cwd(), ".git", "hooks");
  if (!fs.existsSync(gitHooksDir)) {
    throw new Error("No .git/hooks directory found in current working directory.");
  }
  const hookPath = path.join(gitHooksDir, "pre-push");
  const script = `#!/bin/sh
# NetworkBase Pre-Push Secret & Version Guard
nb push --dry-run
`;
  fs.writeFileSync(hookPath, script, { mode: 0o755 });
  outputResult({ installed: true, hookPath }, flags, () => {
    console.log(`✔ Installed NetworkBase pre-push guard at ${hookPath}`);
  });
}

// ============================================================================
// BUILT-IN MCP SERVER (`nb mcp`) FOR AI PAIR PROGRAMMERS (Antigravity, Codex, Claude)
// ============================================================================

async function startMcpServer() {
  const rl = readline.createInterface({
    input: process.stdin,
    terminal: false,
  });

  function sendJsonRpc(id, result, error = null) {
    const response = error
      ? { jsonrpc: "2.0", id, error }
      : { jsonrpc: "2.0", id, result };
    process.stdout.write(JSON.stringify(response) + "\n");
  }

  rl.on("line", async (line) => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }

    const { id, method, params } = msg;

    try {
      if (method === "initialize") {
        sendJsonRpc(id, {
          protocolVersion: "2024-11-05",
          serverInfo: { name: "networkbase-cli-mcp", version: CLI_VERSION },
          capabilities: { tools: {} },
        });
        return;
      }

      if (method === "tools/list") {
        sendJsonRpc(id, {
          tools: [
            {
              name: "nb_auth_status",
              description:
                "Check current NetworkBase CLI authentication status, signed-in user, linked workspace, and active task.",
              inputSchema: { type: "object", properties: {} },
            },
            {
              name: "nb_auth_login",
              description:
                "Authenticate the NetworkBase CLI. If no token is provided, opens the user's browser to `/authorize` for 1-click approval.",
              inputSchema: {
                type: "object",
                properties: {
                  method: {
                    type: "string",
                    enum: ["browser", "token"],
                    description: "Use `browser` to open `/authorize` for 1-click sign-in, or `token` with `nb_pat_...`.",
                  },
                  token: { type: "string" },
                  apiUrl: { type: "string" },
                },
              },
            },
            {
              name: "nb_workspace_list",
              description: "List all NetworkBase workspaces accessible to the authenticated user.",
              inputSchema: { type: "object", properties: {} },
            },
            {
              name: "nb_init",
              description:
                "Initialize and link the current directory to a NetworkBase workspace (and optional sprint task). Automatically triggers browser login if not signed in.",
              inputSchema: {
                type: "object",
                properties: {
                  workspaceId: { type: "string" },
                  taskId: { type: "string" },
                  apiUrl: { type: "string" },
                },
              },
            },
            {
              name: "nb_pre_push_analyze",
              description:
                "Run High-EQ Pre-Push Analysis on local files before pushing to NetworkBase. Returns version transitions (new v1 vs v1 -> v2 bumps), lock status, and task role options (`deliverable`, `working`, `reference`). Always call this first and ask the user which role they want before calling `nb_push`.",
              inputSchema: {
                type: "object",
                properties: {
                  paths: { type: "array", items: { type: "string" } },
                  taskId: { type: "string" },
                },
              },
            },
            {
              name: "nb_push",
              description:
                "Push local files to NetworkBase with SHA-256 verification, version bumping (v1 -> v2), and task role classification (`deliverable`, `working`, or `reference`).",
              inputSchema: {
                type: "object",
                properties: {
                  paths: { type: "array", items: { type: "string" } },
                  taskId: { type: "string" },
                  role: {
                    type: "string",
                    enum: ["deliverable", "working", "reference"],
                  },
                  transitionStatus: {
                    type: "string",
                    enum: ["in_progress", "done"],
                  },
                  message: { type: "string" },
                },
                required: ["role"],
              },
            },
            {
              name: "nb_task_list",
              description:
                "List tasks in the active NetworkBase workspace with full descriptions, subtasks, and role-classified attached files, and sync .networkbase/tasks/TASKS.md.",
              inputSchema: {
                type: "object",
                properties: {
                  allWorkspaces: { type: "boolean" },
                  scope: { type: "string", enum: ["all", "mine"] },
                },
              },
            },
            {
              name: "nb_task_view",
              description:
                "View full task details, description, subtasks checklist, and attached files categorized by role (`reference`, `working`, `deliverable`), and mirror attached files to .networkbase/mirror/.",
              inputSchema: {
                type: "object",
                properties: { taskId: { type: "string", description: "Task UUID or task number (e.g. #4 or 4)" } },
                required: ["taskId"],
              },
            },
            {
              name: "nb_task_work",
              description:
                "Bind the active task in .networkbase/state.json, transition it to in_progress, and download its attached files into .networkbase/mirror/.",
              inputSchema: {
                type: "object",
                properties: { taskId: { type: "string", description: "Task UUID or task number (e.g. #4 or 4)" } },
                required: ["taskId"],
              },
            },
            {
              name: "nb_task_check",
              description: "Check or uncheck subtasks on the active or specified task.",
              inputSchema: {
                type: "object",
                properties: {
                  taskId: { type: "string" },
                  subtaskNumbers: { type: "array", items: { type: "number" } },
                  all: { type: "boolean" },
                  uncheck: { type: "boolean" },
                },
              },
            },
            {
              name: "nb_file_diff",
              description: "Compare local files against the remote NetworkBase workspace SHA-256 manifest.",
              inputSchema: {
                type: "object",
                properties: { paths: { type: "array", items: { type: "string" } } },
              },
            },
          ],
        });
        return;
      }

      if (method === "tools/call") {
        const toolName = params?.name;
        const args = params?.arguments || {};

        if (toolName === "nb_auth_status") {
          const status = await handleStatus({ json: true });
          sendJsonRpc(id, {
            content: [{ type: "text", text: JSON.stringify(status, null, 2) }],
          });
          return;
        }

        if (toolName === "nb_auth_login") {
          const loginFlags = {
            json: true,
            web: args.method !== "token",
            token: args.token,
            url: args.apiUrl,
          };
          const loginRes = await performInteractiveOrFlagLogin(loginFlags, args.token);
          sendJsonRpc(id, {
            content: [{ type: "text", text: JSON.stringify(loginRes, null, 2) }],
          });
          return;
        }

        if (toolName === "nb_workspace_list") {
          const apiUrl = await resolveBestApiUrl();
          const data = await apiRequest("/api/v1/extension/workspaces", { apiUrl });
          sendJsonRpc(id, {
            content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
          });
          return;
        }

        if (toolName === "nb_init") {
          await handleInit(args.workspaceId ? [args.workspaceId] : [], {
            json: true,
            workspace: args.workspaceId,
            task: args.taskId,
            url: args.apiUrl,
          });
          const status = await handleStatus({ json: true });
          sendJsonRpc(id, {
            content: [{ type: "text", text: JSON.stringify(status, null, 2) }],
          });
          return;
        }

        if (toolName === "nb_pre_push_analyze" || toolName === "nb_file_diff") {
          const res = await executePrePushAnalysis(args.paths || [], {
            task: args.taskId,
          });
          sendJsonRpc(id, {
            content: [
              {
                type: "text",
                text: JSON.stringify(res.analysis, null, 2),
              },
            ],
          });
          return;
        }

        if (toolName === "nb_push") {
          const flags = {
            json: true,
            task: args.taskId,
            role: args.role || "working",
            done: args.transitionStatus === "done",
            wip: args.transitionStatus === "in_progress",
            message: args.message,
          };
          const pushResult = await handlePush(args.paths || [], flags);
          sendJsonRpc(id, {
            content: [
              {
                type: "text",
                text: JSON.stringify(pushResult, null, 2),
              },
            ],
          });
          return;
        }

        if (toolName === "nb_task_list") {
          const cfg = getLocalConfig();
          const data = await apiRequest(
            `/api/v1/extension/workspace-tasks?projectId=${cfg.projectId}&scope=${args.scope || "all"}`,
          );
          writeLocalTaskIntelligence(cfg.projectId, cfg.title || cfg.projectId, data.tasks || []);
          sendJsonRpc(id, {
            content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
          });
          return;
        }

        if (toolName === "nb_task_view") {
          const cfg = getLocalConfig();
          const resolvedId = resolveTaskIdentifier(args.taskId);
          const detail = await apiRequest(
            `/api/v1/extension/task-detail?projectId=${cfg.projectId}&taskId=${encodeURIComponent(resolvedId)}`,
          );
          await hydrateTaskAttachedFiles(cfg.projectId, detail.files || []);
          sendJsonRpc(id, {
            content: [{ type: "text", text: JSON.stringify(detail, null, 2) }],
          });
          return;
        }

        if (toolName === "nb_task_work") {
          const cfg = getLocalConfig();
          const resolvedId = resolveTaskIdentifier(args.taskId);
          const detail = await apiRequest(
            `/api/v1/extension/task-detail?projectId=${cfg.projectId}&taskId=${encodeURIComponent(resolvedId)}`,
          );
          const task = detail.task;
          saveLocalState({
            ...getLocalState(),
            activeTaskId: task.id,
            activeTaskTitle: task.title,
            startedAt: new Date().toISOString(),
          });
          await hydrateTaskAttachedFiles(cfg.projectId, detail.files || []);
          sendJsonRpc(id, {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    activeTaskId: task.id,
                    taskNumber: task.taskNumber,
                    title: task.title,
                    description: task.description,
                    status: "in_progress",
                    subtasks: detail.subtasks || [],
                    files: detail.files || [],
                  },
                  null,
                  2,
                ),
              },
            ],
          });
          return;
        }

        if (toolName === "nb_task_check") {
          const cfg = getLocalConfig();
          const targetId = resolveTaskIdentifier(args.taskId || getLocalState()?.activeTaskId);
          const detail = await apiRequest(
            `/api/v1/extension/task-detail?projectId=${cfg.projectId}&taskId=${encodeURIComponent(targetId)}`,
          );
          const subtasks = detail.subtasks || [];
          const nums = new Set((args.subtaskNumbers || []).map(Number));
          const targetCompleted = !args.uncheck;
          for (const st of subtasks) {
            if (args.all || nums.has(st.index)) {
              if (Boolean(st.completed) !== targetCompleted) {
                await apiRequest("/api/v1/extension/task-update", {
                  method: "PATCH",
                  body: {
                    kind: "subtask",
                    projectId: cfg.projectId,
                    taskId: detail.task.id,
                    subtaskId: st.id,
                    completed: targetCompleted,
                    expectedUpdatedAt: new Date(st.updatedAt).toISOString(),
                  },
                });
                st.completed = targetCompleted;
              }
            }
          }
          sendJsonRpc(id, {
            content: [{ type: "text", text: JSON.stringify({ taskId: detail.task.id, subtasks }, null, 2) }],
          });
          return;
        }

        sendJsonRpc(id, null, { code: -32601, message: `Unknown tool: ${toolName}` });
      }
    } catch (err) {
      sendJsonRpc(id, null, {
        code: -32000,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });
}

function printHelp() {
  console.log(`
NetworkBase High-EQ CLI (v${CLI_VERSION})

Quick Start (One-Command Setup):
  npx @networkbase/cli init       Authenticate (Browser or Token), link Workspace & Task

Usage:
  nb <command> [subcommand] [flags]

Core Commands:
  nb init [--workspace <id>]      3-step setup wizard + local mirror + auto-sync daemon
  nb sync [paths...]              Single-permission universal sync (push edits + pull mirror + start daemon)
  nb status                       Show active account, server, workspace, and task context
  nb auth login [--web | --token] Sign in via Web Browser (/authorize) or Token (nb_pat_...)
  nb auth whoami                  Display active user, session, and workspace
  nb auth logout                  Revoke active session and clear credentials
  nb auth setup-git               Configure Git HTTPS credential helper
  nb workspace list | switch      List or switch active NetworkBase workspaces
  nb task [list] [--all | --mine] View project tasks, descriptions, subtasks & attached files
  nb task view <#number|id>       Inspect task description, subtasks & mirror attached files
  nb task work <#number|id>       Bind active task, transition to in_progress & mirror files
  nb task check [1 2 | --all]     Toggle subtasks interactively (Space) or via CLI numbers
  nb task done [#number|id]       Mark active or specified task as Done
  nb file ls | log | diff | lock  Inspect workspace files, history, diffs, or CLI locks
  nb hook install                 Install local .git/hooks/pre-push secret scanner
  nb pull [paths...]              Download remote workspace files to local directory
  nb watch [paths...]             Live debounced auto-sync watcher (1-RTT fast-push on save)
  nb push [paths...]              High-EQ Smart Push (SHA-256 diff + v1->v2 bump + task link)
    --deliverable                 Classify pushed files as Final Deliverable (#deliverable)
    --draft                       Classify pushed files as Working Draft (#editor_working)
    --reference                   Classify pushed files as Reference Material (#reference)
    --done                        Transition linked task to Done upon push
    --task <uuid>                 Link push to a specific task (or auto-infer from branch)
    -m, --message <msg>           Commit / revision summary message
    --dry-run                     Run Pre-Push Analysis without uploading
    --json                        Output structured JSON for AI assistants
  nb mcp                          Start Model Context Protocol (MCP) server over stdio
`);
}

async function main() {
  const { positional, flags } = parseFlags(process.argv.slice(2));
  const [cmd, sub, ...rest] = positional;

  if (cmd === "version" || flags.version || flags.v) {
    console.log(CLI_VERSION);
    return;
  }

  if (cmd === "help" || flags.help || flags.h) {
    printHelp();
    return;
  }

  if (!cmd) {
    if (process.stdin.isTTY && !flags.json) {
      try {
        await handleInteractiveHub(flags);
      } catch (err) {
        console.error(`  ${STEP_ERR}  ${c.red}${err instanceof Error ? err.message : String(err)}${c.reset}`);
        process.exitCode = 1;
      }
      return;
    }
    printHelp();
    return;
  }

  try {
    switch (cmd) {
      case "auth":
        await handleAuth(sub, rest, flags);
        break;
      case "login":
        await handleAuth("login", [sub, ...rest].filter(Boolean), flags);
        break;
      case "logout":
        await handleAuth("logout", [], flags);
        break;
      case "whoami":
      case "status":
        await handleStatus(flags);
        break;
      case "init":
      case "setup":
        await handleInit([sub, ...rest].filter(Boolean), flags);
        break;
      case "sync":
        await handleSync([sub, ...rest].filter(Boolean), flags);
        break;
      case "workspace":
      case "ws":
        await handleWorkspace(sub, rest, flags);
        break;
      case "task":
      case "sprint":
        await handleTask(sub, rest, flags);
        break;
      case "file":
        await handleFile(sub, rest, flags);
        break;
      case "pull":
        await handlePull([sub, ...rest].filter(Boolean), flags);
        break;
      case "watch":
        await handleWatch([sub, ...rest].filter(Boolean), flags);
        break;
      case "push":
        await handlePush([sub, ...rest].filter(Boolean), flags);
        break;
      case "hook":
        if (sub === "install") await handleHookInstall(flags);
        else throw new Error("Usage: nb hook install");
        break;
      case "mcp":
        await startMcpServer();
        break;
      default:
        throw new Error(`Unknown command: ${cmd}. Run \`nb --help\` for available commands.`);
    }
  } catch (err) {
    if (flags.json) {
      process.stdout.write(
        JSON.stringify(
          {
            success: false,
            error: err instanceof Error ? err.message : String(err),
            errorCode: err.errorCode || "CLI_ERROR",
          },
          null,
          2,
        ) + "\n",
      );
    } else {
      console.error(`  ${STEP_ERR}  ${c.red}${err instanceof Error ? err.message : String(err)}${c.reset}`);
    }
    process.exitCode = 1;
  }
}

void main();
