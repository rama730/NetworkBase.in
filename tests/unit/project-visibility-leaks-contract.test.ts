import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path: string) => readFileSync(path, "utf8");
const fnBody = (source: string, name: string) => {
  const start = source.indexOf(name);
  assert.ok(start >= 0, `${name} not found`);
  const next = source.indexOf("\nexport ", start + name.length);
  return source.slice(start, next < 0 ? undefined : next);
};

test("COR-002: the file-content server action has no caller-controlled bypass", () => {
  const action = read("src/app/actions/files/content.ts");
  const facade = fnBody(action, "export async function getProjectFileContent(");
  assert.match(facade, /getProjectFileContent\(projectId: string, nodeId: string\)/);
  assert.match(facade, /assertProjectFileReadAccess\(projectId, actorId\)/);
  assert.doesNotMatch(action, /skipFileTabCheck/);
  const reader = read("src/lib/files/content-reader.ts");
  assert.doesNotMatch(reader, /^"use server"/m, "the private reader must not be a server action");
  assert.match(reader, /^import "server-only";/m);
  assert.match(reader, /assertTaskFileNodeVisible\(access, node\)/);
});

test("COR-006: GitHub blob recovery resolves credentials through the sealed resolver", () => {
  const reader = read("src/lib/files/content-reader.ts");
  assert.match(reader, /resolveGithubRepoAccess\(/);
  assert.doesNotMatch(reader, /importAuth \|\| importSource\.metadata\?\.githubToken/);
});

test("COR-034/COR-035: doc reads honor draft status, hide task files and never delete docs", () => {
  const doc = read("src/app/actions/project/doc.ts");
  assert.equal((doc.match(/projectStatus: project\.status/g) ?? []).length, 2);
  assert.equal((doc.match(/fileScope\)/g) ?? []).length, 2);
  const readAction = fnBody(doc, "export async function readProjectDocAction(");
  assert.doesNotMatch(readAction, /db\.delete\(projectDocs\)/);
  assert.match(readAction, /eq\(projectNodes\.projectId, projectId\)/);
});
