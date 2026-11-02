/**
 * Decision 166: after each of deploys 1a to 1c, every live organization's owner gets one notice saying what changed.
 * Prints who would be told unless --apply is passed. Run once per deploy, after it is live:
 *   npx tsx scripts/org-release-notice.ts 1a [--apply]
 */
import Module from "node:module";

import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

type Loader = (request: string, parent: unknown, isMain: boolean) => unknown;
const moduleWithLoad = Module as unknown as { _load: Loader };
const originalLoad = moduleWithLoad._load;
moduleWithLoad._load = (request, parent, isMain) => (request === "server-only" ? {} : originalLoad(request, parent, isMain));

const NOTICES: Record<string, { title: string; body: string }> = {
  "1a": {
    title: "Privacy fixes in your organization",
    body: "Drafts, other people’s work, suspension reasons and activity now reach only the people meant to see them. Posts start as Members only.",
  },
  "1b": {
    title: "Fixes to assignments and reviews",
    body: "Late marks use the hand-in time, group work follows the lead, handed-in work stays on record, and review works from every screen.",
  },
  "1c": {
    title: "Fixes to notices and reminders",
    body: "Reminders follow the Off setting, notices use each person’s time zone, and archiving or deleting work tells the people affected.",
  },
};

async function main() {
  const deploy = process.argv[2] ?? "";
  const notice = NOTICES[deploy];
  if (!notice) throw new Error(`Name the deploy: ${Object.keys(NOTICES).join(", ")}`);
  const apply = process.argv.includes("--apply");

  const { db } = await import("@/lib/db");
  const { workspaces } = await import("@/lib/db/schema");
  const { and, eq, isNull } = await import("drizzle-orm");
  const { notifyOrg } = await import("@/lib/organizations/notify");

  const orgs = await db.select({ id: workspaces.id, title: workspaces.title, slug: workspaces.slug, ownerId: workspaces.ownerId })
    .from(workspaces).where(and(eq(workspaces.kind, "organization"), isNull(workspaces.deletedAt)));
  for (const org of orgs) {
    console.log(`${apply ? "Telling" : "Would tell"} the owner of ${org.title}`);
    if (!apply) continue;
    await notifyOrg({
      orgId: org.id, eventKey: "org.lifecycle", to: [org.ownerId], title: notice.title, body: notice.body,
      href: `/org/${encodeURIComponent(org.slug ?? org.id)}`, sourceEventId: `release-notice:${deploy}:${org.id}`,
    });
  }
  console.log(`${orgs.length} organization${orgs.length === 1 ? "" : "s"}${apply ? "" : " (dry run; add --apply)"}`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
