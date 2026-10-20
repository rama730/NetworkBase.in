import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const source = ts.createSourceFile(
  "settings.ts",
  readFileSync("src/lib/projects/server/settings.ts", "utf8"),
  ts.ScriptTarget.Latest,
  true,
);
const bootstrap = source.statements.find(
  (node): node is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(node) &&
    node.name?.text === "readProjectSettingsBootstrapAction",
)!;

function loadBootstrap(isOwner: boolean, signedIn = true) {
  const calls: string[] = [];
  const read = (section: string) => async () => {
    calls.push(section);
    return { success: true, data: { section } };
  };
  const exports: {
    run?: (...args: unknown[]) => Promise<Record<string, any>>;
  } = {};
  // Execute the production function with isolated authentication/read dependencies.
  const code = ts.transpileModule(
    `${bootstrap.getText(source).replace(/^export\s+/, "")}\nexports.run = readProjectSettingsBootstrapAction;`,
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  vm.runInNewContext(code, {
    exports,
    signedInSettingsViewer: async () => signedIn ? {
      userId: "signed-in-person",
      access: async (projectId: string) => {
        assert.equal(projectId, "project-id");
        calls.push("verified-access");
        return { isOwner };
      },
    } : null,
    UNAUTHORIZED_SETTINGS: { success: false, errorCode: "UNAUTHORIZED", message: "You must be signed in." },
    readCollaboratorSettings: read("collaborators"),
    readFileWorkspaceSettings: read("files"),
    readNotificationSettings: read("notifications"),
    readProjectDocSettingsAction: read("documentation"),
    readDangerZonePreflight: read("danger"),
  });
  return { run: exports.run!, calls };
}

test("project leader gets danger checks when the page supplies only project and filter arguments", async () => {
  const { run, calls } = loadBootstrap(true);
  const result = await run("project-id", { limit: 40 });
  assert.equal(result.dangerPreflight.success, true);
  assert.equal(calls[0], "verified-access");
  assert.ok(calls.includes("danger"));
  for (const section of ["collaboratorSettings", "fileWorkspace", "notifications", "docSettings"]) {
    assert.equal(result[section].success, true);
  }
});

test("co-leader retains ordinary settings access without owner-only danger checks", async () => {
  const { run, calls } = loadBootstrap(false);
  const result = await run("project-id", {});
  assert.equal(result.dangerPreflight.errorCode, "FORBIDDEN");
  assert.match(result.dangerPreflight.message, /danger zone/);
  assert.ok(!calls.includes("danger"));
  assert.equal(result.collaboratorSettings.success, true);
  assert.equal(result.fileWorkspace.success, true);
  assert.equal(result.notifications.success, true);
});

test("caller-provided ownership flags cannot override verified ownership", async () => {
  assert.equal(bootstrap.parameters.length, 2);
  const nonOwner = loadBootstrap(false);
  assert.equal((await nonOwner.run("project-id", {}, true)).dangerPreflight.errorCode, "FORBIDDEN");
  assert.ok(!nonOwner.calls.includes("danger"));
  const owner = loadBootstrap(true);
  assert.equal((await owner.run("project-id", {}, false)).dangerPreflight.success, true);
});

test("signed-out requests do not perform any settings reads", async () => {
  const { run, calls } = loadBootstrap(false, false);
  const result = await run("project-id", {});
  assert.equal(result.dangerPreflight.errorCode, "UNAUTHORIZED");
  assert.equal(result.collaboratorSettings.errorCode, "UNAUTHORIZED");
  assert.equal(calls.length, 0);
});
