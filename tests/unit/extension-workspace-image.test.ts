import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const projectId = "00000000-0000-4000-8000-000000000001";
const key = "projects/project/cover.png";
const version = createHash("sha256")
  .update(key)
  .digest("base64url")
  .slice(0, 16);
function route({ validBearer = true, publicProject = false } = {}) {
  let cookieReads = 0,
    reads = 0;
  const viewers: Array<string | null> = [];
  const source = ts.transpileModule(
    fs.readFileSync(
      path.join(process.cwd(), "src/app/api/v1/workspaces/[id]/image/route.ts"),
      "utf8",
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  const exports: Record<string, any> = {};
  const fields = new Proxy({}, { get: (_, key) => String(key) });
  const mocks: Record<string, unknown> = {
    "node:crypto": { createHash },
    "drizzle-orm": {
      and: (...v: unknown[]) => v,
      eq: (...v: unknown[]) => v,
      isNull: (v: unknown) => v,
    },
    "@/lib/db/schema": { workspaces: fields, storageAssets: fields },
    "@/lib/db": {
      db: {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: async () =>
                ++reads === 1
                  ? [{ bucket: "project-files", key }]
                  : [{ size: 4, mimeType: "image/png" }],
            }),
          }),
        }),
      },
    },
    "@/lib/data/workspace-access": {
      getWorkspaceAccessById: async (_id: string, userId: string | null) => {
        viewers.push(userId);
        return {
          project: { id: projectId },
          canRead: !!userId || publicProject,
        };
      },
    },
    "@/lib/supabase/server": {
      createClient: async () => ({
        auth: {
          getUser: async () => {
            cookieReads++;
            return { data: { user: null } };
          },
        },
      }),
      createAdminClient: async () => ({
        storage: {
          from: () => ({
            createSignedUrl: async () => ({
              data: { signedUrl: "https://storage.example/private-cover" },
            }),
          }),
        },
      }),
    },
    "@/lib/logger": { logger: { warn() {} } },
    "@/lib/storage/private-object-response": {
      streamPrivateObject: async (input: { cacheControl: string }) =>
        new Response(new Uint8Array([137, 80, 78, 71]), {
          headers: {
            "Content-Type": "image/png",
            "Cache-Control": input.cacheControl,
          },
        }),
    },
    "@/app/api/v1/_shared": {
      jsonError: (message: string, status: number) =>
        Response.json({ message }, { status }),
      requireAuthenticatedUser: async () =>
        validBearer
          ? { user: { id: "device-owner" } }
          : {
              response: Response.json(
                { message: "Invalid device token" },
                { status: 401 },
              ),
            },
    },
    "@/lib/validations/uuid": { isLooseUuid: () => true },
  };
  vm.runInNewContext(source, {
    exports,
    require: (name: string) => mocks[name] || {},
    Response,
    URL,
    Buffer,
  });
  const request = (authorization?: string) => {
    const url = new URL(
      `https://networkbase.in/api/v1/workspaces/${projectId}/image?v=${version}`,
    );
    return {
      headers: new Headers(authorization ? { authorization } : {}),
      nextUrl: url,
    };
  };
  return {
    get: (authorization?: string) =>
      exports.GET(request(authorization), {
        params: Promise.resolve({ id: projectId }),
      }),
    viewers,
    cookieReads: () => cookieReads,
  };
}
test("private workspace images use the verified device identity without browser cookies", async () => {
  const r = route();
  const response = await r.get("Bearer nb_dev_private");
  assert.equal(response.status, 200);
  assert.deepEqual(r.viewers, ["device-owner"]);
  assert.equal(r.cookieReads(), 0);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(
    [...new Uint8Array(await response.arrayBuffer())],
    [137, 80, 78, 71],
  );
});
test("an invalid image bearer cannot fall back to anonymous or cookie access", async () => {
  const r = route({ validBearer: false, publicProject: true });
  assert.equal((await r.get("Bearer nb_dev_revoked")).status, 401);
  assert.equal(r.cookieReads(), 0);
  assert.deepEqual(r.viewers, []);
});
test("existing anonymous public image access remains available and private images remain hidden", async () => {
  const publicRoute = route({ publicProject: true });
  assert.equal((await publicRoute.get()).status, 200);
  assert.equal(publicRoute.cookieReads(), 1);
  const privateRoute = route();
  assert.equal((await privateRoute.get()).status, 404);
  assert.deepEqual(privateRoute.viewers, [null]);
});
