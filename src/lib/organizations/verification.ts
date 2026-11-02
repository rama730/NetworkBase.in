import "server-only";

import { eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { workspaces } from "@/lib/db/schema";
import { notifyOrg, orgHref, orgLabel } from "@/lib/organizations/notify";
import { linkUrls, recheckVerification } from "@/lib/organizations/trust-rules";

// Report §27.9, decision 56: the Verified badge is rechecked when the website or the name changes.

/** Runs after an organization's links or name change; tells the owner when the badge goes or needs a new review. */
export async function recheckOrgVerification(orgId: string, change: { links?: boolean; renamed?: boolean }) {
  const [org] = await db.select({ kind: workspaces.kind, verifiedAt: workspaces.verifiedAt, domain: workspaces.verificationDomain, links: workspaces.externalLinks, ownerId: workspaces.ownerId })
    .from(workspaces).where(eq(workspaces.id, orgId)).limit(1);
  if (org?.kind !== "organization") return "keep";
  const outcome = recheckVerification({ verified: Boolean(org.verifiedAt), domain: org.domain }, { websites: change.links ? linkUrls(org.links) : undefined, renamed: change.renamed });
  if (outcome === "keep") return outcome;
  const now = new Date();
  const label = await orgLabel(orgId);
  if (outcome === "remove") {
    const reason = `The website in Links moved off ${org.domain}.`;
    await db.update(workspaces).set({
      verifiedAt: null, verificationDomain: null,
      orgSettings: sql`coalesce(${workspaces.orgSettings}, '{}'::jsonb) || jsonb_build_object('verification', ${JSON.stringify({ state: "removed", reason, at: now.toISOString() })}::jsonb)`,
    }).where(eq(workspaces.id, orgId));
    if (label) await notifyOrg({ orgId, eventKey: "org.lifecycle", to: [org.ownerId], title: `${label.title} isn’t verified any more. ${reason}`, href: orgHref(label, "?tab=settings"), sourceEventId: `verification-recheck:${orgId}:${now.getTime()}` });
  } else {
    await db.update(workspaces).set({ verifiedAt: null, verificationRequestedAt: now }).where(eq(workspaces.id, orgId));
    if (label) await notifyOrg({ orgId, eventKey: "org.lifecycle", to: [org.ownerId], title: `${label.title} was renamed, so its verification is being reviewed again.`, href: orgHref(label, "?tab=settings"), sourceEventId: `verification-recheck:${orgId}:${now.getTime()}` });
  }
  return outcome;
}
