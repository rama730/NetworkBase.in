import "server-only";

import { and, asc, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { toAccountExportMessage } from "@/lib/account/export-contract";
import {
  connections,
  legalAcceptances,
  profileContributionSkills,
  profileContributionDrafts,
  profileContributionMediaAssets,
  profileProjectContributions,
  profileProjectContributionStages,
  profiles,
  projectMembers,
  projectUpdateComments,
  projects,
  skills,
  tasks,
} from "@/lib/db/schema";

const EXPORT_PAGE_SIZE = 250;
const MESSAGE_PAGE_SIZE = 500;
const encoder = new TextEncoder();

function assertActive(signal: AbortSignal) {
  if (signal.aborted) throw signal.reason ?? new Error("Account export cancelled");
}

function json(value: unknown) {
  return JSON.stringify(value) ?? "null";
}

async function* streamAccountExport(input: {
  userId: string;
  exportedAt: Date;
  profile: unknown;
  signal: AbortSignal;
}): AsyncGenerator<string> {
  const { userId, exportedAt, signal } = input;
  yield `{"exportedAt":${json(exportedAt.toISOString())},"selectionCutoff":${json(exportedAt.toISOString())},"profile":${json(input.profile)},"projectContributions":`;

  yield "[";
  let written = 0;
  let contributionCursor: string | null = null;
  while (true) {
    assertActive(signal);
    const page = await db
      .select({
        id: profileProjectContributions.id,
        projectId: profileProjectContributions.projectId,
        externalKey: profileProjectContributions.externalKey,
        projectTitle: profileProjectContributions.projectTitle,
        platformProjectTitle: projects.title,
        roleTitle: profileProjectContributions.roleTitle,
        summary: profileProjectContributions.summary,
        publishedStory: profileProjectContributions.presentation,
        privateDraft: profileContributionDrafts.document,
        featured: profileProjectContributions.featured,
        publishedAt: profileProjectContributions.publishedAt,
        projectUrl: profileProjectContributions.projectUrl,
        repositoryUrl: profileProjectContributions.repositoryUrl,
        startedAt: profileProjectContributions.startedAt,
        endedAt: profileProjectContributions.endedAt,
        visibility: profileProjectContributions.visibility,
        version: profileProjectContributions.version,
        source: profileProjectContributions.source,
      })
      .from(profileProjectContributions)
      .leftJoin(projects, eq(projects.id, profileProjectContributions.projectId))
      .leftJoin(profileContributionDrafts,and(eq(profileContributionDrafts.contributionId,profileProjectContributions.id),eq(profileContributionDrafts.profileId,userId)))
      .where(and(
        eq(profileProjectContributions.profileId, userId),
        isNull(profileProjectContributions.deletedAt),
        lte(profileProjectContributions.createdAt, exportedAt),
        contributionCursor ? gt(profileProjectContributions.id, contributionCursor) : undefined,
      ))
      .orderBy(asc(profileProjectContributions.id))
      .limit(EXPORT_PAGE_SIZE);
    if (page.length === 0) break;
    const pageIds = page.map((row) => row.id);
    const [skillRows, stageRows, mediaRows] = await Promise.all([
      db
        .select({
          contributionId: profileContributionSkills.contributionId,
          name: skills.name,
          displayOrder: profileContributionSkills.displayOrder,
        })
        .from(profileContributionSkills)
        .innerJoin(skills, eq(skills.id, profileContributionSkills.skillId))
        .where(inArray(profileContributionSkills.contributionId, pageIds))
        .orderBy(asc(profileContributionSkills.displayOrder)),
      db
        .select({
          id: profileProjectContributionStages.id,
          contributionId: profileProjectContributionStages.contributionId,
          roleKind: profileProjectContributionStages.roleKind,
          roleTitle: profileProjectContributionStages.roleTitle,
          summary: profileProjectContributionStages.summary,
          startedAt: profileProjectContributionStages.startedAt,
          endedAt: profileProjectContributionStages.endedAt,
          source: profileProjectContributionStages.source,
          verifiedAt: profileProjectContributionStages.verifiedAt,
        })
        .from(profileProjectContributionStages)
        .where(
          and(
            inArray(profileProjectContributionStages.contributionId, pageIds),
            isNull(profileProjectContributionStages.deletedAt),
          ),
        )
        .orderBy(asc(profileProjectContributionStages.startedAt)),
      db
        .select({
          contributionId: profileContributionMediaAssets.contributionId,
          assetId: profileContributionMediaAssets.assetId,
        })
        .from(profileContributionMediaAssets)
        .where(inArray(profileContributionMediaAssets.contributionId, pageIds)),
    ]);

    const skillNames = new Map<string, string[]>();
    for (const skill of skillRows) {
      const names = skillNames.get(skill.contributionId) ?? [];
      if (!names.includes(skill.name)) names.push(skill.name);
      skillNames.set(skill.contributionId, names);
    }
    const stageMap = new Map<string, Array<Record<string, unknown>>>();
    for (const stage of stageRows) {
      const list = stageMap.get(stage.contributionId) ?? [];
      list.push(stage);
      stageMap.set(stage.contributionId, list);
    }
    const mediaMap = new Map<string, string[]>();
    for (const media of mediaRows) {
      const list = mediaMap.get(media.contributionId) ?? [];
      list.push(media.assetId);
      mediaMap.set(media.contributionId, list);
    }

    for (const row of page) {
      if (written++) yield ",";
      yield json({
        id: row.id,
        kind: row.projectId ? "platform" : "external",
        projectId: row.projectId,
        externalKey: row.externalKey,
        projectTitle: row.platformProjectTitle || row.projectTitle,
        roleTitle: row.roleTitle,
        summary: row.summary,
        publishedStory: row.publishedStory,
        privateDraft: row.privateDraft,
        featured: row.featured,
        publishedAt: row.publishedAt,
        projectUrl: row.projectUrl,
        repositoryUrl: row.repositoryUrl,
        startedAt: row.startedAt,
        endedAt: row.endedAt,
        visibility: row.visibility,
        version: row.version,
        source: row.source,
        skills: skillNames.get(row.id) ?? [],
        stages: stageMap.get(row.id) ?? [],
        mediaAssets: mediaMap.get(row.id) ?? [],
      });
    }
    contributionCursor = page.at(-1)!.id;
    if (page.length < EXPORT_PAGE_SIZE) break;
  }
  yield "],\"projects\":";

  yield "[";
  written = 0;
  let projectCursor: string | null = null;
  while (true) {
    assertActive(signal);
    const page = await db
      .select({
        id: projects.id,
        title: projects.title,
        slug: projects.slug,
        description: projects.description,
        category: projects.category,
        status: projects.status,
        visibility: projects.visibility,
        tags: projects.tags,
        skills: projects.skills,
        createdAt: projects.createdAt,
      })
      .from(projects)
      .where(and(
        eq(projects.ownerId, userId),
        lte(projects.createdAt, exportedAt),
        projectCursor ? gt(projects.id, projectCursor) : undefined,
      ))
      .orderBy(asc(projects.id))
      .limit(EXPORT_PAGE_SIZE);
    if (page.length === 0) break;
    for (const row of page) {
      if (written++) yield ",";
      yield json(row);
    }
    projectCursor = page.at(-1)!.id;
    if (page.length < EXPORT_PAGE_SIZE) break;
  }
  yield "],\"memberships\":";

  yield "[";
  written = 0;
  let membershipCursor: string | null = null;
  while (true) {
    assertActive(signal);
    const page = await db
      .select({ id: projectMembers.id, projectId: projectMembers.projectId, projectTitle: projects.title, role: projectMembers.role, joinedAt: projectMembers.joinedAt })
      .from(projectMembers)
      .innerJoin(projects, eq(projects.id, projectMembers.projectId))
      .where(and(eq(projectMembers.userId, userId), lte(projectMembers.joinedAt, exportedAt), membershipCursor ? gt(projectMembers.id, membershipCursor) : undefined))
      .orderBy(asc(projectMembers.id))
      .limit(EXPORT_PAGE_SIZE);
    if (page.length === 0) break;
    for (const row of page) {
      if (written++) yield ",";
      yield json({ projectId: row.projectId, projectTitle: row.projectTitle, role: row.role, joinedAt: row.joinedAt });
    }
    membershipCursor = page.at(-1)!.id;
    if (page.length < EXPORT_PAGE_SIZE) break;
  }
  yield "],\"assignedTasks\":";

  yield "[";
  written = 0;
  let taskCursor: string | null = null;
  while (true) {
    assertActive(signal);
    const page = await db
      .select({ id: tasks.id, projectId: tasks.projectId, title: tasks.title, status: tasks.status, priority: tasks.priority, dueDate: tasks.dueDate, createdAt: tasks.createdAt })
      .from(tasks)
      .where(and(eq(tasks.assigneeId, userId), isNull(tasks.deletedAt), lte(tasks.createdAt, exportedAt), taskCursor ? gt(tasks.id, taskCursor) : undefined))
      .orderBy(asc(tasks.id))
      .limit(EXPORT_PAGE_SIZE);
    if (page.length === 0) break;
    for (const row of page) {
      if (written++) yield ",";
      yield json(row);
    }
    taskCursor = page.at(-1)!.id;
    if (page.length < EXPORT_PAGE_SIZE) break;
  }
  yield "],\"updateComments\":";

  yield "[";
  written = 0;
  let commentCursor: string | null = null;
  while (true) {
    assertActive(signal);
    const page = await db
      .select({ id: projectUpdateComments.id, projectId: projectUpdateComments.projectId, updateId: projectUpdateComments.updateId, content: projectUpdateComments.content, createdAt: projectUpdateComments.createdAt })
      .from(projectUpdateComments)
      .where(and(eq(projectUpdateComments.userId, userId), isNull(projectUpdateComments.deletedAt), lte(projectUpdateComments.createdAt, exportedAt), commentCursor ? gt(projectUpdateComments.id, commentCursor) : undefined))
      .orderBy(asc(projectUpdateComments.id))
      .limit(EXPORT_PAGE_SIZE);
    if (page.length === 0) break;
    for (const row of page) {
      if (written++) yield ",";
      yield json(row);
    }
    commentCursor = page.at(-1)!.id;
    if (page.length < EXPORT_PAGE_SIZE) break;
  }
  yield "],\"connections\":";

  yield "[";
  written = 0;
  let connectionCursor: string | null = null;
  while (true) {
    assertActive(signal);
    const page = await db
      .select({
        id: connections.id,
        requesterId: connections.requesterId,
        status: connections.status,
        createdAt: connections.createdAt,
      })
      .from(connections)
      .where(and(
        or(eq(connections.requesterId, userId), eq(connections.addresseeId, userId)),
        lte(connections.createdAt, exportedAt),
        connectionCursor ? gt(connections.id, connectionCursor) : undefined,
      ))
      .orderBy(asc(connections.id))
      .limit(EXPORT_PAGE_SIZE);
    if (page.length === 0) break;
    for (const row of page) {
      if (written++) yield ",";
      yield json({
        direction: row.requesterId === userId ? "sent" : "received",
        status: row.status,
        createdAt: row.createdAt,
      });
    }
    connectionCursor = page.at(-1)!.id;
    if (page.length < EXPORT_PAGE_SIZE) break;
  }
  yield "],\"messages\":{\"items\":";

  yield "[";
  written = 0;
  // Only messages this user authored (author index), with the channel's name.
  let messageCursor: { channelId: string; seq: number } | null = null;
  while (true) {
    assertActive(signal);
    type ExportRow = {
      channel_id: string;
      channel_seq: number;
      body: string;
      created_at: Date;
      edited_at: Date | null;
      deleted_at: Date | null;
      channel_name: string | null;
      channel_kind: string;
    };
    const page: ExportRow[] = Array.from(await db.execute<ExportRow>(sql`
      SELECT m.channel_id, m.channel_seq::int AS channel_seq, m.body, m.created_at, m.edited_at, m.deleted_at,
             c.name AS channel_name, c.kind AS channel_kind
      FROM chat_messages m
      JOIN chat_channels c ON c.id = m.channel_id
      WHERE m.author_id = ${userId}::uuid
        AND m.created_at <= ${exportedAt.toISOString()}::timestamptz
        ${messageCursor ? sql`AND (m.channel_id, m.channel_seq) > (${messageCursor.channelId}::uuid, ${messageCursor.seq})` : sql``}
      ORDER BY m.channel_id, m.channel_seq
      LIMIT ${MESSAGE_PAGE_SIZE}
    `));
    if (page.length === 0) break;
    for (const row of page) {
      if (written++) yield ",";
      yield json(toAccountExportMessage({
        channelId: row.channel_id,
        channelName: row.channel_name,
        channelKind: row.channel_kind,
        seq: Number(row.channel_seq),
        body: row.body,
        createdAt: new Date(row.created_at),
        editedAt: row.edited_at ? new Date(row.edited_at) : null,
        deletedAt: row.deleted_at ? new Date(row.deleted_at) : null,
      }));
    }
    const last: ExportRow = page[page.length - 1]!;
    messageCursor = { channelId: last.channel_id, seq: Number(last.channel_seq) };
    if (page.length < MESSAGE_PAGE_SIZE) break;
  }
  yield `],"count":${written},"exportedCount":${written},"truncated":false`;
  yield `,"note":${json("Only messages you wrote are included; other people's messages are not exported.")}`;
  yield "},\"legalAcceptances\":";

  yield "[";
  written = 0;
  let legalCursor: string | null = null;
  while (true) {
    assertActive(signal);
    const page = await db
      .select({
        id: legalAcceptances.id,
        termsVersion: legalAcceptances.termsVersion,
        eulaVersion: legalAcceptances.eulaVersion,
        privacyNoticeVersion: legalAcceptances.privacyNoticeVersion,
        context: legalAcceptances.context,
        acceptedAt: legalAcceptances.acceptedAt,
        retentionExpiresAt: legalAcceptances.retentionExpiresAt,
      })
      .from(legalAcceptances)
      .where(and(
        eq(legalAcceptances.userId, userId),
        lte(legalAcceptances.acceptedAt, exportedAt),
        legalCursor ? gt(legalAcceptances.id, legalCursor) : undefined,
      ))
      .orderBy(asc(legalAcceptances.id))
      .limit(EXPORT_PAGE_SIZE);
    if (page.length === 0) break;
    for (const row of page) {
      if (written++) yield ",";
      const { id: _id, ...exported } = row;
      yield json(exported);
    }
    legalCursor = page.at(-1)!.id;
    if (page.length < EXPORT_PAGE_SIZE) break;
  }
  yield "]}";
}

export async function createAccountExportStream(userId: string, signal: AbortSignal) {
  const exportedAt = new Date();
  const [profile] = await db
    .select({
      email: profiles.email,
      username: profiles.username,
      fullName: profiles.fullName,
      bio: profiles.bio,
      headline: profiles.headline,
      location: profiles.location,
      website: profiles.website,
      skills: profiles.skills,
      interests: profiles.interests,
      education: profiles.education,
      openTo: profiles.openTo,
      socialLinks: profiles.socialLinks,
      experienceLevel: profiles.experienceLevel,
      pronouns: profiles.pronouns,
      createdAt: profiles.createdAt,
    })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);
  if (!profile) throw new Error("Profile not found");

  const iterator = streamAccountExport({ userId, exportedAt, profile, signal });
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (next.done) {
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(next.value));
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await iterator.return(undefined);
    },
  });
}
