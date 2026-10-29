import { randomUUID } from "node:crypto";

import dotenv from "dotenv";
import postgres from "postgres";

import { requireDisposableDatabaseUrl } from "./lib/disposable-db";

dotenv.config({ path: ".env.local" });

const disposableUrl = requireDisposableDatabaseUrl("check:profile-contributions:db");

const sql = postgres(disposableUrl, { max: 1, prepare: false });
const ROLLBACK = Symbol("profile-contribution-integration-rollback");

function requireContract(label: string, passed: boolean) {
  if (!passed) throw new Error(`Profile contribution database contract failed: ${label}`);
}

async function main() {
  // Own fixture: a fresh disposable database has no profiles.
  const profile = { id: randomUUID() };
  await sql`INSERT INTO auth.users (id, email) VALUES (${profile.id}, ${`${profile.id}@example.test`})`;
  await sql`INSERT INTO profiles (id, email, username, full_name) VALUES (${profile.id}, ${`${profile.id}@example.test`}, ${`pc${profile.id.replace(/-/g, "").slice(0, 12)}`}, 'Contribution Fixture')`;

  const contributionId = randomUUID();
  const externalKey = `integration:${randomUUID()}`;
  try {
    await sql.begin(async (tx) => {
      const transaction = tx as unknown as typeof sql;
      const [created] = await transaction<{ id: string; version: number; visibility: string }[]>`
        INSERT INTO profile_contributions (
          id, profile_id, workspace_id, external_key, project_title, source, role_kind,
          role_title, visibility, version, created_at, updated_at
        ) VALUES (
          ${contributionId}, ${profile!.id}, NULL, ${externalKey}, 'Integration contribution',
          'manual', 'contributor', 'Contributor', 'private', 1, now(), now()
        )
        RETURNING id, version, visibility
      `;
      requireContract("external contribution insert uses normalized identity", created?.id === contributionId);
      requireContract("new contribution starts private and version one", created?.visibility === "private" && created.version === 1);

      const [updated] = await transaction<{ version: number }[]>`
        UPDATE profile_contributions
        SET summary = 'Versioned update', version = version + 1, updated_at = now()
        WHERE id = ${contributionId} AND version = 1
        RETURNING version
      `;
      requireContract("optimistic version update advances exactly once", updated?.version === 2);

      const staleUpdate = await transaction<{ id: string }[]>`
        UPDATE profile_contributions
        SET summary = 'Stale update', version = version + 1
        WHERE id = ${contributionId} AND version = 1
        RETURNING id
      `;
      requireContract("stale version update changes no rows", staleUpdate.length === 0);
      throw ROLLBACK;
    });
  } catch (error) {
    if (error !== ROLLBACK) throw error;
  }

  const constraints = await sql<{ conname: string; definition: string }[]>`
    SELECT conname, pg_get_constraintdef(oid) AS definition
    FROM pg_constraint
    WHERE conrelid = 'profile_contributions'::regclass
      AND conname IN (
        'profile_contributions_authority_shape_check',
        'profile_contributions_version_check'
      )
  `;
  const constraintNames = new Set(constraints.map((row) => row.conname));
  requireContract("authority shape constraint is installed", constraintNames.has("profile_contributions_authority_shape_check"));
  requireContract("positive version constraint is installed", constraintNames.has("profile_contributions_version_check"));

  const indexes = await sql<{ indexname: string }[]>`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname IN (
        'profile_contributions_profile_workspace_active_unique',
        'profile_contributions_profile_external_active_unique',
        'profile_audit_events_contribution_batch_key_unique'
      )
  `;
  requireContract("all normalized uniqueness indexes are installed", indexes.length === 3);

  // Policies are matched by table and command, not by (renamable) policy name.
  const policies = await sql<{ tablename: string; qual: string | null }[]>`
    SELECT tablename, string_agg(qual, ' OR ') AS qual
    FROM pg_policies
    WHERE schemaname = 'public'
      AND cmd IN ('SELECT', 'ALL')
      AND tablename IN (
        'profile_contributions',
        'profile_contribution_stages',
        'profile_contribution_skills'
      )
    GROUP BY tablename
  `;
  const publicContribution = policies.find((row) => row.tablename === "profile_contributions");
  const publicStage = policies.find((row) => row.tablename === "profile_contribution_stages");
  const visibleSkill = policies.find((row) => row.tablename === "profile_contribution_skills");
  requireContract("public contribution RLS uses visibility", Boolean(publicContribution?.qual?.includes("visibility")));
  requireContract("stage RLS derives from the parent contribution", Boolean(publicStage?.qual?.includes("profile_contributions")));
  requireContract("skill RLS derives from the parent contribution", Boolean(visibleSkill?.qual?.includes("profile_contributions")));

  console.log("[profile-contribution-database] ok");
}

main()
  .catch((error) => {
    console.error("[profile-contribution-database] failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.end({ timeout: 5 });
  });
