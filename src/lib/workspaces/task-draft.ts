import { z } from "zod";

import type { WorkspaceNode } from "@/lib/db/schema";
import { taskPriorityEnum, taskStatusEnum } from "@/lib/validations/task";

const optionalTrimmedText = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value && value.length > 0 ? value : ""));

const optionalUuid = z
  .string()
  .trim()
  .nullish()
  .transform((value) => (value && value.length > 0 ? value : null))
  .refine(
    (value) => value === null || z.string().uuid().safeParse(value).success,
    "Invalid value",
  );

const optionalDate = z
  .string()
  .trim()
  .nullish()
  .transform((value) => (value && value.length > 0 ? value : null))
  .refine(
    (value) => value === null || Number.isFinite(Date.parse(value)),
    "Invalid due date",
  );

const optionalStoryPoints = z
  .union([z.number(), z.string()])
  .nullish()
  .transform((val) => {
    if (val === null || val === undefined || val === "") return null;
    const num = typeof val === "number" ? val : Number.parseInt(String(val), 10);
    return Number.isFinite(num) ? num : null;
  })
  .refine(
    (val) => val === null || (Number.isInteger(val) && val >= 0 && val <= 100),
    "Estimate must be between 0 and 100",
  );

export const taskEditorDraftSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Task title is required")
    .max(500, "Task title is too long"),
  description: optionalTrimmedText,
  sprintId: optionalUuid,
  status: taskStatusEnum.default("todo"),
  priority: taskPriorityEnum.default("medium"),
  assigneeId: optionalUuid,
  dueDate: optionalDate,
  storyPoints: optionalStoryPoints.optional(),
  // Report 38.4: the type and its starting stage; a plain task leaves them out.
  itemType: z.string().regex(/^[a-z_]{1,40}$/).optional(),
  stage: z.string().regex(/^[a-z_]{1,40}$/).nullable().optional(),
  // Report 38.5 (A1.3): a project's start, and the project a task is Part of.
  startDate: optionalDate.optional(),
  partOfId: optionalUuid.optional(),
  // Report 38.6 (A2.1): a typed item's own fields (a bug's severity, steps, Where…); the server checks them.
  typeFields: z.record(z.string(), z.unknown()).optional(),
});

export type TaskEditorDraft = z.infer<typeof taskEditorDraftSchema>;
export type TaskEditorSubtaskDraft = {
  id: string;
  title: string;
};

export function buildTaskSubmitPayload(input: {
  draft: TaskEditorDraft;
  projectId: string;
  subtasks: TaskEditorSubtaskDraft[];
  attachments: WorkspaceNode[];
}) {
  return {
    projectId: input.projectId,
    title: input.draft.title,
    description: input.draft.description || "",
    sprintId: input.draft.sprintId,
    status: input.draft.status,
    priority: input.draft.priority,
    assigneeId: input.draft.assigneeId,
    dueDate: input.draft.dueDate,
    storyPoints: input.draft.storyPoints ?? null,
    ...(input.draft.itemType ? { itemType: input.draft.itemType, stage: input.draft.stage ?? null } : {}),
    ...(input.draft.startDate ? { startDate: input.draft.startDate } : {}),
    ...(input.draft.partOfId ? { partOfId: input.draft.partOfId } : {}),
    ...(input.draft.typeFields && Object.keys(input.draft.typeFields).length ? { typeFields: input.draft.typeFields } : {}),
    attachmentNodeIds: input.attachments.map((attachment) => attachment.id),
    subtasks: input.subtasks
      .map((subtask) => ({ title: subtask.title.trim(), completed: false }))
      .filter((subtask) => subtask.title.length > 0),
  };
}
