// Every command, its flags, help text and examples (report §17.4, §17.4.1, A4.6). Help, parsing, completions
// and `nb help --json` all read this table; handler modules load only for the command being run (A6.3).

/**
 * @typedef {{ type: "string" | "boolean", short?: string, multiple?: boolean, describe: string, valueName?: string, hidden?: boolean }} FlagSpec
 * @typedef {{ name: string, summary: string, usage: string, module: string, fn: string, flags?: Record<string, FlagSpec>, examples?: string[], exit?: number[], hidden?: boolean, group: string }} CommandSpec
 */

/** Flags every command accepts (report §17.3). @type {Record<string, FlagSpec>} */
export const GLOBAL_FLAGS = {
  workspace: { type: "string", short: "w", describe: "Workspace slug (default: the linked one)", valueName: "slug" },
  json: { type: "boolean", describe: "Print one JSON result on stdout" },
  quiet: { type: "boolean", short: "q", describe: "Only errors" },
  plain: { type: "boolean", describe: "No color, symbols or animation (screen readers, logs)" },
  verbose: { type: "boolean", describe: "More detail" },
  fields: { type: "string", describe: "With --json: keep only these fields of each item", valueName: "a,b" },
  "no-pager": { type: "boolean", describe: "Print long views straight to the terminal" },
  yes: { type: "boolean", short: "y", describe: "Accept the recommended answer to every question" },
  answer: { type: "string", multiple: true, describe: "Answer a question without asking: key=value", valueName: "key=value" },
  profile: { type: "string", describe: "Account profile (several accounts or servers)", valueName: "name" },
  "api-url": { type: "string", describe: "Server for this profile", valueName: "url" },
  confirm: { type: "string", describe: "The yes for a change held for confirmation (exit 7 gives the token)", valueName: "token" },
  help: { type: "boolean", short: "h", describe: "Help for this command" },
};

/** @type {Record<string, FlagSpec>} */
const TASK = { task: { type: "string", short: "t", describe: "Task number or id (default: the started task)", valueName: "task" } };
/** @type {Record<string, FlagSpec>} */
const MESSAGE = { message: { type: "string", short: "m", describe: "Text for this command", valueName: "text" } };
/** @type {Record<string, FlagSpec>} */
const AS = { as: { type: "string", describe: "File role: reference, draft or final", valueName: "role" } };
/** @type {Record<string, FlagSpec>} */
const FILTERS = {
  mine: { type: "boolean", describe: "Only tasks assigned to you" },
  all: { type: "boolean", describe: "Include tasks assigned to others" },
  status: { type: "string", describe: "todo,in_progress,blocked,review,done", valueName: "list" },
  limit: { type: "string", describe: "At most this many", valueName: "n" },
};
/** 1.x status flags: still accepted so old scripts run, never shown (P2.9). @type {Record<string, FlagSpec>} */
const OLD_STATUS = {
  done: { type: "boolean", describe: "1.x: no longer changes the task status", hidden: true },
  wip: { type: "boolean", describe: "1.x: no longer changes the task status", hidden: true },
};
/** @type {Record<string, FlagSpec>} */
const DRY = { "dry-run": { type: "boolean", describe: "Show what would happen, change nothing" } };

/** @type {CommandSpec[]} */
export const COMMANDS = [
  // Account and setup
  { group: "Account and setup", name: "login", summary: "Sign in (browser, a code, or a token from stdin)", usage: "nb login [--device] [--agent name] [--with-token]", module: "account", fn: "login",
    flags: { "with-token": { type: "boolean", describe: "Read a token from stdin (CI, scripts)" }, device: { type: "boolean", describe: "Sign in with a code you approve on another device (automatic over SSH)" },
      agent: { type: "string", describe: "Sign in an AI agent; you pick the one workspace it may use", valueName: "name" } },
    examples: ["nb login", "nb login --device", "nb login --device --agent \"Claude Code\"", "echo $NB_TOKEN | nb login --with-token"], exit: [0, 3, 130] },
  { group: "Account and setup", name: "logout", summary: "Revoke this device's token and sign out", usage: "nb logout [--all]", module: "account", fn: "logout",
    flags: { all: { type: "boolean", describe: "Sign out every device and agent (opens Settings to confirm it's you)" } } },
  { group: "Account and setup", name: "token list", summary: "Your signed-in devices, agents and personal tokens", usage: "nb token list", module: "account", fn: "tokenList" },
  { group: "Account and setup", name: "token revoke", summary: "Revoke a device, agent or personal token", usage: "nb token revoke <id>", module: "account", fn: "tokenRevoke", exit: [0, 7, 130] },
  { group: "Account and setup", name: "whoami", summary: "Who you are, what this token may do, limits", usage: "nb whoami [--all]", module: "account", fn: "whoami", exit: [0, 3],
    flags: { all: { type: "boolean", describe: "Every saved sign-in (profiles)" } } },
  { group: "Account and setup", name: "init", summary: "Link this folder to a workspace", usage: "nb init [workspace] [--task 4]", module: "link", fn: "init",
    flags: { ...TASK, path: { type: "string", describe: "Link only this remote folder", valueName: "/folder" }, nested: { type: "boolean", describe: "Allow a link inside another linked folder" } },
    examples: ["nb init design-lab", "nb init design-lab --task 4"] },
  { group: "Account and setup", name: "unlink", summary: "Remove the link, keep your files", usage: "nb unlink [--purge-local]", module: "link", fn: "unlink",
    flags: { "purge-local": { type: "boolean", describe: "Also remove .tasks/ copies" } } },
  { group: "Account and setup", name: "status", summary: "What changed here, the started task, conflicts", usage: "nb status", module: "files", fn: "status", exit: [0, 3, 4, 8] },
  { group: "Account and setup", name: "doctor", summary: "Check sign-in, server, link, Node and this folder", usage: "nb doctor [--repair]", module: "misc", fn: "doctor",
    flags: { repair: { type: "boolean", describe: "Fix what can be fixed (lock, temp files)" } } },
  { group: "Account and setup", name: "open", summary: "Open the workspace, a task or a file in the browser", usage: "nb open [task|path]", module: "misc", fn: "open" },
  { group: "Account and setup", name: "version", summary: "CLI, Node and server versions", usage: "nb version", module: "misc", fn: "version" },
  { group: "Account and setup", name: "help", summary: "Help for a command", usage: "nb help [command]", module: "misc", fn: "help" },
  { group: "Account and setup", name: "completion", summary: "Shell completion script", usage: "nb completion zsh|bash|fish|powershell", module: "misc", fn: "completion" },
  { group: "Account and setup", name: "setup shell", summary: "Add completions to your shell (asks first)", usage: "nb setup shell [zsh|bash|fish|powershell]", module: "misc", fn: "setupShell" },
  { group: "Account and setup", name: "prompt", summary: "Workspace and task for your shell prompt", usage: "nb prompt", module: "misc", fn: "prompt", hidden: true },
  { group: "Account and setup", name: "feedback", summary: "A report to send with a problem (no tokens or paths)", usage: "nb feedback [--include-paths]", module: "misc", fn: "feedback",
    flags: { "include-paths": { type: "boolean", describe: "Keep folder paths in the report" } } },
  { group: "Account and setup", name: "config", summary: "Show or change settings", usage: "nb config list | get <key> | set <key> <value>", module: "misc", fn: "config" },

  // Files
  { group: "Files", name: "undo", summary: "Undo your last change from this machine (24 hours)", usage: "nb undo [token] [--list]", module: "undo", fn: "undo",
    flags: { list: { type: "boolean", describe: "Changes you can undo, newest first" }, session: { type: "boolean", describe: "Everything this agent session did (inside nb mcp)" } }, exit: [0, 1, 4] },
  { group: "Files", name: "diff", summary: "Changes against the version you last pulled", usage: "nb diff [path...]", module: "resolve", fn: "diff" },
  { group: "Files", name: "pull", summary: "Download changes; never overwrites your edits", usage: "nb pull [path...]", module: "files", fn: "pull", flags: { ...DRY }, exit: [0, 4, 8] },
  { group: "Files", name: "push", summary: "Upload changes; same path = new version", usage: "nb push <path...> [--task 4 --as draft] [-m text]", module: "files", fn: "push",
    flags: { ...TASK, ...AS, ...MESSAGE, ...DRY, ...OLD_STATUS,
      all: { type: "boolean", describe: "Push every changed tracked file (needed when not interactive and no paths)" },
      folder: { type: "string", describe: "Workspace folder to put the files in", valueName: "/folder" },
      "keep-both": { type: "boolean", describe: "A changed file whose name is taken goes in as name (2).ext" },
      force: { type: "boolean", describe: "Replace a newer server version after a conflict (asks first)" },
      recreate: { type: "boolean", describe: "Upload again files that were deleted on the server but you still have" },
      "confirm-secrets": { type: "boolean", describe: "Upload even though a file looks like it holds a password or key" } },
    examples: ["nb push src/app.ts -m \"Fix login\"", "nb push report.pdf --task 4 --as final", "nb push shots/ --task 5 --as reference"], exit: [0, 2, 4, 5, 7, 8] },
  { group: "Files", name: "sync", summary: "Pull, then push changed tracked files", usage: "nb sync", module: "files", fn: "sync", flags: { ...MESSAGE, ...OLD_STATUS }, exit: [0, 4, 8] },
  { group: "Files", name: "resolve", summary: "Settle a conflict", usage: "nb resolve <path> --mine|--theirs|--both", module: "resolve", fn: "resolve",
    flags: { mine: { type: "boolean", describe: "Keep yours and push it" }, theirs: { type: "boolean", describe: "Take the server's version" }, both: { type: "boolean", describe: "Keep both as separate files" } } },
  { group: "Files", name: "watch", summary: "Push saves of tracked files as drafts (foreground)", usage: "nb watch", module: "watch", fn: "watch" },
  { group: "Files", name: "file list", summary: "Files in the workspace", usage: "nb file list [folder] [--task 4]", module: "docs", fn: "fileList", flags: { ...TASK } },
  { group: "Files", name: "file history", summary: "A file's versions: who, when, how", usage: "nb file history <path>", module: "browse", fn: "fileHistory" },
  { group: "Files", name: "file move", summary: "Move a file to another folder (asks first)", usage: "nb file move <path> <folder>", module: "browse", fn: "fileMove" },
  { group: "Files", name: "file rename", summary: "Rename a file (asks first)", usage: "nb file rename <path> <new name>", module: "browse", fn: "fileRename" },
  { group: "Files", name: "file delete", summary: "Move a file to the workspace Trash (asks first)", usage: "nb file delete <path>", module: "browse", fn: "fileDelete" },
  { group: "Files", name: "file attach", summary: "Attach a workspace file to a task with a role", usage: "nb file attach <path> --task 4 [--as reference|draft|final]", module: "browse", fn: "fileAttach", flags: { ...TASK, ...AS } },
  { group: "Files", name: "file detach", summary: "Take a file off a task", usage: "nb file detach <path> --task 4", module: "browse", fn: "fileDetach", flags: { ...TASK } },
  { group: "Files", name: "file view", summary: "Print a file (pipe-safe)", usage: "nb file view <path>", module: "docs", fn: "fileView" },

  // Tasks
  { group: "Tasks", name: "task list", summary: "Tasks (default: yours, not done)", usage: "nb task list [--mine|--all] [--status list]", module: "tasks", fn: "list", flags: { ...FILTERS } },
  { group: "Tasks", name: "task count", summary: "How many open tasks you have", usage: "nb task count", module: "tasks", fn: "count" },
  { group: "Tasks", name: "task view", summary: "A task's details (--context: brief for an AI agent)", usage: "nb task view <task> [--context]", module: "tasks", fn: "view",
    flags: { context: { type: "boolean", describe: "Print the task brief for pasting into an AI agent" } } },
  { group: "Tasks", name: "task create", summary: "Create a task", usage: "nb task create \"<title>\" [-m description] [--priority high]", module: "tasks", fn: "create",
    flags: { ...MESSAGE, priority: { type: "string", describe: "low, medium, high or urgent", valueName: "level" }, subtask: { type: "string", multiple: true, describe: "Add a subtask (repeatable)", valueName: "title" } },
    examples: ["nb task create \"Fix login\" --priority high", "nb task create \"Write report\" --subtask Outline --subtask Draft"] },
  { group: "Tasks", name: "task start", summary: "Make it this folder's task and move it to In progress", usage: "nb task start <task>", module: "tasks", fn: "start" },
  { group: "Tasks", name: "task stop", summary: "Clear this folder's task (status unchanged)", usage: "nb task stop", module: "tasks", fn: "stop" },
  { group: "Tasks", name: "task move", summary: "Move to todo, in_progress or blocked", usage: "nb task move <task> <status> [--reason text]", module: "tasks", fn: "move",
    flags: { reason: { type: "string", describe: "Why (needed for blocked)", valueName: "text" } } },
  { group: "Tasks", name: "task done", summary: "Finish a task (sends it for review when required)", usage: "nb task done [task] [-m summary] [--check name=pass]", module: "tasks", fn: "done",
    flags: { ...MESSAGE, check: { type: "string", multiple: true, describe: "A check you ran: name=pass|fail[:note]", valueName: "check" } } },
  { group: "Tasks", name: "task review", summary: "Approve or ask for changes (reviewers)", usage: "nb task review <task> approve|changes [-m reason]", module: "tasks", fn: "review", flags: { ...MESSAGE } },
  { group: "Tasks", name: "task resubmit", summary: "Send for review again after changes", usage: "nb task resubmit <task>", module: "tasks", fn: "resubmit" },
  { group: "Tasks", name: "task edit", summary: "Change a task's title, description, priority or due date", usage: "nb task edit <task> [--title text] [-m description] [--priority high] [--due 2026-11-14|none]", module: "work", fn: "taskEdit",
    flags: { title: { type: "string", describe: "New title", valueName: "text" }, ...MESSAGE, priority: { type: "string", describe: "low, medium, high or urgent", valueName: "level" }, due: { type: "string", describe: "A date, or none", valueName: "date" } } },
  { group: "Tasks", name: "task assign", summary: "Assign a task to someone, you, or nobody", usage: "nb task assign <task> <@username|me|none>", module: "work", fn: "taskAssign" },
  { group: "Tasks", name: "task report", summary: "Report progress with checks, without finishing", usage: "nb task report <task> -m summary [--check name=pass]", module: "work", fn: "taskReport",
    flags: { ...MESSAGE, check: { type: "string", multiple: true, describe: "A check you ran: name=pass|fail[:note]", valueName: "check" } } },
  { group: "Tasks", name: "task delete", summary: "Delete a task (owner; asks first)", usage: "nb task delete <task>", module: "work", fn: "taskDelete", exit: [0, 3, 7, 130] },
  { group: "Tasks", name: "task open", summary: "Open a task in the browser", usage: "nb task open <task>", module: "misc", fn: "open" },
  { group: "Tasks", name: "task pull", summary: "Bring a task's panel files into .tasks/", usage: "nb task pull <task>", module: "tasks", fn: "pullTask" },
  { group: "Tasks", name: "subtask list", summary: "Numbered subtasks", usage: "nb subtask list [--task 4]", module: "tasks", fn: "subtaskList", flags: { ...TASK } },
  { group: "Tasks", name: "subtask add", summary: "Add subtasks", usage: "nb subtask add \"<title>\"... [--task 4]", module: "tasks", fn: "subtaskAdd", flags: { ...TASK } },
  { group: "Tasks", name: "subtask check", summary: "Tick subtasks by number", usage: "nb subtask check <n...> [--task 4]", module: "tasks", fn: "subtaskCheck", flags: { ...TASK } },
  { group: "Tasks", name: "subtask uncheck", summary: "Untick subtasks by number", usage: "nb subtask uncheck <n...> [--task 4]", module: "tasks", fn: "subtaskUncheck", flags: { ...TASK } },
  { group: "Tasks", name: "subtask edit", summary: "Rename a subtask", usage: "nb subtask edit <n> \"<title>\" [--task 4]", module: "work", fn: "subtaskEdit", flags: { ...TASK } },
  { group: "Tasks", name: "subtask delete", summary: "Delete a subtask (asks first)", usage: "nb subtask delete <n> [--task 4]", module: "work", fn: "subtaskDelete", flags: { ...TASK } },
  { group: "Tasks", name: "subtask move", summary: "Move a subtask to another position", usage: "nb subtask move <n> <position> [--task 4]", module: "work", fn: "subtaskMove", flags: { ...TASK } },
  { group: "Tasks", name: "comment add", summary: "Comment on a task", usage: "nb comment add -m \"<text>\" [--task 4]", module: "tasks", fn: "commentAdd", flags: { ...TASK, ...MESSAGE, file: { type: "string", describe: "Comment on lines of a file instead: path:12 or path:12-18", valueName: "path:line" } } },
  { group: "Tasks", name: "comment list", summary: "A task's comments, or a file's line comments", usage: "nb comment list [--task 4] [--file path]", module: "work", fn: "commentList", flags: { ...TASK, file: { type: "string", describe: "A file's line comments", valueName: "path" } } },
  { group: "Tasks", name: "comment resolve", summary: "Resolve (or --reopen) a file comment thread", usage: "nb comment resolve <thread id> --file <path> [--reopen]", module: "work", fn: "commentResolve", flags: { file: { type: "string", describe: "The file", valueName: "path" }, reopen: { type: "boolean", describe: "Open it again" } } },

  // Docs and workspaces
  { group: "Agents", name: "ask", summary: "Ask a person a question in NetworkBase (and wait for the answer)", usage: "nb ask \"<question>\" --option A --option B [--to me|assignee|reviewer] [--task 4] [--wait]", module: "ask", fn: "ask",
    flags: { option: { type: "string", multiple: true, describe: "An answer to offer (2–4; the first is recommended). \"Label: description\"", valueName: "text" }, to: { type: "string", describe: "me (default), assignee or reviewer", valueName: "who" },
      ...TASK, header: { type: "string", describe: "Short label, up to 12 characters", valueName: "text" }, context: { type: "string", describe: "What it's about", valueName: "text" },
      wait: { type: "boolean", describe: "Wait for the answer" }, timeout: { type: "string", describe: "Seconds to wait (default 600)", valueName: "s" } },
    examples: ["nb ask \"Export as CSV or Excel?\" --option CSV --option Excel --to reviewer --task 4 --wait"], exit: [0, 1, 8] },
  { group: "Agents", name: "ask wait", summary: "Wait for the answer to a question", usage: "nb ask wait <id> [--timeout 600]", module: "ask", fn: "askWait", flags: { timeout: { type: "string", describe: "Seconds to wait (default 600)", valueName: "s" } }, exit: [0, 1, 8] },
  { group: "Agents", name: "ask list", summary: "Questions agents asked you", usage: "nb ask list", module: "ask", fn: "askList" },
  { group: "Agents", name: "ask answer", summary: "Answer a question an agent asked you", usage: "nb ask answer <id> <option number or text>", module: "ask", fn: "askAnswer" },
  { group: "Agents", name: "agent setup", summary: "Connect Claude Code, Codex or Cursor to this workspace (asks first)", usage: "nb agent setup claude|codex|cursor [--token agent|mine]", module: "agent", fn: "setup",
    flags: { token: { type: "string", describe: "agent (default): its own sign-in for this workspace only; mine: use yours", valueName: "kind" } },
    examples: ["nb agent setup claude", "nb agent setup codex"] },
  { group: "Agents", name: "agent status", summary: "Which agents are connected here", usage: "nb agent status", module: "agent", fn: "status" },
  { group: "Agents", name: "agent remove", summary: "Disconnect an agent and remove its NetworkBase notes", usage: "nb agent remove claude|codex|cursor", module: "agent", fn: "remove" },
  { group: "Agents", name: "mcp", summary: "MCP server for Claude Code, Codex and Cursor (stdio)", usage: "nb mcp", module: "mcp", fn: "serve",
    examples: ["claude mcp add networkbase -- npx -y @networkbase/cli@2 mcp"] },
  { group: "Docs and workspaces", name: "doc list", summary: "Workspace docs", usage: "nb doc list", module: "docs", fn: "list" },
  { group: "Docs and workspaces", name: "doc view", summary: "Print a doc (default: the README)", usage: "nb doc view [slug] [--raw]", module: "docs", fn: "view", flags: { raw: { type: "boolean", describe: "Markdown only" } } },
  { group: "Docs and workspaces", name: "doc edit", summary: "Edit a doc in your editor, saved as a new version", usage: "nb doc edit [slug]", module: "docs", fn: "edit", flags: { ...MESSAGE } },
  { group: "Docs and workspaces", name: "doc set", summary: "Replace a doc's text from a file or stdin (asks first)", usage: "nb doc set [slug] --file <path|->", module: "docs", fn: "set",
    flags: { ...MESSAGE, file: { type: "string", describe: "Markdown file, or - for stdin", valueName: "path" } }, examples: ["nb doc set readme --file README.md", "cat notes.md | nb doc set readme --file - --yes"], exit: [0, 4, 7] },
  { group: "Docs and workspaces", name: "workspace list", summary: "Your workspaces", usage: "nb workspace list", module: "docs", fn: "workspaceList" },
  { group: "Docs and workspaces", name: "workspace view", summary: "The workspace at a glance", usage: "nb workspace view [-w slug]", module: "browse", fn: "workspaceView" },
  { group: "Docs and workspaces", name: "workspace open", summary: "Open the workspace in the browser", usage: "nb workspace open", module: "misc", fn: "open" },
  { group: "Docs and workspaces", name: "activity", summary: "What happened, newest first", usage: "nb activity [--task 4] [--since 1d]", module: "browse", fn: "activity",
    flags: { ...TASK, since: { type: "string", describe: "30m, 3h, 1d, 2w or a date", valueName: "when" }, limit: { type: "string", describe: "At most this many (default 30)", valueName: "n" } } },
  { group: "Docs and workspaces", name: "sprint list", summary: "Sprints (or the workspace's own word for them)", usage: "nb sprint list", module: "browse", fn: "sprintList" },
  { group: "Docs and workspaces", name: "sprint view", summary: "One sprint and its tasks", usage: "nb sprint view <name or number>", module: "browse", fn: "sprintView" },
  { group: "Docs and workspaces", name: "update post", summary: "Post an update to the workspace (asks first)", usage: "nb update post -m text", module: "browse", fn: "updatePost", flags: { ...MESSAGE } },
  { group: "Docs and workspaces", name: "member list", summary: "People in the workspace", usage: "nb member list [name]", module: "docs", fn: "memberList" },
  { group: "Docs and workspaces", name: "search", summary: "Find files by name", usage: "nb search \"<text>\"", module: "docs", fn: "search" },
];

/** Old 1.x names → new commands (report §17.5); they work through 2.x and print the new name once a day. */
export const ALIASES = {
  "auth login": "login",
  "auth logout": "logout",
  "auth whoami": "whoami",
  "auth status": "whoami",
  setup: "init",
  "task work": "task start",
  "task inspect": "task view",
  "task show": "task view",
  "task check": "subtask check",
  "task subtask add": "subtask add",
  "task comment": "comment add",
  "task status": "task count",
  "file ls": "file list",
  "file cat": "file view",
  "file read": "file view",
  "workspace ls": "workspace list",
  "ws list": "workspace list",
  ws: "workspace list",
};

/** 1.x commands removed on purpose (report D2, D6), with the reason printed instead. */
export const REMOVED = {
  "hook install": "nb hook install was removed in 2.0: it replaced your git hook and scanned the wrong files.",
  "auth setup-git": "nb auth setup-git was removed in 2.0: there is no NetworkBase git server.",
  "auth git-credential": "nb auth git-credential was removed in 2.0: there is no NetworkBase git server.",
};
