import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Verified badge, four ways (2026-11-05-org-address-discovery-verification-findings.md §5, §7): school or work email
// code, the parent organization's confirmation, a code on the website / GitHub / DNS, and the team's review with an
// optional document that goes 30 days after the decision.

let viewerId = "";
const storage: { uploaded: string[]; removed: string[] } = { uploaded: [], removed: [] };
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, email: `${viewerId.slice(0, 8)}@gmail.com`, email_confirmed_at: new Date().toISOString(), app_metadata: {}, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => ({ storage: { from: () => ({
    upload: async (key: string) => { storage.uploaded.push(key); return { data: { path: key }, error: null }; },
    remove: async (keys: string[]) => { storage.removed.push(...keys); return { data: [], error: null }; },
    createSignedUrl: async (key: string) => ({ data: { signedUrl: `https://storage.test/${key}` }, error: null }),
  }) } }),
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.41" }) });
moduleStubs.set("@/inngest/client", { inngest: { send: async () => ({ ids: [] }), createFunction: () => ({}) } });

let trust: typeof import("../../src/app/actions/trust");
let ways: typeof import("../../src/lib/organizations/verification-ways");
let staffActions: typeof import("../../src/app/actions/moderation-staff");
let detail: typeof import("../../src/lib/organizations/detail");
let staffId = "";
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: viewerId ? { aal: "aal2" } : null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
  });
  trust = await loadAppModule(() => import("../../src/app/actions/trust"));
  ways = await loadAppModule(() => import("../../src/lib/organizations/verification-ways"));
  staffActions = await loadAppModule(() => import("../../src/app/actions/moderation-staff"));
  detail = await loadAppModule(() => import("../../src/lib/organizations/detail"));
  staffId = await sql.begin((tx) => createUser(tx));
  process.env.ADMIN_USER_IDS = staffId;
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

async function org(title = "CSE 3B", options: { verified?: boolean } = {}) {
  const [owner, admin, member] = await Promise.all([1, 2, 3].map(() => sql.begin((tx) => createUser(tx))));
  const id = await sql.begin((tx) => createProject(tx, owner!, { visibility: "public" }));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${id}, ${owner!}, 'owner'), (${id}, ${admin!}, 'admin'), (${id}, ${member!}, 'member')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', title = ${title}, join_code = ${generateJoinCode()}, verified_at = ${options.verified ? new Date() : null} WHERE id = ${id}`;
  created.push(id);
  return { id, owner: owner!, admin: admin!, member: member! };
}
const row = async (id: string) => (await sql`SELECT verified_at, verification_method, verified_against, verification_requested_at, org_settings FROM workspaces WHERE id = ${id}`)[0]!;

test("way 1: a code to a school address verifies at once; free mail, wrong codes, the wait and the hourly cap are refused", async () => {
  const o = await org();
  viewerId = o.admin;
  assert.equal((await trust.requestOrgEmailCodeAction(o.id, "hod@rvce.edu.in")).success, false, "the owner asks, not admins");
  viewerId = o.owner;
  const gmail = await trust.requestOrgEmailCodeAction(o.id, "teacher@gmail.com");
  assert.ok(!gmail.success && /own domain/.test(gmail.error));
  const sent = await trust.requestOrgEmailCodeAction(o.id, "HOD@rvce.edu.in");
  assert.deepEqual(sent, { success: true, masked: "h…@rvce.edu.in", waitSeconds: 45 });
  const again = await trust.requestOrgEmailCodeAction(o.id, "hod@rvce.edu.in");
  assert.ok(!again.success && /Wait \d+ seconds/.test(again.error), "45 seconds between sends");
  const pending = await detail.readOrgDetail(o.id, { userId: o.owner, isAdmin: true, isInOrg: true });
  assert.equal(pending?.verificationPending?.method, "email");

  const wrong = await trust.confirmOrgEmailCodeAction(o.id, "000000");
  assert.ok(!wrong.success && /4 tries left/.test(wrong.error));
  await sql`UPDATE org_verification_codes SET code_hash = ${ways.hashVerifyCode(o.id, "424242")} WHERE org_id = ${o.id}`;
  assert.deepEqual(await trust.confirmOrgEmailCodeAction(o.id, "424 242"), { success: true });
  const r = await row(o.id);
  assert.ok(r.verified_at);
  assert.deepEqual([r.verification_method, r.verified_against], ["email", "rvce.edu.in"]);
  assert.equal((await sql`SELECT 1 FROM org_verification_codes WHERE org_id = ${o.id}`).length, 0, "the code is gone");

  const capped = await org("Capped");
  viewerId = capped.owner;
  await sql`INSERT INTO org_verification_codes (org_id, user_id, email, code_hash, expires_at, sends)
    VALUES (${capped.id}, ${capped.owner}, 'a@rvce.edu.in', ${"0".repeat(64)}, now(), ARRAY[now() - interval '50 minutes', now() - interval '20 minutes', now() - interval '2 minutes']::timestamptz[])`;
  const third = await trust.requestOrgEmailCodeAction(capped.id, "a@rvce.edu.in");
  assert.ok(!third.success && /3 codes this hour/.test(third.error));
  assert.equal((await trust.cancelOrgVerificationAction(capped.id)).success, true);
  const [kept] = await sql`SELECT array_length(sends, 1) AS n FROM org_verification_codes WHERE org_id = ${capped.id}`;
  assert.equal(kept!.n, 3, "Try another way doesn't reset the hourly cap");
});

test("way 2: the linked parent must be verified; its admins confirm or decline from their Overview", async () => {
  const parent = await org("Northgate Institute");
  const child = await org("CSE 3B · Parent");
  viewerId = child.owner;
  const noLink = await trust.askParentOrgAction(child.id);
  assert.ok(!noLink.success && /Link “Part of”/.test(noLink.error));
  await sql`UPDATE workspaces SET org_settings = coalesce(org_settings, '{}'::jsonb) || jsonb_build_object('partOf', 'Northgate Institute', 'partOfOrgId', ${parent.id}::text) WHERE id = ${child.id}`;
  const unverified = await trust.askParentOrgAction(child.id);
  assert.ok(!unverified.success && /isn’t verified yet/.test(unverified.error));
  await sql`UPDATE workspaces SET verified_at = now() WHERE id = ${parent.id}`;
  assert.deepEqual(await trust.askParentOrgAction(child.id), { success: true });
  assert.deepEqual((await ways.readParentAsks(parent.id)).map((a) => a.id), [child.id], "the parent's Today row");
  const d = await detail.readOrgDetail(child.id, { userId: child.owner, isAdmin: true, isInOrg: true });
  assert.deepEqual([d?.verificationPending?.method, d?.partOfOrg?.title, d?.partOfOrg?.verified], ["parent", "Northgate Institute", true]);

  viewerId = parent.member;
  assert.equal((await trust.decideParentVerificationAction(parent.id, child.id, true)).success, false, "members can't confirm");
  viewerId = parent.admin;
  assert.deepEqual(await trust.decideParentVerificationAction(parent.id, child.id, false, "Not one of our sections"), { success: true });
  assert.equal((await row(child.id)).org_settings.verification.reason, "Not one of our sections");
  viewerId = child.owner;
  await trust.askParentOrgAction(child.id);
  viewerId = parent.admin;
  assert.deepEqual(await trust.decideParentVerificationAction(parent.id, child.id, true), { success: true });
  const r = await row(child.id);
  assert.deepEqual([Boolean(r.verified_at), r.verification_method, r.verified_against], [true, "parent", "Part of Northgate Institute"]);
  const [told] = await sql`SELECT title FROM user_notifications WHERE user_id = ${child.owner} AND title LIKE '%confirmed%'`;
  assert.ok(told, "the child's owner hears");
  assert.equal((await ways.readParentAsks(parent.id)).length, 0);
});

test("way 3: the code is unique per organization; DNS finds it; GitHub and websites need a link first", async () => {
  const a = await org("Proof A");
  const b = await org("Proof B");
  assert.match(ways.proofCode(a.id), /^networkbase-verify-[0-9a-f]{20}$/);
  assert.notEqual(ways.proofCode(a.id), ways.proofCode(b.id));
  const links = [{ url: "https://www.acme.com" }];
  const found = await ways.findCodeInDns(links, ways.proofCode(a.id), async (domain) => (domain === "acme.com" ? [["v=spf1"], [ways.proofCode(a.id)]] : []));
  assert.equal(found, "acme.com");
  assert.equal(await ways.findCodeInDns(links, ways.proofCode(b.id), async () => [[ways.proofCode(a.id)]]), null, "another organization's code proves nothing");
  viewerId = a.owner;
  const github = await trust.checkOrgProofAction(a.id, "github");
  assert.ok(!github.success && /GitHub organization in Links/.test(github.error));
  const website = await trust.checkOrgProofAction(a.id, "website");
  assert.ok(!website.success && /website in Links first/.test(website.error));
});

test("way 4: team review takes an explanation, links and a document; staff see them; the document goes 30 days after", async () => {
  const o = await org("Mini Startup");
  viewerId = o.owner;
  const short = new FormData();
  short.set("explanation", "hi");
  assert.equal((await trust.requestOrgVerificationAction(o.id, short)).success, false);
  const form = new FormData();
  form.set("explanation", "We are a three-person startup building parsers; reach us at the address below.");
  form.set("links", "https://www.linkedin.com/company/mini-startup");
  form.set("document", new File([new Uint8Array([37, 80, 68, 70])], "registration.pdf", { type: "application/pdf" }));
  assert.deepEqual(await trust.requestOrgVerificationAction(o.id, form), { success: true, verified: false }, "a Gmail owner without a website goes to the team");
  const asked = await row(o.id);
  assert.ok(asked.verification_requested_at);
  assert.equal(asked.org_settings.verificationRequest.method, "team");
  assert.deepEqual(asked.org_settings.verificationRequest.links, ["https://www.linkedin.com/company/mini-startup"]);
  assert.equal(storage.uploaded.length, 1);

  viewerId = staffId;
  const queue = await staffActions.verificationDetailAction(o.id);
  assert.match(queue?.request?.explanation ?? "", /three-person startup/, "staff see what the owner wrote");
  const doc = await staffActions.verificationDocumentUrlAction(o.id);
  assert.ok(doc.success && doc.url.includes(storage.uploaded[0]!));
  viewerId = o.owner;
  assert.equal((await staffActions.verificationDocumentUrlAction(o.id)).success, false, "only staff open the document");
  viewerId = staffId;
  assert.equal((await staffActions.decideVerificationAction(o.id, true)).success, true);
  const decided = await row(o.id);
  assert.deepEqual([Boolean(decided.verified_at), decided.verification_method, decided.org_settings.verificationRequest], [true, "team", undefined]);
  assert.equal(decided.org_settings.verificationDocument.key, storage.uploaded[0]);

  assert.equal(await ways.purgeOrgVerificationDocuments(new Date(Date.now() + 29 * 86_400_000)), 0, "kept for 30 days");
  assert.equal(await ways.purgeOrgVerificationDocuments(new Date(Date.now() + 31 * 86_400_000)), 1);
  assert.deepEqual(storage.removed, [storage.uploaded[0]]);
  assert.equal((await row(o.id)).org_settings.verificationDocument, undefined);
});
