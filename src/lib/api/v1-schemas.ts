/**
 * Request bodies of the API routes the CLI, MCP tools and agents write to (report A2.11, finding 144): one source
 * for the routes' own checks, the generated `public/api/v1/openapi.json` and `packages/nb-cli/schema/api.json`
 * (`npx tsx scripts/api/export-schemas.ts`; tests/unit/api-schemas-fresh fails when they're stale).
 */
import { z } from "zod";

import { extensionReviewEvidenceSchema } from "@/lib/extension/review-evidence";
import { FILE_REVISION_MODES } from "@/lib/files/revision-policy";
import { taskDueDateSchema, taskSubtaskTitleSchema } from "@/lib/validations/task";

const checksumSchema = z.string().regex(/^[a-f0-9]{64}$/i);
export const MAX_FAST_PUSH_BATCH_BYTES = 4 * 1024 * 1024; // 4 MiB total inline fast-path ceiling
export const MAX_FAST_PUSH_FILES = 50;

// extension/fast-push
export const filePlaceRole = z.enum(["deliverable", "working", "reference", "final", "draft"]);

// extension/fast-push
export const filePlaceItemSchema = z.object({
  path: z.string().min(1).max(2048),
  contentHash: checksumSchema,
  size: z.number().int().nonnegative().max(MAX_FAST_PUSH_BATCH_BYTES),
  mimeType: z.string().min(1).max(180),
  contentBase64: z.string().optional(),
  comment: z.string().max(500).optional().nullable(),
  /** The version this edit started from; a newer version on the server is a conflict, not an overwrite (A1.8, F18). */
  baseVersion: z.number().int().positive().optional().nullable(),
  /** Save as a new version of this file wherever it lives (a drop on a file row, report §19.3). */
  versionOf: z.string().uuid().optional(),
});

// extension/fast-push
export const filePlaceSchema = z.object({
  projectId: z.string().uuid(),
  taskId: z.string().max(120).optional().nullable(),
  role: filePlaceRole.optional(),
  transitionStatus: z.enum(["in_progress", "done"]).optional().nullable(),
  completeSubtaskIds: z.array(z.string().uuid()).max(100).optional(),
  completeAllSubtasks: z.boolean().optional(),
  message: z.string().max(500).optional().nullable(),
  operationId: z.string().min(8).max(200).optional().nullable(),
  files: z.array(filePlaceItemSchema).min(1).max(MAX_FAST_PUSH_FILES),
  /** Same name in the target folder: a new version (default, report D13) or a separate copy `name (2).ext`. */
  onSameName: z.enum(["version", "keep-both"]).optional(),
  /** Workspace folder the paths are relative to (a drop on a folder). */
  folder: z.string().max(1024).optional(),
  /** The person saw the secret warning and still wants these files saved (never for agents, Phase 3). */
  confirmSecrets: z.boolean().optional(),
  /** The one new file becomes this doc's file: a doc with no file yet, like a new workspace's starter README. */
  linkDoc: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/).optional(),
});

// extension/create-task
export const createTaskSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(10000).optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  /** Everything at once (report C2). Left out, the task is yours; null leaves it unassigned (C16 #3). */
  assigneeId: z.string().uuid().nullable().optional(),
  dueDate: taskDueDateSchema.nullable().optional(),
  sprintId: z.string().uuid().nullable().optional(),
});

// extension/task-subtask
export const addSubtaskSchema = z.object({
  projectId: z.string().uuid(),
  taskId: z.string().min(1),
  title: taskSubtaskTitleSchema,
});

// extension/task-update
/** A task's labels, "blocked by", links, watch and star (report C2, C12, 0087). */
const label = z.string().trim().toLowerCase().min(1).max(32).regex(/^[a-z0-9][a-z0-9 _-]*$/, "Labels are letters, numbers, spaces, - and _");
const addRemove = <T extends z.ZodTypeAny>(item: T) => z.object({ add: z.array(item).max(20).optional(), remove: z.array(item).max(20).optional() }).strict();
export const taskMetaSchema = z.object({
  labels: addRemove(label).optional(),
  blockedBy: addRemove(z.string().uuid()).optional(),
  links: z.object({
    add: z.array(z.object({ url: z.string().url().max(2000).refine((u) => u.startsWith("https://"), "Links start with https://"), title: z.string().trim().max(300).optional() })).max(10).optional(),
    remove: z.array(z.string().max(2000)).max(10).optional(),
  }).strict().optional(),
  watch: z.boolean().optional(),
  star: z.boolean().optional(),
}).strict();

/** `nb task remind` (report C2, 0088): when, as an instant, and an optional note. */
export const taskReminderSchema = z.object({ at: z.string().datetime({ offset: true }), note: z.string().trim().max(300).optional() }).strict();

/** Several tasks at once (report C2): one request, all or nothing, one undo. */
export const bulkTaskSchema = z.object({
  projectId: z.string().uuid(),
  taskIds: z.array(z.string().uuid()).min(1).max(50),
  change: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("status"), status: z.enum(["todo", "in_progress", "done", "blocked"]), note: z.string().trim().max(2000).optional() }),
    z.object({ kind: z.literal("assign"), assigneeId: z.string().uuid().nullable() }),
    z.object({ kind: z.literal("edit"), field: z.enum(["priority", "dueDate"]), value: z.string().max(100).nullable() }),
  ]),
});

export const taskUpdateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("request_changes"), projectId: z.string().uuid(), taskId: z.string().uuid(), reason: z.string().trim().min(1).max(2000), expectedUpdatedAt: z.string().datetime() }),
  z.object({ kind: z.literal("resubmit"), projectId: z.string().uuid(), taskId: z.string().uuid(), expectedUpdatedAt: z.string().datetime() }),
  z.object({
    kind: z.literal("approve"),
    projectId: z.string().uuid(),
    taskId: z.string().uuid(),
    expectedUpdatedAt: z.string().datetime(),
  }),
  z.object({
    kind: z.literal("status"),
    projectId: z.string().uuid(),
    taskId: z.string().uuid(),
    status: z.enum(["todo", "in_progress", "done", "blocked"]),
    expectedUpdatedAt: z.string().datetime(),
    evidence: extensionReviewEvidenceSchema.optional(),
  }),
  z.object({
    kind: z.literal("edit"),
    projectId: z.string().uuid(),
    taskId: z.string().uuid(),
    field: z.enum(["title", "description", "priority", "dueDate"]),
    value: z.string().max(10000).nullable(),
  }),
  z.object({ kind: z.literal("assign"), projectId: z.string().uuid(), taskId: z.string().uuid(), assigneeId: z.string().uuid().nullable() }),
  z.object({ kind: z.literal("delete"), projectId: z.string().uuid(), taskId: z.string().uuid() }),
  z.object({ kind: z.literal("subtask_edit"), projectId: z.string().uuid(), taskId: z.string().uuid(), subtaskId: z.string().uuid(), title: z.string().trim().min(1).max(500) }),
  z.object({ kind: z.literal("subtask_delete"), projectId: z.string().uuid(), taskId: z.string().uuid(), subtaskId: z.string().uuid() }),
  z.object({ kind: z.literal("subtask_move"), projectId: z.string().uuid(), taskId: z.string().uuid(), subtaskId: z.string().uuid(), position: z.number().int().min(0).max(1000) }),
  z.object({
    kind: z.literal("subtask"),
    projectId: z.string().uuid(),
    taskId: z.string().uuid(),
    subtaskId: z.string().uuid(),
    completed: z.boolean(),
    expectedUpdatedAt: z.string().datetime(),
  }),
]);

// extension/comments
const anchor = z
  .object({
    version: z.number().int().positive(),
    hash: z.string().regex(/^[a-f0-9]{64}$/i),
    startLine: z.number().int().min(0).max(1000000),
    endLine: z.number().int().min(0).max(1000000),
  })
  .refine((a) => a.endLine >= a.startLine);

export const fileCommentSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("create"),
    projectId: z.string().uuid(),
    nodeId: z.string().uuid(),
    text: z.string().trim().min(1).max(4000),
    anchor,
  }),
  z.object({
    kind: z.literal("reply"),
    projectId: z.string().uuid(),
    nodeId: z.string().uuid(),
    threadId: z.string().uuid(),
    text: z.string().trim().min(1).max(4000),
  }),
  z.object({
    kind: z.literal("resolve"),
    projectId: z.string().uuid(),
    nodeId: z.string().uuid(),
    threadId: z.string().uuid(),
    expectedSequence: z.number().int().nonnegative(),
    resolved: z.boolean(),
  }),
  z.object({
    kind: z.literal("relocate"),
    projectId: z.string().uuid(),
    nodeId: z.string().uuid(),
    threadId: z.string().uuid(),
    expectedSequence: z.number().int().nonnegative(),
    anchor,
  }),
]);

// extension/comments
export const taskCommentSchema = z.union([
  z.object({
    kind: z.literal("task"),
    projectId: z.string().uuid().optional(),
    taskId: z.string().uuid(),
    text: z.string().trim().min(1).max(4000),
    replyTo: z.string().uuid().nullable().optional(),
  }),
  z
    .object({ taskId: z.string().uuid(), content: z.string().trim().min(1).max(4000) })
    .strict()
    .transform((v) => ({ kind: "task" as const, taskId: v.taskId, text: v.content, projectId: undefined, replyTo: null })),
]);

// extension/file-operation
export const fileOperationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("move"),
    projectId: z.string().uuid(),
    nodeId: z.string().uuid(),
    parentId: z.string().uuid().nullable(),
    expectedUpdatedAt: z.string().datetime(),
  }),
  z.object({
    kind: z.literal("rename"),
    projectId: z.string().uuid(),
    nodeId: z.string().uuid(),
    name: z.string().min(1).max(255),
    expectedUpdatedAt: z.string().datetime(),
  }),
  z.object({
    kind: z.literal("trash"),
    projectId: z.string().uuid(),
    nodeId: z.string().uuid(),
    expectedUpdatedAt: z.string().datetime(),
  }),
]);

// extension/bulk-intent
export const bulkIntentItemSchema = z.object({
  path: z.string().min(1).max(2_048),
  size: z.number().int().nonnegative(),
  mimeType: z.string().min(1).max(180),
  contentHash: checksumSchema,
  leaseId: z.string().uuid().optional().nullable(),
  fencingToken: z.number().int().positive().optional().nullable(),
  comment: z.string().max(500).optional().nullable(),
});

// extension/bulk-intent
export const bulkIntentSchema = z.object({
  projectId: z.string().uuid(),
  clientSessionId: z.string().uuid().optional(),
  operationId: z.string().min(8).max(200).optional().nullable(),
  files: z.array(bulkIntentItemSchema).min(1).max(50),
});

// extension/bulk-finalize
export const bulkFinalizeItemSchema = z.object({
  path: z.string().min(1).max(2_048),
  uploadIntentId: z.string().uuid(),
  checksum: checksumSchema,
  revisionMode: z.enum(FILE_REVISION_MODES).optional(),
  comment: z.string().max(500).optional().nullable(),
});

// extension/bulk-finalize
export const bulkFinalizeSchema = z.object({
  projectId: z.string().uuid(),
  uploadSessionId: z.string().optional().nullable(),
  files: z.array(bulkFinalizeItemSchema).min(1).max(50),
});

// device/code
export const deviceCodeSchema = z.object({
  clientName: z.string().trim().min(1).max(80),
  deviceName: z.string().trim().min(1).max(120),
  clientVersion: z.string().trim().max(40).optional().nullable(),
  platform: z.string().trim().max(40).optional().nullable(),
  type: z.enum(["device", "agent"]).optional(),
  agentName: z.string().trim().max(80).optional().nullable(),
  /** What the CLI asks for (report A5); the approval page pre-fills it and the person can change it. */
  requestedAccess: z.enum(["full", "small", "read"]).optional().nullable(),
  requestedWorkspace: z.union([z.literal("all"), z.string().uuid()]).optional().nullable(),
});

// device/token
/** renew: this computer's current token (proof it's theirs), closed once the new one is made (report C6). */
export const deviceTokenSchema = z.object({ deviceCode: z.string().min(20).max(200), renew: z.string().min(20).max(200).optional() });
