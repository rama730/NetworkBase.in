import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const migration = readFileSync(
  new URL("../../drizzle/0178_storage_asset_lifecycle.sql", import.meta.url),
  "utf8",
);

describe("storage SQL ownership", () => {
  it("removes browser-owned lifecycle and revision mutations", () => {
    assert.match(migration, /DROP POLICY IF EXISTS project_nodes_write/);
    assert.match(migration, /DROP POLICY IF EXISTS file_versions_write/);
    assert.match(migration, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER[\s\S]*public\.project_nodes, public\.file_versions[\s\S]*FROM authenticated/);
  });

  it("applies project state and public file-tab visibility to direct reads", () => {
    assert.match(migration, /CREATE OR REPLACE FUNCTION app_private\.nb_project_node_can_read/);
    assert.match(migration, /coalesce\(project\.status, 'draft'\) <> 'draft'/);
    assert.match(migration, /public_tab_visibility->>'files'/);
  });

  it("keeps task-only and system content behind task visibility", () => {
    assert.match(migration, /p_task_id IS NULL/);
    assert.match(migration, /p_path, ''\) NOT LIKE '\/\.system\/%'/);
    assert.match(migration, /public_tab_visibility->>'tasks'/);
    assert.match(migration, /CREATE POLICY file_versions_read/);
  });

  it("keeps private bytes behind signed upload and application read capabilities", () => {
    assert.match(migration, /UPDATE storage\.buckets SET[\s\S]*public = false[\s\S]*WHERE id = 'project-updates-media'/);
    assert.match(migration, /DROP POLICY IF EXISTS project_files_select/);
    assert.match(migration, /DROP POLICY IF EXISTS chat_attachments_owner_insert/);
    assert.match(migration, /DROP POLICY IF EXISTS project_updates_media_insert/);
    assert.match(migration, /'avatars',[\s\S]*true,[\s\S]*2097152/);
    assert.match(migration, /'profile-image-staging',[\s\S]*false,[\s\S]*2097152/);
    assert.match(migration, /DROP POLICY IF EXISTS profile_image_staging_write/);
  });
});
