"use server";

import { z } from "zod";

import { requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { addWorkflow, addWorkflowsOnCreate, hideWorkflow, orgPushCounts, orgPushedWorkflows, pushWorkflow, readOrgWorkflows, readWorkspaceWorkflows, undoAddWorkflow, unpushWorkflow, workflowRemovalCounts } from "@/lib/workflows/server";

// Report 38.2 F1: the Add workflow dialog, its Undo, the Remove dialog and Settings → Workflows.
const input = z.object({ workspaceId: z.string().uuid(), workflow: z.string().min(1).max(40) });

/** Adding and removing stay in the app (call 9): a CLI or agent token is refused. */
async function signedInManager() {
  const { user, tokenScopes } = await requireAuthenticatedUser();
  if (!user) throw new Error("Sign in to continue");
  if (tokenScopes) throw new Error("Add and remove workflows in the app");
  if (!(await consumeRateLimit(`workflows:${user.id}`, 30, 60)).allowed) throw new Error("Too many attempts. Try again in a minute.");
  return user;
}

const fail = (error: unknown, fallback: string) => ({ success: false as const, error: error instanceof Error ? error.message : fallback });

export async function readWorkflowsAction(workspaceId: string) {
  try {
    z.string().uuid().parse(workspaceId);
    const { user } = await requireAuthenticatedUser();
    return { success: true as const, ...(await readWorkspaceWorkflows(workspaceId, user?.id ?? null)) };
  } catch (error) {
    return fail(error, "Couldn’t load workflows");
  }
}

export async function addWorkflowAction(data: z.infer<typeof input>) {
  try {
    const { workspaceId, workflow } = input.parse(data);
    const user = await signedInManager();
    return { success: true as const, ...(await addWorkflow(workspaceId, user.id, workflow)) };
  } catch (error) {
    return fail(error, "Couldn’t add the workflow");
  }
}

export async function undoAddWorkflowAction(data: z.infer<typeof input>) {
  try {
    const { workspaceId, workflow } = input.parse(data);
    const user = await signedInManager();
    return { success: true as const, ...(await undoAddWorkflow(workspaceId, user.id, workflow)) };
  } catch (error) {
    return fail(error, "Couldn’t undo");
  }
}

export async function workflowRemovalCountsAction(data: z.infer<typeof input>) {
  try {
    const { workspaceId, workflow } = input.parse(data);
    const { user } = await requireAuthenticatedUser();
    if (!user) throw new Error("Sign in to continue");
    return { success: true as const, ...(await workflowRemovalCounts(workspaceId, user.id, workflow)) };
  } catch (error) {
    return fail(error, "Couldn’t count what it holds");
  }
}

export async function removeWorkflowAction(data: z.infer<typeof input>) {
  try {
    const { workspaceId, workflow } = input.parse(data);
    const user = await signedInManager();
    return { success: true as const, ...(await hideWorkflow(workspaceId, user.id, workflow)) };
  } catch (error) {
    return fail(error, "Couldn’t remove the workflow");
  }
}

// ---- Organizations (W8, S10) and the create wizard (W9) ----
const orgInput = z.object({ orgId: z.string().uuid(), workflow: z.string().min(1).max(40) });

export async function readOrgWorkflowsAction(orgId: string) {
  try {
    z.string().uuid().parse(orgId);
    const { user } = await requireAuthenticatedUser();
    return { success: true as const, ...(await readOrgWorkflows(orgId, user?.id ?? null)) };
  } catch (error) {
    return fail(error, "Couldn’t load workflows");
  }
}

export async function orgPushedWorkflowsAction(orgId: string) {
  try {
    z.string().uuid().parse(orgId);
    const { user } = await requireAuthenticatedUser();
    return { success: true as const, ...(await orgPushedWorkflows(orgId, user?.id ?? null)) };
  } catch (error) {
    return fail(error, "Couldn’t load workflows");
  }
}

export async function pushWorkflowAction(data: z.infer<typeof orgInput>) {
  try {
    const { orgId, workflow } = orgInput.parse(data);
    const user = await signedInManager();
    return { success: true as const, ...(await pushWorkflow(orgId, user.id, workflow)) };
  } catch (error) {
    return fail(error, "Couldn’t add it to the workspaces");
  }
}

export async function orgPushCountsAction(data: z.infer<typeof orgInput>) {
  try {
    const { orgId, workflow } = orgInput.parse(data);
    const { user } = await requireAuthenticatedUser();
    if (!user) throw new Error("Sign in to continue");
    return { success: true as const, ...(await orgPushCounts(orgId, user.id, workflow)) };
  } catch (error) {
    return fail(error, "Couldn’t count what it holds");
  }
}

export async function unpushWorkflowAction(data: z.infer<typeof orgInput>) {
  try {
    const { orgId, workflow } = orgInput.parse(data);
    const user = await signedInManager();
    return { success: true as const, ...(await unpushWorkflow(orgId, user.id, workflow)) };
  } catch (error) {
    return fail(error, "Couldn’t remove it from the workspaces");
  }
}

export async function addWorkflowsOnCreateAction(workspaceId: string, workflows: string[]) {
  try {
    z.string().uuid().parse(workspaceId);
    const picked = z.array(z.string().min(1).max(40)).max(20).parse(workflows);
    const user = await signedInManager();
    return { success: true as const, ...(await addWorkflowsOnCreate(workspaceId, user.id, picked)) };
  } catch (error) {
    return fail(error, "Couldn’t add the workflows");
  }
}
