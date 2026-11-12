// `nb help <topic>` (report C5): how a part of nb fits together, with examples that the tests run through the
// command table, so an example can never name a command or flag that doesn't exist.

export const TOPICS = /** @type {Record<string, { title: string, lines: string[], examples: string[] }>} */ ({
  files: {
    title: "Files: one folder, kept in step with the workspace",
    lines: [
      "nb init links this folder to a workspace. nb pull brings files down; nb push sends your changes up.",
      "Every push of the same path is a new version; nothing is overwritten. nb file history shows them, nb file use goes back.",
      "If a file changed on both sides, you get a conflict copy (name.remote-vN.ext) and nb resolve settles it.",
    ],
    examples: ["nb pull", "nb push report.md -m \"First draft\"", "nb file history report.md", "nb file use report.md v1", "nb sync --only design"],
  },
  agents: {
    title: "Agents: Claude Code, Codex, Cursor and others working with you",
    lines: [
      "nb agent setup connects every agent installed here (or the one you name); you approve each once in the browser and choose what it may do alone.",
      "Big changes (finishing tasks, final files, deleting) wait for your yes. Everything it changes can be undone.",
    ],
    examples: ["nb agent setup", "nb agent setup claude", "nb agent access claude --small", "nb agent status", "nb undo --session"],
  },
  classes: {
    title: "Classes: assignments, hand-ins and reviews",
    lines: [
      "Students: nb assignment list shows what's due; nb assignment hand-in sends your work with the class's late rules.",
      "Teachers: nb review list shows what's waiting; approve or return several at once.",
    ],
    examples: ["nb assignment list", "nb assignment hand-in 3 essay.pdf -m \"Final\"", "nb review list -w cse-3b", "nb review approve 3 5 8"],
  },
  "sign-in": {
    title: "Signing in",
    lines: [
      "nb login opens your browser; over SSH it shows a code and a QR code instead.",
      "Your sign-in lasts a year; nb warns a week before it ends, and nb login renews the same one.",
      "In CI, use a personal token: echo $TOKEN | nb login --with-token, or set NETWORKBASE_TOKEN.",
    ],
    examples: ["nb login", "nb login --device", "nb whoami", "nb token list"],
  },
  offline: {
    title: "Working offline",
    lines: [
      "Without a connection, pushes wait in a queue and nb status reads from what was last pulled.",
      "nb queue shows what's waiting; nb queue retry sends it when you're back.",
    ],
    examples: ["nb queue", "nb queue retry", "nb queue drop 1", "nb diff"],
  },
});
