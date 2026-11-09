import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import Module, { createRequire } from "node:module";
import { validateCsrf } from "@/lib/security/csrf";
import { replaceTaskFileRoleTag } from "@/lib/workspaces/task-file-intelligence";
import { execFileSync } from "node:child_process";
import path from "node:path";

const loader = Module as unknown as { _load: (request: string, ...args: unknown[]) => unknown };
const originalLoad = loader._load;
loader._load = (request, ...args) => (request === "server-only" ? {} : originalLoad(request, ...args));
const {
  normalizeExtensionCallbackUri,
  buildExtensionRevocationUri,
} = createRequire(import.meta.url)("../../src/lib/extension/session-callback") as typeof import("@/lib/extension/session-callback");
loader._load = originalLoad;

describe("NetworkBase High-EQ CLI & Unified Ecosystem", () => {
  describe("CLI Loopback & IDE Callback URI Validation", () => {
    it("accepts loopback CLI browser callbacks on 127.0.0.1 and localhost with a port", () => {
      assert.equal(
        normalizeExtensionCallbackUri("http://127.0.0.1:54321/auth-callback?state=abc"),
        "http://127.0.0.1:54321/auth-callback",
      );
      assert.equal(
        normalizeExtensionCallbackUri("http://localhost:41234/auth-callback"),
        "http://localhost:41234/auth-callback",
      );
      assert.equal(
        buildExtensionRevocationUri("http://127.0.0.1:54321/auth-callback", "sess-1"),
        null,
      );
    });

    it("rejects non-loopback HTTP callbacks while preserving IDE URI scheme callbacks", () => {
      assert.equal(
        normalizeExtensionCallbackUri("http://evil.example.com:54321/auth-callback"),
        null,
      );
      assert.equal(
        normalizeExtensionCallbackUri("vscode://nb-workspace.nb-vscode-sync/auth-callback"),
        "vscode://nb-workspace.nb-vscode-sync/auth-callback",
      );
    });
  });

  describe("CSRF Bearer Token Exemption (nb_dev_ and nb_pat_)", () => {
    it("exempts stateless Bearer nb_dev_ requests without session cookies", () => {
      const req = new Request("https://networkbase.app/api/v1/extension/bulk-intent", {
        method: "POST",
        headers: {
          Authorization: "Bearer nb_dev_1234567890abcdef",
        },
      });
      assert.equal(validateCsrf(req), null);
    });

    it("exempts stateless Bearer nb_pat_ requests without session cookies", () => {
      const req = new Request("https://networkbase.app/api/v1/extension/task-push", {
        method: "POST",
        headers: {
          Authorization: "Bearer nb_pat_abcdef1234567890",
        },
      });
      assert.equal(validateCsrf(req), null);
    });

    it("exempts stateless Bearer nb_agt_ (AI agent) requests too, but not with cookies", () => {
      // Found in a production-mode build check (2026-11-10): agent writes were refused here.
      const headers = { Authorization: "Bearer nb_agt_abcdef1234567890" };
      assert.equal(validateCsrf(new Request("https://networkbase.app/api/mcp", { method: "POST", headers })), null);
      assert.notEqual(validateCsrf(new Request("https://networkbase.app/api/mcp", { method: "POST", headers: { ...headers, Cookie: "sb-project-auth-token=x" } })), null);
      assert.notEqual(validateCsrf(new Request("https://networkbase.app/api/mcp", { method: "POST", headers: { Authorization: "Bearer nb_agtx_123" } })), null);
    });

    it("does not exempt Bearer nb_pat_ when browser auth cookies are attached", () => {
      const req = new Request("https://networkbase.app/api/v1/extension/task-push", {
        method: "POST",
        headers: {
          Authorization: "Bearer nb_pat_abcdef1234567890",
          Cookie: "sb-project-auth-token=session_cookie_value",
        },
      });
      assert.notEqual(validateCsrf(req), null);
    });
  });

  describe("High-EQ Task File Role Classification & Upgrade", () => {
    it("promotes a working draft tag to deliverable cleanly without duplicate role tags", () => {
      const initialDraftTags = replaceTaskFileRoleTag([], "working");
      assert.deepEqual(initialDraftTags, ["working_file"]);

      const promotedDeliverableTags = replaceTaskFileRoleTag(initialDraftTags, "deliverable");
      assert.deepEqual(promotedDeliverableTags, ["deliverable"]);

      const referenceTags = replaceTaskFileRoleTag(promotedDeliverableTags, "reference");
      assert.deepEqual(referenceTags, ["initial_reference"]);
    });
  });

  describe("NetworkBase CLI (`packages/nb-cli/bin/nb.mjs`)", () => {
    const cliPath = path.resolve(process.cwd(), "packages/nb-cli/bin/nb.mjs");

    it("prints version and help cleanly", () => {
      const versionOut = execFileSync("node", [cliPath, "--version"], {
        encoding: "utf8",
      }).trim();
      const pkgJson = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "packages/nb-cli/package.json"), "utf8"));
      assert.equal(versionOut, pkgJson.version);

      const helpOut = execFileSync("node", [cliPath, "--help"], {
        encoding: "utf8",
      });
      // CLI 2.0 command language (report §17.4); the 1.x daemon, --done and git commands are gone.
      for (const words of ["init", "status", "push", "pull", "watch", "task create", "task done", "subtask add", "subtask check", "mcp", "agent setup"]) {
        assert.ok(helpOut.includes(`  ${words} `), `help lists ${words}`);
      }
    });

    it("responds to MCP initialize and tools/list over JSON-RPC stdio", () => {
      const input =
        [
          JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
          JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
        ].join("\n") + "\n";

      const rawOutput = execFileSync("node", [cliPath, "mcp"], {
        input,
        encoding: "utf8",
      });

      const lines = rawOutput
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));

      assert.equal(lines.length, 2);
      assert.equal(lines[0].result.serverInfo.name, "networkbase");
      const toolNames = lines[1].result.tools.map((t: { name: string }) => t.name);
      for (const name of ["networkbase_whoami", "networkbase_task_count", "networkbase_task_list", "networkbase_task_create", "networkbase_task_done", "networkbase_subtask_add", "networkbase_file_push", "networkbase_doc_update", "networkbase_ask_user", "networkbase_undo"]) {
        assert.ok(toolNames.includes(name), name);
      }
    });
  });
});
