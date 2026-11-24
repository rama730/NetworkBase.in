import "server-only";

import { exportOrganizationData } from "@/lib/account/export-organizations";
import { exportTrustData } from "@/lib/trust/standing";
import { exportDownloadHistory } from "@/lib/files/download-history";
import { and, asc, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { toAccountExportMessage } from "@/lib/account/export-contract";
import {
  attendanceRecords,
  classSectionMembers,
  classSections,
  connections,
  legalAcceptances,
  profileContributionSkills,
  profileContributionDrafts,
  profileContributionMediaAssets,
  profileContributions,
  profileContributionStages,
  profiles,
  workspaceMembers,
  workspaceUpdateComments,
  workspaces,
  skills,
  tasks,
  userBlocks,
} from "@/lib/db/schema";

const EXPORT_PAGE_SIZE = 250;
const MESSAGE_PAGE_SIZE = 500;
const encoder = new TextEncoder();

function assertActive(signal: AbortSignal) {
  if (signal.aborted) throw signal.reason ?? new Error("Account export canceled");
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
        id: profileContributions.id,
        projectId: profileContributions.projectId,
        externalKey: profileContributions.externalKey,
        projectTitle: profileContributions.projectTitle,
        platformProjectTitle: workspaces.title,
        roleTitle: profileContributions.roleTitle,
        summary: profileContributions.summary,
        publishedStory: profileContributions.presentation,
        privateDraft: profileContributionDrafts.document,
        featured: profileContributions.featured,
        publishedAt: profileContributions.publishedAt,
        projectUrl: profileContributions.projectUrl,
        repositoryUrl: profileContributions.repositoryUrl,
        startedAt: profileContributions.startedAt,
        endedAt: profileContributions.endedAt,
        visibility: profileContributions.visibility,
        version: profileContributions.version,
        source: profileContributions.source,
      })
      .from(profileContributions)
      .leftJoin(workspaces, eq(workspaces.id, profileContributions.projectId))
      .leftJoin(profileContributionDrafts,and(eq(profileContributionDrafts.contributionId,profileContributions.id),eq(profileContributionDrafts.profileId,userId)))
      .where(and(
        eq(profileContributions.profileId, userId),
        isNull(profileContributions.deletedAt),
        lte(profileContributions.createdAt, exportedAt),
        contributionCursor ? gt(profileContributions.id, contributionCursor) : undefined,
      ))
      .orderBy(asc(profileContributions.id))
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
          id: profileContributionStages.id,
          contributionId: profileContributionStages.contributionId,
          roleKind: profileContributionStages.roleKind,
          roleTitle: profileContributionStages.roleTitle,
          summary: profileContributionStages.summary,
          startedAt: profileContributionStages.startedAt,
          endedAt: profileContributionStages.endedAt,
          source: profileContributionStages.source,
          verifiedAt: profileContributionStages.verifiedAt,
        })
        .from(profileContributionStages)
        .where(
          and(
            inArray(profileContributionStages.contributionId, pageIds),
            isNull(profileContributionStages.deletedAt),
          ),
        )
        .orderBy(asc(profileContributionStages.startedAt)),
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
        id: workspaces.id,
        title: workspaces.title,
        slug: workspaces.slug,
        description: workspaces.description,
        category: workspaces.category,
        status: workspaces.status,
        visibility: workspaces.visibility,
        tags: workspaces.tags,
        skills: workspaces.skills,
        createdAt: workspaces.createdAt,
      })
      .from(workspaces)
      .where(and(
        eq(workspaces.ownerId, userId),
        lte(workspaces.createdAt, exportedAt),
        projectCursor ? gt(workspaces.id, projectCursor) : undefined,
      ))
      .orderBy(asc(workspaces.id))
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
      .select({ id: workspaceMembers.id, projectId: workspaceMembers.projectId, projectTitle: workspaces.title, role: workspaceMembers.role, joinedAt: workspaceMembers.joinedAt })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.projectId))
      .where(and(eq(workspaceMembers.userId, userId), lte(workspaceMembers.joinedAt, exportedAt), membershipCursor ? gt(workspaceMembers.id, membershipCursor) : undefined))
      .orderBy(asc(workspaceMembers.id))
      .limit(EXPORT_PAGE_SIZE);
    if (page.length === 0) break;
    for (const row of page) {
      if (written++) yield ",";
      yield json({ projectId: row.projectId, projectTitle: row.projectTitle, role: row.role, joinedAt: row.joinedAt });
    }
    membershipCursor = page.at(-1)!.id;
    if (page.length < EXPORT_PAGE_SIZE) break;
  }
  // B1.3/B1.4 (report 30.9 and 30.7 layer 16): the sections you're in and your own attendance records.
  yield "],\"classSections\":";
  yield json(await db.select({ projectId: classSectionMembers.projectId, section: classSections.name, kind: classSections.kind, role: classSectionMembers.role })
    .from(classSectionMembers).innerJoin(classSections, eq(classSections.id, classSectionMembers.sectionId)).where(eq(classSectionMembers.userId, userId)).limit(5000));
  yield ",\"attendance\":";
  yield json(await db.select({ projectId: attendanceRecords.projectId, session: attendanceRecords.sessionKey, status: attendanceRecords.status, note: attendanceRecords.note, markedAt: attendanceRecords.markedAt })
    .from(attendanceRecords).where(eq(attendanceRecords.userId, userId)).limit(20000));
  yield ",\"assignedTasks\":";

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
      .select({ id: workspaceUpdateComments.id, projectId: workspaceUpdateComments.projectId, updateId: workspaceUpdateComments.updateId, content: workspaceUpdateComments.content, createdAt: workspaceUpdateComments.createdAt })
      .from(workspaceUpdateComments)
      .where(and(eq(workspaceUpdateComments.userId, userId), isNull(workspaceUpdateComments.deletedAt), lte(workspaceUpdateComments.createdAt, exportedAt), commentCursor ? gt(workspaceUpdateComments.id, commentCursor) : undefined))
      .orderBy(asc(workspaceUpdateComments.id))
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
  // The people you blocked, with where and your private note (Blocking B30). Never who blocked you (B31).
  yield "],\"blocks\":";
  assertActive(signal);
  yield json(await db
    .select({ username: profiles.username, name: profiles.fullName, source: userBlocks.source, note: userBlocks.note, createdAt: userBlocks.createdAt })
    .from(userBlocks)
    .innerJoin(profiles, eq(profiles.id, userBlocks.blockedId))
    .where(and(eq(userBlocks.blockerId, userId), lte(userBlocks.createdAt, exportedAt)))
    .orderBy(asc(userBlocks.createdAt)));
  yield ",\"messages\":{\"items\":";

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
  yield `,"note":${json("Only messages you wrote are included; other people’s messages are not exported.")}`;
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
  assertActive(signal);
  yield `],"organizations":${json(await exportOrganizationData(userId))}`;
  assertActive(signal);
  yield `,"fileDownloads":${json(await exportDownloadHistory(userId))}`;
  assertActive(signal);
  yield `,"trustAndSafety":${json(await exportTrustData(userId))}}`;
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
