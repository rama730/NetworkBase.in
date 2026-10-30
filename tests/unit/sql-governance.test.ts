import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { validateSqlGovernance } from "../../scripts/check-sql-governance";

function write(filePath: string, content: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function writeManifest(rootDir: string, existingMigrationFiles: string[], allowedUtilitySqlFiles: string[] = [], strictLineageFromIndex = 0) {
  write(
    path.join(rootDir, "drizzle/meta/_journal.json"),
    JSON.stringify({
      entries: existingMigrationFiles.map((file, idx) => ({
        idx,
        version: "7",
        when: idx + 1,
        tag: path.basename(file, ".sql"),
        breakpoints: true,
      })),
    }),
  );
  write(
    path.join(rootDir, "standards/sql-governance.manifest.json"),
    JSON.stringify(
      {
        policyVersion: 1,
        defaultChangeKind: "append_only",
        migrationDirectory: "drizzle",
        strictLineageFromIndex,
        existingMigrationFiles,
        allowedUtilitySqlFiles,
        breakGlassExceptions: [],
      },
      null,
      2,
    ),
  );
}

describe("check-sql-governance script", () => {
  it("passes when SQL files match the governance manifest", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sql-governance-pass-"));
    write(path.join(tmp, "drizzle/0001_initial_schema.sql"), "-- migration");
    write(path.join(tmp, "scripts/setup.sql"), "-- utility");
    writeManifest(tmp, ["drizzle/0001_initial_schema.sql"], ["scripts/setup.sql"]);

    const result = validateSqlGovernance(tmp);
    assert.equal(result.errors.length, 0, `Expected no violations, got: ${result.errors.join("\n")}`);
  });

  it("fails when a new migration file is added outside the manifest", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sql-governance-fail-"));
    write(path.join(tmp, "drizzle/0001_initial_schema.sql"), "-- migration");
    write(path.join(tmp, "drizzle/0002_new_change.sql"), "-- migration");
    writeManifest(tmp, ["drizzle/0001_initial_schema.sql"]);

    const result = validateSqlGovernance(tmp);
    assert.ok(result.errors.length > 0, "Expected violations but none were reported");
    assert.ok(result.errors.some((line) => line.includes("unapproved migration file")));
  });
  // Terminology report §14.3: projects became workspaces, so no new migration may name an object "project".
  it("rejects project-named objects in new migrations but not in the base files", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sql-governance-names-"));
    const files = ["drizzle/0022_project_compat_views.sql", "drizzle/0023_safe_change.sql", "drizzle/0024_bad_names.sql"];
    write(path.join(tmp, files[0]!), "CREATE VIEW public.project_members WITH (security_invoker = true) AS SELECT 1;");
    write(path.join(tmp, files[1]!), [
      "-- CREATE TABLE project_notes would be wrong",
      "DROP VIEW IF EXISTS public.projects;",
      "UPDATE public.content_reports SET reason = 'spam' WHERE target_kind = 'project';",
      "CREATE TABLE public.workspace_notes (\n  id uuid PRIMARY KEY,\n  workspace_id uuid NOT NULL\n);",
    ].join("\n"));
    write(path.join(tmp, files[2]!), [
      "CREATE TABLE IF NOT EXISTS public.project_notes (\n  id uuid,\n  \"project_ref\" uuid\n);",
      "CREATE OR REPLACE FUNCTION public.nb_project_can_view() RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;",
      "CREATE UNIQUE INDEX project_notes_idx ON public.workspace_notes (id);",
      "ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS project_id uuid;",
      "ALTER TABLE public.tasks RENAME COLUMN workspace_id TO legacy_project_id;",
    ].join("\n"));
    writeManifest(tmp, files, [], 1);

    const result = validateSqlGovernance(tmp);
    const naming = result.errors.filter((line) => line.includes("project"));
    assert.deepEqual(naming, [
      "0024_bad_names: new SQL names must say workspace, not project: legacy_project_id, nb_project_can_view, project_id, project_notes, project_notes_idx, project_ref.",
    ]);
  });
});
