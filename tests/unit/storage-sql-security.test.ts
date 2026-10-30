import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const read = (file: string) => readFileSync(new URL(`../../drizzle/${file}.sql`, import.meta.url), "utf8");
const files = read("0009_files");
const storage = read("0003_storage");

describe("storage SQL ownership", () => {
  it("leaves no browser-owned lifecycle or revision mutations", () => {
    assert.doesNotMatch(files, /CREATE POLICY (workspace_nodes_write|file_versions_write)/);
    assert.doesNotMatch(files, /GRANT [^;]*\b(INSERT|UPDATE|DELETE|TRUNCATE|REFERENCES|TRIGGER|ALL)\b[^;]* ON TABLE public\.(workspace_nodes|file_versions) TO (anon|authenticated)/);
  });

  it("applies workspace state and public file-tab visibility to direct reads", () => {
    assert.match(files, /CREATE FUNCTION app_private\.nb_workspace_node_can_read/);
    assert.match(files, /coalesce\(project\.status, 'draft'\) <> 'draft'/);
    assert.match(files, /public_tab_visibility->>'files'/);
  });

  it("keeps task-only and system content behind task visibility", () => {
    assert.match(files, /p_task_id IS NULL/);
    assert.match(files, /p_path, ''\) NOT LIKE '\/\.system\/%'/);
    assert.match(files, /public_tab_visibility->>'tasks'/);
    assert.match(files, /CREATE POLICY file_versions_read/);
  });

  it("keeps private bytes behind signed upload and application read capabilities", () => {
    assert.match(storage, /VALUES \('project-updates-media', 'project-updates-media', 'f'/);
    assert.match(storage, /VALUES \('avatars', 'avatars', 't', 2097152/);
    assert.match(storage, /VALUES \('profile-image-staging', 'profile-image-staging', 'f', 2097152/);
    assert.doesNotMatch(storage, /CREATE POLICY (project_files_select|chat_attachments_owner_insert|project_updates_media_insert|profile_image_staging_write) /);
  });
});
