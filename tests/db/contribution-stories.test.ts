import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import {
  sql,
  createUser,
  createProject,
  addMember,
  loadAppModule,
  moduleStubs,
  closeAppDb,
  inRollback,
  actAs,
  grantBrowserRead,
} from "./_helpers";
import {
  blankContributionStory,
  type ContributionStory,
} from "../../src/lib/profile/contribution-story";
let actor: string | null = null,
  owner = "",
  outsider = "",
  project = "";
moduleStubs.set("@/lib/supabase/server", {
  createAdminClient: async () => ({
    storage: {
      from: () => ({
        createSignedUploadUrl: async () => ({
          data: { signedUrl: "https://storage.example/upload", token: "test" },
          error: null,
        }),
        createSignedUrl: async () => ({
          data: { signedUrl: "https://storage.example/private" },
          error: null,
        }),
      }),
    },
  }),
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: actor ? { id: actor } : null } }),
    },
  }),
});
moduleStubs.set("@/lib/storage/private-object-response", {
  streamPrivateObject: async () =>
    new Response("verified image", {
      status: 200,
      headers: { "Cache-Control": "private, no-store" },
    }),
});
moduleStubs.set("next/cache", { revalidatePath: () => {} });
let actions: typeof import("../../src/app/actions/contribution-stories");
let reads: typeof import("../../src/lib/profile/collaboration");
let mediaRoute: typeof import("../../src/app/api/v1/contribution-images/[id]/route");
let reference: typeof import("../../src/lib/profile/contribution-story-server");
const ids: string[] = [];
before(async () => {
  actions = await loadAppModule(
    () => import("../../src/app/actions/contribution-stories"),
  );
  reads = await loadAppModule(
    () => import("../../src/lib/profile/collaboration"),
  );
  reference = await loadAppModule(
    () => import("../../src/lib/profile/contribution-story-server"),
  );
  mediaRoute = await loadAppModule(
    () => import("../../src/app/api/v1/contribution-images/[id]/route"),
  );
  owner = await sql.begin((tx) => createUser(tx));
  outsider = await sql.begin((tx) => createUser(tx));
  project = await sql.begin((tx) =>
    createProject(tx, owner, {
      publicTabVisibility: { tasks: true, sprints: true },
    }),
  );
  actor = owner;
});
after(async () => {
  await sql`DELETE FROM workspaces WHERE id=${project}`;
  if (ids.length)
    await sql`DELETE FROM profile_contributions WHERE id=ANY(${ids}::uuid[])`;
  await sql`DELETE FROM profiles WHERE id=ANY(${[owner, outsider]}::uuid[])`;
  await sql`DELETE FROM auth.users WHERE id=ANY(${[owner, outsider]}::uuid[])`;
  await closeAppDb();
  await sql.end();
});
async function create() {
  actor = owner;
  const result = await actions.createContributionStoryAction();
  assert.equal(result.success, true, JSON.stringify(result));
  if (!result.success) throw Error(result.error);
  ids.push(result.id);
  return result.id;
}
async function command(
  id: string,
  version: number,
  operation:
    | "draft"
    | "publish"
    | "hide"
    | "feature"
    | "delete"
    | "restore"
    | "link"
    | "undo-merge",
  document: ContributionStory,
  extra: Record<string, unknown> = {},
) {
  actor = owner;
  return actions.saveContributionStoryAction({
    id,
    expectedVersion: version,
    requestId: randomUUID(),
    operation,
    document,
    ...extra,
  });
}

test("drafts persist privately; publishing is explicit and later drafts never change the published snapshot", async () => {
  const id = await create(),
    draft = {
      ...blankContributionStory("External"),
      summary: "The first published story.",
      visible: true,
      start: "2026-03",
    };
  const saved = await command(id, 1, "draft", draft);
  assert.equal(saved.success, true, JSON.stringify(saved));
  let row = (
    await sql`SELECT presentation,visibility,version FROM profile_contributions WHERE id=${id}`
  )[0]!;
  assert.equal(row.presentation, null);
  assert.equal(row.visibility, "private");
  assert.equal(
    (
      await sql`SELECT document FROM profile_contribution_drafts WHERE contribution_id=${id}`
    )[0]!.document.summary,
    draft.summary,
  );
  const published = await command(id, 2, "publish", draft);
  assert.equal(published.success, true, JSON.stringify(published));
  const later = {
    ...draft,
    summary: "A private edit that must not be visible.",
  };
  assert.equal((await command(id, 3, "draft", later)).success, true);
  row = (
    await sql`SELECT presentation,visibility,version FROM profile_contributions WHERE id=${id}`
  )[0]!;
  assert.equal(row.presentation.summary, draft.summary);
  assert.equal(row.visibility, "public");
  assert.equal(row.version, 4);
  const publicRead = await reads.getProfileContributions(owner, {
    includePrivate: false,
  });
  const publicRow = publicRead.contributions.find((c) => c.id === id)!;
  assert.equal(publicRow.presentation!.summary, draft.summary);
  assert.equal(publicRow.draftStory, null);
  const ownerRead = await reads.getProfileContributions(owner, {
    includePrivate: true,
  });
  assert.equal(
    ownerRead.contributions.find((c) => c.id === id)!.draftStory!.summary,
    later.summary,
  );
});
test("saving a finished contribution reconciles stale current roles in drafts and published snapshots", async () => {
  const id = await create();
  const document: ContributionStory = {
    ...blankContributionStory("Finished work"),
    summary: "Tested the release.",
    start: "2026-03",
    visible: true,
    positions: [
      {
        id: randomUUID(),
        recordedStageId: null,
        title: "Lead / Tester",
        start: "2026-03",
        end: "",
        current: true,
        description: "",
        hidden: false,
      },
    ],
  };
  const draft = await command(id, 1, "draft", document);
  assert.equal(draft.success, true, JSON.stringify(draft));
  const [saved] =
    await sql`SELECT document FROM profile_contribution_drafts WHERE contribution_id=${id}`;
  assert.equal(saved!.document.current, false);
  assert.equal(saved!.document.positions[0].current, false);
  assert.equal(saved!.document.positions[0].end, "");
  const publication = await command(id, 2, "publish", document);
  assert.equal(publication.success, true, JSON.stringify(publication));
  const [published] =
    await sql`SELECT presentation FROM profile_contributions WHERE id=${id}`;
  assert.equal(published!.presentation.positions[0].current, false);
  assert.equal(published!.presentation.positions[0].end, "");
  const read = await reads.getProfileContributions(owner, {
    includePrivate: false,
  });
  assert.equal(
    read.contributions.find((c) => c.id === id)!.presentation!.positions[0]!
      .current,
    false,
  );
});
test("live role titles replace legacy Lead duplicates in reads without overwriting personal titles or historical records", async () => {
  const targetProject = await sql.begin((tx) => createProject(tx, owner));
  const contributionId = randomUUID(),
    stageId = randomUUID(),
    oldStageId = randomUUID();
  const position = {
    id: stageId,
    recordedStageId: stageId,
    title: "Lead - Lead",
    start: "2026-05",
    end: "",
    current: true,
    description: "Designed the product.",
    hidden: false,
  };
  const document = {
    ...blankContributionStory("Legacy lead"),
    current: true,
    visible: true,
    positions: [position],
  };
  try {
    await sql`UPDATE workspaces SET import_source=${sql.json({ type: "scratch", metadata: { leadFocus: "Product designer" } })} WHERE id=${targetProject}`;
    await sql`INSERT INTO profile_contributions (id,profile_id,workspace_id,source,role_kind,role_title,visibility,presentation)
      VALUES (${contributionId},${owner},${targetProject},'owner','owner','Lead - Lead','public',${sql.json(document)})`;
    await sql`INSERT INTO profile_contribution_stages (id,contribution_id,profile_id,workspace_id,role_kind,role_title,started_at)
      VALUES (${stageId},${contributionId},${owner},${targetProject},'owner','Lead - Lead','2026-05-01')`;
    await sql`INSERT INTO profile_contribution_stages (id,contribution_id,profile_id,workspace_id,role_kind,role_title,started_at,ended_at)
      VALUES (${oldStageId},${contributionId},${owner},${targetProject},'owner','Lead / Tester','2026-01-01','2026-04-01')`;
    await sql`INSERT INTO profile_contribution_drafts (contribution_id,profile_id,document) VALUES (${contributionId},${owner},${sql.json(document)})`;
    const read = await reads.getProfileContributions(owner, {
      includePrivate: true,
      limit: 50,
    });
    const row = read.contributions.find((c) => c.id === contributionId)!;
    assert.equal(row.title, "Product designer");
    assert.equal(
      row.roleStages!.find((s) => s.id === stageId)!.roleTitle,
      "Product designer",
    );
    assert.equal(
      row.roleStages!.find((s) => s.id === oldStageId)!.roleTitle,
      "Tester",
    );
    assert.equal(
      row.presentation!.positions[0]!.title,
      "Product designer",
    );
    assert.equal(
      row.draftStory!.positions[0]!.title,
      "Product designer",
    );
    const custom = {
      ...document,
      positions: [{ ...position, title: "Principal Designer" }],
    };
    await sql`UPDATE profile_contribution_drafts SET document=${sql.json(custom)} WHERE contribution_id=${contributionId}`;
    const later = await reads.getProfileContributions(owner, {
      includePrivate: true,
      limit: 50,
    });
    assert.equal(
      later.contributions.find((c) => c.id === contributionId)!.draftStory!
        .positions[0]!.title,
      "Principal Designer",
    );
    const publicRead = await reads.getProfileContributions(owner, {
      includePrivate: false,
      limit: 50,
    });
    assert.equal(
      publicRead.contributions.find((c) => c.id === contributionId)!
        .presentation!.positions[0]!.title,
      "Product designer",
    );
    const [recorded] =
      await sql`SELECT role_title FROM profile_contribution_stages WHERE id=${stageId}`;
    assert.equal(recorded!.role_title, "Lead - Lead");
    const [stored] =
      await sql`SELECT presentation FROM profile_contributions WHERE id=${contributionId}`;
    assert.equal(stored!.presentation.positions[0].title, "Lead - Lead");
  } finally {
    await sql`DELETE FROM workspaces WHERE id=${targetProject}`;
  }
});
test("stale versions cannot overwrite another edit; request retries are idempotent", async () => {
  const id = await create(),
    document = { ...blankContributionStory("Versioned"), summary: "A draft." };
  const requestId = randomUUID();
  const input = {
    id,
    expectedVersion: 1,
    requestId,
    operation: "draft" as const,
    document,
  };
  const first = await actions.saveContributionStoryAction(input);
  assert.equal(first.success, true, JSON.stringify(first));
  const again = await actions.saveContributionStoryAction(input);
  assert.equal(again.success, true);
  assert.equal(
    (
      await sql`SELECT version FROM profile_contributions WHERE id=${id}`
    )[0]!.version,
    2,
  );
  const stale = await command(id, 1, "publish", {
    ...document,
    summary: "Wrong",
  });
  assert.equal(stale.success, false);
  if (!stale.success) assert.equal(stale.code, "CONFLICT");
  assert.equal(
    (
      await sql`SELECT document FROM profile_contribution_drafts WHERE contribution_id=${id}`
    )[0]!.document.summary,
    "A draft.",
  );
});
test("ownership, strict validation and invalid images fail without partial database writes", async () => {
  const id = await create();
  const document = { ...blankContributionStory("Private"), summary: "Kept" };
  actor = outsider;
  const forbidden = await actions.saveContributionStoryAction({
    id,
    expectedVersion: 1,
    requestId: randomUUID(),
    operation: "publish",
    document,
  });
  assert.equal(forbidden.success, false);
  const image = {
    id: randomUUID(),
    assetId: randomUUID(),
    caption: "",
    alt: "A workspace image",
    positionId: null,
    projectFileId: null,
    permission: true,
  };
  const rejected = await command(id, 1, "publish", {
    ...document,
    visible: true,
    images: [image],
  });
  assert.equal(rejected.success, false);
  assert.equal(
    (
      await sql`SELECT version FROM profile_contributions WHERE id=${id}`
    )[0]!.version,
    1,
  );
  assert.equal(
    (
      await sql`SELECT count(*)::int AS n FROM profile_contribution_drafts WHERE contribution_id=${id}`
    )[0]!.n,
    0,
  );
});
test("hiding is immediate; external deletion is reversible and restores privately", async () => {
  const id = await create(),
    document = {
      ...blankContributionStory("Recoverable"),
      summary: "My story",
      visible: true,
    };
  assert.equal((await command(id, 1, "publish", document)).success, true);
  assert.equal(
    (await command(id, 2, "hide", { ...document, visible: false })).success,
    true,
  );
  assert.equal(
    (
      await sql`SELECT visibility FROM profile_contributions WHERE id=${id}`
    )[0]!.visibility,
    "private",
  );
  assert.equal((await command(id, 3, "delete", document)).success, true);
  assert.ok(
    (
      await sql`SELECT deleted_at FROM profile_contributions WHERE id=${id}`
    )[0]!.deleted_at,
  );
  assert.equal((await command(id, 4, "restore", document)).success, true);
  const row = (
    await sql`SELECT deleted_at,visibility FROM profile_contributions WHERE id=${id}`
  )[0]!;
  assert.equal(row.deleted_at, null);
  assert.equal(row.visibility, "private");
});
test("draft RLS exposes no private documents to public or other authenticated callers", async () => {
  const id = await create();
  assert.equal(
    (
      await command(id, 1, "draft", {
        ...blankContributionStory("RLS"),
        summary: "Owner only",
      })
    ).success,
    true,
  );
  await inRollback(async (tx) => {
    await grantBrowserRead(tx, ["profile_contribution_drafts"]);
    await actAs(tx, null);
    assert.equal(
      (
        await tx`SELECT * FROM profile_contribution_drafts WHERE contribution_id=${id}`
      ).length,
      0,
    );
  });
  await inRollback(async (tx) => {
    await grantBrowserRead(tx, ["profile_contribution_drafts"]);
    await actAs(tx, outsider);
    assert.equal(
      (
        await tx`SELECT * FROM profile_contribution_drafts WHERE contribution_id=${id}`
      ).length,
      0,
    );
  });
  await inRollback(async (tx) => {
    await grantBrowserRead(tx, ["profile_contribution_drafts"]);
    await actAs(tx, owner);
    assert.equal(
      (
        await tx`SELECT * FROM profile_contribution_drafts WHERE contribution_id=${id}`
      ).length,
      1,
    );
  });
});
test("private projects cannot be published and presentation cannot forge recorded roles or membership", async () => {
  const id = randomUUID();
  ids.push(id);
  await sql`INSERT INTO profile_contributions(id,profile_id,workspace_id,source,visibility) VALUES(${id},${owner},${project},'membership','private') ON CONFLICT(profile_id,workspace_id) WHERE deleted_at IS NULL AND workspace_id IS NOT NULL DO NOTHING`;
  const actual = (
    await sql`SELECT id,version FROM profile_contributions WHERE profile_id=${owner} AND workspace_id=${project} AND deleted_at IS NULL`
  )[0]!;
  const document = {
    ...blankContributionStory("Platform"),
    summary: "My work",
    visible: true,
  };
  await sql`UPDATE workspaces SET visibility='private' WHERE id=${project}`;
  const restricted = await command(
    actual.id,
    actual.version,
    "publish",
    document,
  );
  assert.equal(restricted.success, false);
  if (!restricted.success) assert.equal(restricted.code, "PROJECT_RESTRICTED");
  await sql`UPDATE workspaces SET visibility='public' WHERE id=${project}`;
  const forged = {
    ...document,
    positions: [
      {
        id: randomUUID(),
        recordedStageId: randomUUID(),
        title: "Owner",
        start: "",
        end: "",
        current: false,
        description: "",
        hidden: false,
      },
    ],
  };
  const result = await command(actual.id, actual.version, "publish", forged);
  assert.equal(result.success, false);
  assert.equal(
    (
      await sql`SELECT role_kind FROM profile_contributions WHERE id=${actual.id}`
    )[0]!.role_kind,
    "contributor",
  );
});
test("reference resolution returns live public labels and redacts tasks, files and people after access changes", async () => {
  const taskId = randomUUID(),
    nodeId = randomUUID();
  await sql`INSERT INTO tasks(id,workspace_id,title,status,task_number) VALUES (${taskId},${project},'Public task','todo',9123)`;
  await sql`INSERT INTO workspace_nodes(id,workspace_id,type,name,path) VALUES(${nodeId},${project},'file','workspace.md','/workspace.md')`;
  await sql.begin((tx) => addMember(tx, project, outsider));
  const handle = `mention${outsider.slice(0, 8)}`;
  await sql`UPDATE profiles SET username=${handle},full_name='Public Teammate' WHERE id=${outsider}`;
  assert.equal(
    (
      await reference.contributionReferenceOptions(
        project,
        "person",
        `@${handle}`,
      )
    )[0]?.id,
    outsider,
  );
  assert.equal(
    (
      await reference.contributionReferenceOptions(
        project,
        "person",
        "Public Teammate",
      )
    )[0]?.id,
    outsider,
  );
  assert.equal(
    (
      await reference.contributionReferenceOptions(project, "task", "", [
        taskId,
      ])
    )[0]?.label,
    "Public task",
  );
  assert.equal(
    (
      await reference.contributionReferenceOptions(project, "file", "", [
        nodeId,
      ])
    )[0]?.label,
    "workspace.md",
  );
  assert.equal(
    (
      await reference.contributionReferenceOptions(project, "person", "", [
        outsider,
      ])
    ).length,
    1,
  );
  await sql`UPDATE workspaces SET public_tab_visibility=jsonb_set(public_tab_visibility,'{tasks}','false') WHERE id=${project}`;
  await sql`UPDATE workspace_nodes SET deleted_at=now() WHERE id=${nodeId}`;
  await sql`UPDATE profiles SET visibility='private' WHERE id=${outsider}`;
  assert.equal(
    (
      await reference.contributionReferenceOptions(
        project,
        "person",
        `@${handle}`,
      )
    ).length,
    0,
  );
  assert.equal(
    (
      await reference.contributionReferenceOptions(project, "task", "", [
        taskId,
      ])
    ).length,
    0,
  );
  assert.equal(
    (
      await reference.contributionReferenceOptions(project, "file", "", [
        nodeId,
      ])
    ).length,
    0,
  );
  assert.equal(
    (
      await reference.contributionReferenceOptions(project, "person", "", [
        outsider,
      ])
    ).length,
    0,
  );
});

test("image uploads reserve the private contribution scope with owner and quota binding", async () => {
  const id = await create();
  actor = owner;
  const prepared = await actions.createContributionImageUploadAction(
    id,
    "image/png",
    1000,
  );
  const intent = (
    await sql`SELECT user_id,bucket,scope,metadata FROM upload_intents WHERE id=${prepared.uploadIntentId}`
  )[0]!;
  assert.equal(intent.user_id, owner);
  assert.equal(intent.bucket, "contribution-images");
  assert.equal(intent.scope, "contribution_image");
  assert.equal(intent.metadata.contributionId, id);
  await assert.rejects(
    actions.createContributionImageUploadAction(id, "image/svg+xml", 1000),
    /PNG/,
  );
  await assert.rejects(
    actions.createContributionImageUploadAction(id, "image/png", 10485761),
    /10 MB/,
  );
  actor = outsider;
  await assert.rejects(
    actions.createContributionImageUploadAction(id, "image/png", 1000),
    /unavailable/,
  );
});

test("image delivery checks the current published snapshot and sharing access on every request", async () => {
  const id = await create(),
    assetId = randomUUID();
  await sql`INSERT INTO storage_assets(id,owner_user_id,bucket,storage_key,purpose,state,declared_mime_type,declared_size,verified_size,verified_mime_type,content_hash,expires_at,verified_at) VALUES (${assetId},${owner},'contribution-images',${"test/" + assetId},'contribution_image:file','verified','image/png',4,4,'image/png','test',now()+interval '1 hour',now())`;
  const image = {
    id: randomUUID(),
    assetId,
    caption: "Work",
    alt: "A work sample",
    positionId: null,
    projectFileId: null,
    permission: true,
  };
  const story = {
    ...blankContributionStory("Images"),
    summary: "My work",
    visible: true,
    images: [image],
    coverId: image.id,
  };
  const missingDescription = await command(id, 1, "publish", {
    ...story,
    images: [{ ...image, alt: "" }],
  });
  assert.equal(missingDescription.success, false);
  if (!missingDescription.success)
    assert.match(missingDescription.error, /description/);
  const [unchanged] =
    await sql`SELECT version,presentation FROM profile_contributions WHERE id=${id}`;
  assert.equal(unchanged!.version, 1);
  assert.equal(unchanged!.presentation, null);
  assert.equal((await command(id, 1, "draft", story)).success, true);
  const request = () =>
    mediaRoute.GET(
      new Request(
        "https://networkbase.in/api/v1/contribution-images/" + assetId,
      ),
      { params: Promise.resolve({ id: assetId }) },
    );
  actor = outsider;
  assert.equal((await request()).status, 404);
  actor = owner;
  assert.equal((await request()).status, 200);
  assert.equal((await command(id, 2, "publish", story)).success, true);
  const publicImages = await reads.getProfileContributions(owner, {
    includePrivate: false,
    limit: 50,
  });
  const publishedImage = publicImages.contributions.find(
    (row) => row.id === id,
  )!.presentation!.images[0]!;
  assert.equal(publishedImage.alt, "A work sample");
  assert.equal(publishedImage.caption, "Work");
  actor = outsider;
  assert.equal((await request()).status, 200);
  // Removing only from a private draft cannot erase the last published image or its GC protection.
  assert.equal(
    (await command(id, 3, "draft", { ...story, images: [], coverId: null }))
      .success,
    true,
  );
  assert.equal(
    (
      await sql`SELECT count(*)::int AS n FROM profile_contribution_media_assets WHERE contribution_id=${id} AND asset_id=${assetId}`
    )[0]!.n,
    1,
  );
  actor = outsider;
  assert.equal((await request()).status, 200);
  assert.equal(
    (await command(id, 4, "hide", { ...story, visible: false })).success,
    true,
  );
  actor = outsider;
  assert.equal((await request()).status, 404);
});

test("unlisted publication requires explicit listing consent and a later access change removes public presentation", async () => {
  const platform = (
    await sql`SELECT id,version FROM profile_contributions WHERE profile_id=${owner} AND workspace_id=${project} AND deleted_at IS NULL`
  )[0]!;
  await sql`UPDATE workspaces SET visibility='unlisted' WHERE id=${project}`;
  const document = {
    ...blankContributionStory("Unlisted"),
    summary: "My contribution",
    visible: true,
  };
  const denied = await command(
    platform.id,
    platform.version,
    "publish",
    document,
  );
  assert.equal(denied.success, false);
  const allowed = await command(platform.id, platform.version, "publish", {
    ...document,
    allowUnlisted: true,
  });
  assert.equal(allowed.success, true, JSON.stringify(allowed));
  assert.ok(
    (
      await reads.getProfileContributions(owner, { includePrivate: false })
    ).contributions.some((c) => c.id === platform.id),
  );
  await sql`UPDATE workspaces SET visibility='private' WHERE id=${project}`;
  assert.equal(
    (
      await reads.getProfileContributions(owner, { includePrivate: false })
    ).contributions.some((c) => c.id === platform.id),
    false,
  );
  await sql`UPDATE workspaces SET visibility='public' WHERE id=${project}`;
});

test("external linking requires duplicate review, merges privately, retries once, and supports atomic undo", async () => {
  const target = (
    await sql`SELECT id,version FROM profile_contributions WHERE profile_id=${owner} AND workspace_id=${project} AND deleted_at IS NULL`
  )[0]!;
  const targetDocument = {
    ...blankContributionStory("Target"),
    summary: "Original target story.",
  };
  const saved = await command(
    target.id,
    target.version,
    "draft",
    targetDocument,
  );
  assert.equal(saved.success, true, JSON.stringify(saved));
  const id = await create(),
    document = {
      ...blankContributionStory("External copy"),
      summary: "Additional external work.",
    };
  const review = await command(id, 1, "link", document, {
    targetProjectId: project,
  });
  assert.equal(review.success, false);
  if (!review.success) {
    assert.equal(review.code, "DUPLICATE");
    assert.equal(review.duplicateId, target.id);
  }
  const input = {
    id,
    expectedVersion: 1,
    requestId: randomUUID(),
    operation: "link" as const,
    document,
    targetProjectId: project,
    mergeTargetId: target.id,
  };
  const merged = await actions.saveContributionStoryAction(input);
  assert.equal(merged.success, true, JSON.stringify(merged));
  if (!merged.success) return;
  assert.equal(merged.id, target.id);
  assert.match(merged.document.summary, /Original target story/);
  assert.match(merged.document.summary, /Additional external work/);
  const retry = await actions.saveContributionStoryAction(input);
  assert.equal(retry.success, true, JSON.stringify(retry));
  if (retry.success) assert.equal(retry.id, target.id);
  const undone = await command(
    id,
    merged.mergedFrom!.version,
    "undo-merge",
    document,
    {
      mergeRestore: {
        targetId: target.id,
        targetVersion: merged.version,
        document: targetDocument,
      },
    },
  );
  assert.equal(undone.success, true, JSON.stringify(undone));
  const source = (
    await sql`SELECT deleted_at,visibility FROM profile_contributions WHERE id=${id}`
  )[0]!;
  assert.equal(source.deleted_at, null);
  assert.equal(source.visibility, "private");
  assert.equal(
    (
      await sql`SELECT document FROM profile_contribution_drafts WHERE contribution_id=${target.id}`
    )[0]!.document.summary,
    targetDocument.summary,
  );
});

test("privacy hide cannot be blocked by an unavailable image in the existing draft", async () => {
  const id = await create(),
    document = {
      ...blankContributionStory("Hide despite unavailable media"),
      summary: "Published text",
      visible: true,
    };
  assert.equal((await command(id, 1, "publish", document)).success, true);
  const unavailableImage = {
    id: randomUUID(),
    assetId: randomUUID(),
    caption: "",
    alt: "Missing work",
    positionId: null,
    projectFileId: null,
    permission: true,
  };
  await sql`INSERT INTO profile_contribution_drafts(contribution_id,profile_id,document) VALUES(${id},${owner},${sql.json({ ...document, images: [unavailableImage] })}) ON CONFLICT(contribution_id) DO UPDATE SET document=EXCLUDED.document`;
  const hidden = await command(id, 2, "hide", document);
  assert.equal(hidden.success, true, JSON.stringify(hidden));
  assert.equal(
    (
      await sql`SELECT visibility FROM profile_contributions WHERE id=${id}`
    )[0]!.visibility,
    "private",
  );
});

test("decision 104: an entry from a real membership keeps the role and dates from the record when the editor sends others", async () => {
  const id = randomUUID();
  ids.push(id);
  await sql`DELETE FROM profile_contributions WHERE profile_id=${owner} AND workspace_id=${project}`;
  await sql`INSERT INTO profile_contributions(id,profile_id,workspace_id,source,visibility,role_title,started_at) VALUES(${id},${owner},${project},'membership','private','Engineer','2026-02-01T00:00:00Z')`;
  const saved = await command(id, 1, "draft", { ...blankContributionStory("Platform"), summary: "More detail", start: "2020-01", end: "2020-06" });
  assert.equal(saved.success, true, JSON.stringify(saved));
  const [row] = await sql`SELECT role_title, started_at, ended_at FROM profile_contributions WHERE id=${id}`;
  assert.deepEqual([row!.role_title, new Date(row!.started_at).toISOString().slice(0, 10), row!.ended_at], ["Engineer", "2026-02-01", null]);
});
