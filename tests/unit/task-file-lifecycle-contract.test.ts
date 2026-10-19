import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");
const links = read("src/app/actions/files/links.ts");
const mutations = read("src/hooks/useTaskFileMutations.ts");
const projectActions = read("src/app/actions/project/index.ts");

test("task links default to references and unlink never deletes the project node", () => {
  const unlink = links.slice(links.indexOf("export async function unlinkNodeFromTask"), links.indexOf("export async function getTaskAttachments"));
  assert.match(links, /replaceTaskFileRoleTag\(\[\], options\?\.role \?\? "reference"\)/);
  assert.match(unlink, /DELETE FROM task_node_links\s*WHERE task_id = \$\{taskId\}::uuid AND node_id = \$\{nodeId\}::uuid/);
  assert.match(unlink, /taskFileDetachedFrom/);
  assert.doesNotMatch(unlink, /deleteNode/);
});

test("task upload links atomically, preserves uncertain commits, and refreshes partial successes", () => {
  assert.match(mutations, /taskLink: options\?\.linkToTask/);
  assert.doesNotMatch(mutations, /deleteNode\(createdNode\.id/);
  assert.doesNotMatch(mutations, /remove\(\[storagePath\]\)/);
  const create = read("src/app/actions/files/mutations.ts");
  assert.match(create, /tx\.insert\(taskNodeLinks\)/);
  assert.match(create, /eq\(tasks\.projectId, projectId\)/);
  assert.match(mutations, /if \(succeeded > 0\) await runAfterSuccess\(\)/);
  assert.match(mutations, /createFolder\(projectId, resolvedParentId, folder\.name, \{ taskId \}\)/);
  assert.match(mutations, /if \(!result.success\) throw new Error\(result.error\)/);
});

test("soft task deletion recovers task-owned files instead of stranding or deleting them", () => {
  const start = projectActions.indexOf("export async function deleteTaskAction");
  const body = projectActions.slice(start, projectActions.indexOf("type UpdateProjectStageOptions", start));
  assert.match(body, /Recovered task files/);
  assert.match(body, /task_id = NULL/);
  assert.match(body, /tx\.delete\(taskNodeLinks\)/);
});

test("task attachments are bounded on write and read (PERF-007)", () => {
  const constants = read("src/app/actions/files/_constants.ts");
  assert.match(constants, /export const MAX_TASK_ATTACHMENTS = 200/);
  assert.match(links, /usage\?\.count \?\? 0\) >= MAX_TASK_ATTACHMENTS/);
  const reader = links.slice(links.indexOf("export async function getTaskAttachments"), links.indexOf("export async function updateTaskNodeLink"));
  assert.match(reader, /\.limit\(MAX_TASK_ATTACHMENTS\)/);
  const linker = links.slice(links.indexOf("export async function linkNodeToTask"), links.indexOf("export async function unlinkNodeFromTask"));
  assert.doesNotMatch(linker, /findMany/);
});
