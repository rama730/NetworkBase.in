import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { addTask, putFile, startFakeServer } from "./helpers/fake-server.mjs";
import { CLI_PATH, cleanEnv, runCli, tempDir } from "./helpers/run-cli.mjs";

// Report C10–C14 (M4b): nb edit, open --code, --format, nb commit, watch --inbox, nb uninstall.
describe("C10–C14", () => {
  /** @type {Awaited<ReturnType<typeof startFakeServer>>} */
  let api;
  /** @type {string} */
  let cwd;
  /** @type {string} */
  let home;
  before(async () => {
    api = await startFakeServer();
    cwd = await tempDir("nb-c10-");
    home = await tempDir("nb-c10-home-");
    await runCli(["init", "design-lab"], { api: api.url, cwd, home });
  });
  after(() => api.close());
  const nb = (/** @type {string[]} */ args, /** @type {Record<string, string>} */ env = {}) => runCli(args, { api: api.url, cwd, home, env });

  it("--format csv and md print the list and nothing else", async () => {
    addTask(api.state, { title: "Fix, the login", status: "todo" });
    const csv = (await nb(["task", "list", "--format", "csv"])).stdout.trim().split("\n");
    assert.match(csv[0] ?? "", /^#,Task,Status/);
    assert.match(csv[1] ?? "", /"Fix, the login"/);
    const md = (await nb(["task", "list", "--format", "md"])).stdout.trim().split("\n");
    assert.match(md[0] ?? "", /^\| # \| Task \|/);
    assert.match(md[1] ?? "", /^\| --- \|/);
    assert.equal(JSON.parse((await nb(["task", "list", "--format", "json"])).stdout).schema, "nb.task.list/1");
    assert.equal((await nb(["task", "list", "--format", "xml"])).code, 2);
  });

  it("nb edit opens the file in your editor and pushes it as a new version", async () => {
    putFile(api.state, "/notes.md", Buffer.from("old"));
    // A test editor that appends a line (any command works: NB_EDITOR, the editor setting, VISUAL, EDITOR).
    const editor = path.join(await tempDir("nb-editor-"), "ed.sh");
    fs.writeFileSync(editor, "#!/bin/sh\nprintf ' edited' >> \"$1\"\n", { mode: 0o755 });
    if (process.platform === "win32") return; // the shell script editor is POSIX-only; Windows runs the rest
    const r = await nb(["edit", "notes.md", "-m", "small fix"], { NB_EDITOR: editor });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(api.state.files.get("/notes.md")?.content.toString(), "old edited");
    assert.equal(api.state.files.get("/notes.md")?.version, 2);
    const same = await nb(["edit", "notes.md"], { NB_EDITOR: process.platform === "win32" ? "cmd /c rem" : "true" });
    assert.match(same.stdout, /No changes/);
    // A file deleted here comes back when named: nb edit (and nb pull <file>) open it again (T16 live test).
    fs.rmSync(path.join(cwd, "notes.md"));
    const back = await nb(["edit", "notes.md"], { NB_EDITOR: editor });
    assert.equal(back.code, 0, back.stderr);
    assert.equal(api.state.files.get("/notes.md")?.content.toString(), "old edited edited");
  });

  it("nb open --code opens the file in Cursor or VS Code from PATH", async () => {
    if (process.platform === "win32") return;
    const bin = await tempDir("nb-code-");
    const log = path.join(bin, "args.txt");
    fs.writeFileSync(path.join(bin, "code"), `#!/bin/sh\necho "$@" > "${log}"\n`, { mode: 0o755 });
    fs.writeFileSync(path.join(cwd, "a.md"), "x");
    const r = await nb(["open", "a.md", "--code"], { PATH: `${bin}${path.delimiter}${process.env.PATH}` });
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /Opened a\.md in VS Code/);
    for (let i = 0; i < 50 && !fs.existsSync(log); i++) await new Promise((res) => setTimeout(res, 50));
    assert.match(fs.readFileSync(log, "utf8"), /a\.md/);
    const noApps = await tempDir("nb-noapps-");
    assert.match((await nb(["open", "a.md", "--code"], { PATH: bin.replace(/nb-code-.*/, "nowhere"), NB_APP_DIRS: noApps })).stderr, /Neither VS Code nor Cursor/);
    // On a Mac, an installed app without its `code` command opens through `open -a` (T16 live test).
    if (process.platform === "darwin") {
      const apps = await tempDir("nb-apps-");
      fs.mkdirSync(path.join(apps, "Visual Studio Code.app"));
      const openBin = await tempDir("nb-open-");
      const openLog = path.join(openBin, "open.txt");
      fs.writeFileSync(path.join(openBin, "open"), `#!/bin/sh\necho "$@" > "${openLog}"\n`, { mode: 0o755 });
      const viaApp = await nb(["open", "a.md", "--code"], { PATH: `${openBin}${path.delimiter}/usr/bin${path.delimiter}/bin`, NB_APP_DIRS: apps });
      assert.equal(viaApp.code, 0, viaApp.stderr);
      assert.match(viaApp.stdout, /Opened a\.md in VS Code/);
      for (let i = 0; i < 50 && !fs.existsSync(openLog); i++) await new Promise((res) => setTimeout(res, 50));
      assert.match(fs.readFileSync(openLog, "utf8"), /-a .*Visual Studio Code\.app .*a\.md/);
    }
  });

  it("nb commit adds the current task as a trailer", async () => {
    const repo = await tempDir("nb-git-");
    const g = (/** @type {string[]} */ a) => execFileSync("git", a, { cwd: repo, encoding: "utf8" });
    g(["init", "-q"]); g(["config", "user.email", "t@example.com"]); g(["config", "user.name", "T"]);
    await runCli(["init", "design-lab"], { api: api.url, cwd: repo, home });
    addTask(api.state, { title: "Commit me", status: "todo" });
    await runCli(["task", "start", String(api.state.tasks.length)], { api: api.url, cwd: repo, home });
    fs.writeFileSync(path.join(repo, "x.txt"), "x");
    g(["add", "x.txt"]);
    const r = await runCli(["commit", "-m", "Add x"], { api: api.url, cwd: repo, home });
    assert.equal(r.code, 0, r.stderr);
    assert.match(g(["log", "-1", "--format=%B"]), new RegExp(`NetworkBase-Task: #${api.state.tasks.length}`));
  });

  it("nb watch --inbox shows notifications as they come", async () => {
    api.state.events.push({ notifications: [{ title: "Sam commented on #1", body: "looks good" }], files: [] });
    const out = await new Promise((resolve) => {
      const child = spawn(process.execPath, [CLI_PATH, "watch", "--inbox", "--no-pull"], { cwd, env: { ...cleanEnv(home), NETWORKBASE_API_URL: api.url, NETWORKBASE_TOKEN: "nb_pat_test" } });
      let text = "";
      const done = () => { clearTimeout(timer); child.kill("SIGINT"); };
      const timer = setTimeout(done, 10_000);
      child.stderr.on("data", (d) => { text += d; if (text.includes("Sam commented")) done(); });
      child.on("exit", () => resolve(text));
    });
    assert.match(String(out), /Sam commented on #1 · looks good/);
  });

  it("nb uninstall signs out, deletes nb's data and shell lines, says how to remove the package", async () => {
    const h = await tempDir("nb-uninstall-home-");
    await runCli(["setup", "shell", "zsh", "--yes"], { api: api.url, home: h, env: { HOME: h } });
    fs.mkdirSync(path.join(h, ".networkbase"), { recursive: true });
    fs.writeFileSync(path.join(h, ".networkbase", "config.json"), "{}");
    assert.equal((await runCli(["uninstall"], { api: api.url, home: h, env: { HOME: h } })).code, 7, "asks first");
    const r = await runCli(["uninstall", "--yes"], { api: api.url, home: h, env: { HOME: h } });
    assert.equal(r.code, 0, r.stderr);
    assert.ok(!fs.existsSync(path.join(h, ".networkbase")));
    assert.doesNotMatch(fs.readFileSync(path.join(h, ".zshrc"), "utf8"), /nb completion|nb prompt|NetworkBase CLI/);
    assert.match(r.stdout, /Last step: Remove nb the way you installed it|npm rm -g @networkbase\/cli/);
  });

  it("nb uninstall takes the sign-in out of the macOS Keychain too (T16 live test)", async () => {
    if (process.platform !== "darwin") return;
    const h = await tempDir("nb-uninstall-kc-");
    const bin = await tempDir("nb-security-");
    const log = path.join(bin, "security.log");
    // A stand-in for macOS's `security`, so the real Keychain is never touched.
    fs.writeFileSync(path.join(bin, "security"), `#!/bin/sh\necho "$1 $@" >> "${log}"\n[ "$1" = "find-generic-password" ] && echo "nb_dev_test"\nexit 0\n`, { mode: 0o755 });
    const env = { HOME: h, NB_CREDENTIAL_STORE: "", PATH: `${bin}${path.delimiter}${process.env.PATH}` };
    const signedIn = await runCli(["login", "--with-token"], { api: api.url, token: null, home: h, env, input: "nb_pat_test0123456789abcdef\n" });
    assert.equal(signedIn.code, 0, signedIn.stderr);
    assert.match(fs.readFileSync(log, "utf8"), /add-generic-password/);
    const r = await runCli(["uninstall", "--yes"], { api: api.url, token: null, home: h, env });
    assert.equal(r.code, 0, r.stderr);
    assert.match(fs.readFileSync(log, "utf8"), /delete-generic-password/, "the Keychain entry is removed");
  });
});
