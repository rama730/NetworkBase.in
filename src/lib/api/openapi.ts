/**
 * The API description generated from the routes' own request schemas (report A2.11): `public/api/v1/openapi.json`
 * for people and tools, `packages/nb-cli/schema/api.json` for the CLI's tests (its fake server rejects bodies the
 * real server would). Regenerate with `npx tsx scripts/api/export-schemas.ts`.
 */
import { z } from "zod";

import { ERROR_CATALOG } from "@/lib/api/errors";
import * as s from "@/lib/api/v1-schemas";

type Operation = { method: "post" | "patch" | "put"; path: string; summary: string; body: z.ZodType; auth: "token" | "none" };

export const API_OPERATIONS: Operation[] = [
  { method: "post", path: "/api/v1/files/place", summary: "Put files in a workspace: new files, new versions, or on a task with a role", body: s.filePlaceSchema, auth: "token" },
  { method: "post", path: "/api/v1/extension/fast-push", summary: "Same as /api/v1/files/place (CLI 1.x address)", body: s.filePlaceSchema, auth: "token" },
  { method: "post", path: "/api/v1/extension/create-task", summary: "Create a task", body: s.createTaskSchema, auth: "token" },
  { method: "post", path: "/api/v1/extension/task-subtask", summary: "Add a subtask", body: s.addSubtaskSchema, auth: "token" },
  { method: "patch", path: "/api/v1/tasks/{taskId}/meta", summary: "Labels, blocked by, links; watch and star a task", body: s.taskMetaSchema, auth: "token" },
  { method: "put", path: "/api/v1/workspaces/{id}/files/{nodeId}/star", summary: "Star or unstar a file (shared with the Files tab)", body: z.object({ starred: z.boolean() }), auth: "token" },
  { method: "post", path: "/api/v1/tasks/{taskId}/reminders", summary: "Remind me about a task at a time", body: s.taskReminderSchema, auth: "token" },
  { method: "post", path: "/api/v1/agent-sessions/end", summary: "End an agent session: send its held notifications and its What I did list", body: s.agentSessionEndSchema, auth: "token" },
  { method: "patch", path: "/api/v1/extension/comments", summary: "Edit your own task comment", body: s.commentEditSchema, auth: "token" },
  { method: "patch", path: "/api/v1/me/notifications", summary: "Change your notification settings (only the named ones)", body: s.notificationSettingsSchema, auth: "token" },
  { method: "post", path: "/api/v1/workspaces/{id}/members", summary: "Invite someone into an open role (your own sign-in)", body: s.memberInviteSchema, auth: "token" },
  { method: "patch", path: "/api/v1/workspaces/{id}/members", summary: "Change a member’s role (your own sign-in)", body: s.memberRoleSchema, auth: "token" },
  { method: "post", path: "/api/v1/workspaces/{id}/updates/{updateId}", summary: "Like or comment on an update", body: s.updateActionSchema, auth: "token" },
  { method: "post", path: "/api/v1/tasks/bulk", summary: "Move, assign or edit several tasks at once (all or nothing, one undo)", body: s.bulkTaskSchema, auth: "token" },
  { method: "patch", path: "/api/v1/extension/task-update", summary: "Change status, tick a subtask, review or resubmit a task", body: s.taskUpdateSchema, auth: "token" },
  { method: "post", path: "/api/v1/extension/comments", summary: "Comment on a task or a line of a file", body: z.union([s.taskCommentSchema, s.fileCommentSchema]), auth: "token" },
  { method: "post", path: "/api/v1/extension/file-operation", summary: "Move, rename or trash a file", body: s.fileOperationSchema, auth: "token" },
  { method: "post", path: "/api/v1/extension/bulk-intent", summary: "Ask for upload slots for large files", body: s.bulkIntentSchema, auth: "token" },
  { method: "post", path: "/api/v1/extension/bulk-finalize", summary: "Save large files after uploading them", body: s.bulkFinalizeSchema, auth: "token" },
  { method: "post", path: "/api/v1/device/code", summary: "Start sign-in with a code (terminals without a browser)", body: s.deviceCodeSchema, auth: "none" },
  { method: "post", path: "/api/v1/device/token", summary: "Poll for the token after the code is approved", body: s.deviceTokenSchema, auth: "none" },
];

const jsonSchema = (schema: z.ZodType) => z.toJSONSchema(schema, { io: "input", unrepresentable: "any" });

/** Request body schemas by "METHOD /path", for the CLI's fake server. */
export function cliSchemas() {
  return {
    $comment: "Generated from src/lib/api/v1-schemas.ts by scripts/api/export-schemas.ts. Don't edit.",
    operations: Object.fromEntries(API_OPERATIONS.map((op) => [`${op.method.toUpperCase()} ${op.path}`, jsonSchema(op.body)])),
    errors: ERROR_CATALOG,
  };
}

export function openApiDocument(version: string) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const op of API_OPERATIONS) {
    paths[op.path] = {
      ...(paths[op.path] ?? {}),
      [op.method]: {
        summary: op.summary,
        security: op.auth === "token" ? [{ bearer: [] }] : [],
        requestBody: { required: true, content: { "application/json": { schema: jsonSchema(op.body) } } },
        responses: {
          "200": { description: "`{ success: true, data }`" },
          "4XX": { description: "`{ success: false, errorCode, message, details? }`" },
        },
      },
    };
  }
  return {
    openapi: "3.1.0",
    info: { title: "NetworkBase API (CLI and agents)", version, description: "Routes the NetworkBase CLI, its MCP server and AI agents write to. Tokens: `Authorization: Bearer nb_dev_… | nb_agt_… | nb_pat_…`." },
    components: { securitySchemes: { bearer: { type: "http", scheme: "bearer" } } },
    "x-error-codes": ERROR_CATALOG,
    paths,
  };
}

/** packages/nb-cli/lib/error-fixes.mjs: the catalog's next steps, for the CLI (report C5). */
export function cliErrorFixes() {
  const fixes = Object.fromEntries(Object.entries(ERROR_CATALOG).map(([code, e]) => [code, e.fix]));
  return `// Generated by scripts/api/export-schemas.ts from src/lib/api/errors.ts. Do not edit.\n/** Each error code's next step (report C5); every code here has an entry on /docs/cli. */\nexport const FIXES = /** @type {Record<string, string>} */ (${JSON.stringify(fixes, null, 2)});\n`;
}
