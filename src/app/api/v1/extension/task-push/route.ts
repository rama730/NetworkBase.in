import {requireAuthenticatedUser,requireTokenScope,jsonSuccess,jsonError,getRequestId,idempotentWrite} from '@/app/api/v1/_shared';
import { startCopyOnWork } from "@/lib/organizations/assignments";
import {db} from '@/lib/db';
import {taskPushes,tasks,workspaceNodes,taskNodeLinks,fileVersions,workspaceGitCommits} from '@/lib/db/schema';
import {eq,and,inArray,isNull,sql} from 'drizzle-orm';
import {routeErrorResponse} from '@/app/api/v1/_error';
import {assertWorkspaceWriteAccessTx,recordNodeEventsBatch} from '@/lib/files/internal-helpers';
import {replaceTaskFileRoleTag,type TaskFileRole} from '@/lib/workspaces/task-file-intelligence';
import {validateCsrf} from '@/lib/security/csrf';
import {consumeRateLimit} from '@/lib/security/rate-limit';
import {inngest} from '@/inngest/client';
import {pushTransitionTarget,transitionAfterPush} from '@/lib/domain/task-transition';
import crypto from 'crypto';
import {z} from 'zod';
import { viaColumns } from "@/lib/server/request-via";
export const runtime='nodejs';

const roleEnum = z.enum(['deliverable', 'working', 'reference']);

const schema = z.object({
  taskId: z.string().uuid(),
  projectId: z.string().uuid(),
  taskAction: z.enum(['upload_to_task', 'replace_task_version']).default('upload_to_task'),
  role: roleEnum.optional(),
  transitionStatus: z.enum(['in_progress', 'done']).optional(),
  message: z.string().max(500).optional(),
  files: z
    .array(
      z.object({
        nodeId: z.string().uuid(),
        version: z.number().int().positive(),
        contentHash: z.string().regex(/^[a-f0-9]{64}$/i),
        role: roleEnum.optional(),
      }),
    )
    .min(1)
    .max(100),
});

function annotationForRole(role: TaskFileRole) {
  if (role === 'deliverable') return '#deliverable';
  if (role === 'reference') return '#reference';
  return '#editor_working';
}

async function handlePost(request:Request){
 const csrfError=validateCsrf(request);if(csrfError)return csrfError;
 try{
  const auth=await requireAuthenticatedUser();if(auth.response)return auth.response;if(!auth.user)return jsonError('Sign in to continue',401,'UNAUTHORIZED');const user=auth.user;
  const parsed=schema.safeParse(await request.json());if(!parsed.success)return jsonError('Invalid task file receipt request',400,'BAD_REQUEST');const {taskId,projectId,taskAction,role:defaultRole,transitionStatus,files,message}=parsed.data;
  const scopeDenied=(defaultRole==='deliverable'||files.some(f=>f.role==='deliverable')?requireTokenScope(auth,'file:final'):null)??(transitionStatus==='done'?requireTokenScope(auth,'task:complete'):null);if(scopeDenied)return scopeDenied;
  const operationId=request.headers.get('idempotency-key')?.trim() || crypto.randomUUID();if(operationId.length>200)return jsonError('A stable operation id is required',400,'BAD_REQUEST');
  if(!(await consumeRateLimit(`extension-task-push:${user.id}`,60,60)).allowed)return jsonError('Too many attempts. Try again in a minute.',429,'RATE_LIMITED');
  let statusTarget: 'in_progress' | 'done' | null = null;
  const pushRow=await db.transaction(async tx=>{
   // Decision 173: names its copy, so members push to their own and never to handed-in work.
   await assertWorkspaceWriteAccessTx(tx,projectId,user.id,{taskId});
   // The project lock serializes receipts even when Redis is unavailable or a response is lost.
   const existing=await tx.query.taskPushes.findFirst({where:and(eq(taskPushes.taskId,taskId),eq(taskPushes.projectId,projectId),eq(taskPushes.pushedBy,user.id),sql`${taskPushes.filesJson} @> ${JSON.stringify([{operationId}])}::jsonb`)});if(existing){const recorded=Array.isArray(existing.filesJson)?existing.filesJson as Array<{nodeId:string;version:number;contentHash:string;taskAction:string}>:[];const normalize=(items:typeof recorded)=>JSON.stringify(items.map(f=>({nodeId:f.nodeId,version:f.version,contentHash:f.contentHash,taskAction:f.taskAction})).sort((a,b)=>a.nodeId.localeCompare(b.nodeId)));if(normalize(recorded)!==normalize(files.map(f=>({...f,taskAction}))))throw new Error('Operation ID was already used for different task file effects');return existing;}
   const task=await tx.query.tasks.findFirst({where:and(eq(tasks.id,taskId),eq(tasks.projectId,projectId),isNull(tasks.deletedAt))});if(!task)throw new Error('Task is unavailable');
   const nodeIds=[...new Set(files.map(f=>f.nodeId))];if(nodeIds.length!==files.length)throw new Error('Duplicate task file receipt');
   const nodes=await tx.select({id:workspaceNodes.id,path:workspaceNodes.path,name:workspaceNodes.name,currentVersion:workspaceNodes.currentVersion,contentHash:fileVersions.contentHash}).from(workspaceNodes).innerJoin(fileVersions,and(eq(fileVersions.nodeId,workspaceNodes.id),eq(fileVersions.version,workspaceNodes.currentVersion))).where(and(inArray(workspaceNodes.id,nodeIds),eq(workspaceNodes.projectId,projectId),eq(workspaceNodes.type,'file'),isNull(workspaceNodes.deletedAt)));
   if(nodes.length!==nodeIds.length)throw new Error('A published file is unavailable in this workspace');
   const links=await tx.select({nodeId:taskNodeLinks.nodeId,order:taskNodeLinks.order,tags:taskNodeLinks.tags}).from(taskNodeLinks).where(eq(taskNodeLinks.taskId,taskId));const linkedMap=new Map(links.map(l=>[l.nodeId,l]));const additions=nodes.filter(n=>!linkedMap.has(n.id));if(links.length+additions.length>200)throw new Error('A task can have at most 200 linked files');
   for(const file of files){const node=nodes.find(n=>n.id===file.nodeId)!;if(file.version!==undefined&&node.currentVersion!==file.version||file.contentHash!==undefined&&node.contentHash!==file.contentHash)throw new Error('A file changed after publication. Inspect its current version before retrying task effects.');}
   const resolvedDefaultRole: TaskFileRole = defaultRole ?? (taskAction === 'replace_task_version' ? 'deliverable' : 'working');
   const roleByNodeId = new Map<string, TaskFileRole>(files.map(f => [f.nodeId, f.role ?? resolvedDefaultRole]));
   if(additions.length){
    await tx.insert(taskNodeLinks).values(additions.map((node,index)=>{
     const fileRole = roleByNodeId.get(node.id) ?? resolvedDefaultRole;
     return {taskId,nodeId:node.id,createdBy:user.id,order:Math.max(0,...links.map(link=>link.order))+index+1,annotation:annotationForRole(fileRole),tags:replaceTaskFileRoleTag([],fileRole)};
    })).onConflictDoNothing({target:[taskNodeLinks.taskId,taskNodeLinks.nodeId]});
    // Assignment flow decision 1: files pushed to a copy in To do start it.
    await startCopyOnWork(tx, taskId, user.id, { kind: "file", name: additions.length === 1 ? additions[0]!.name ?? null : null });
   }
   // Update existing linked files when their role changes (e.g. promoting working -> deliverable)
   for(const existingNode of nodes.filter(n=>linkedMap.has(n.id))){
    const existingLink = linkedMap.get(existingNode.id)!;
    const fileRole = roleByNodeId.get(existingNode.id) ?? resolvedDefaultRole;
    const updatedTags = replaceTaskFileRoleTag(existingLink.tags, fileRole);
    await tx.update(taskNodeLinks).set({tags:updatedTags,annotation:annotationForRole(fileRole),linkedAt:new Date()}).where(and(eq(taskNodeLinks.taskId,taskId),eq(taskNodeLinks.nodeId,existingNode.id)));
   }
   // Status moves after commit through the task rules (review, permissions, notifications), never here (F31).
   statusTarget = pushTransitionTarget({ current: task.status, requested: transitionStatus, role: resolvedDefaultRole });
   const [created]=await tx.insert(taskPushes).values({taskId,projectId,message:message||`Pushed ${nodes.length} ${resolvedDefaultRole} file(s)`,filesCount:nodes.length,pushedBy:user.id,filesJson:nodes.map(node=>({nodeId:node.id,path:node.path,name:node.name,version:node.currentVersion,contentHash:node.contentHash,role:roleByNodeId.get(node.id)??resolvedDefaultRole,taskAction,operationId}))}).returning();if(!created)throw new Error('Couldn’t record task receipt');
   await recordNodeEventsBatch(projectId,user.id,nodeIds,'extension_task_push',{taskId,taskAction,role:resolvedDefaultRole,filesCount:nodes.length,nodeIds,operationId,pushId:created.id},tx);
   return created;
  });
  const transition = statusTarget ? await transitionAfterPush(user, taskId, statusTarget) : null;
  const commitSha = crypto.createHash('sha1').update(`${pushRow.id}:${operationId}`).digest('hex');
  const resolvedFinalRole = defaultRole ?? (taskAction === 'replace_task_version' ? 'deliverable' : 'working');
  const via = await viaColumns();
  void db.insert(workspaceGitCommits).values({
   ...via,
   projectId,
   commitSha,
   authorId: user.id,
   authorName: (user.user_metadata?.full_name as string) || user.email || 'Developer',
   authorEmail: user.email ?? '' /* no made-up address (F78) */,
   message: message || `Pushed ${files.length} file(s)`,
   taskId,
   fileRole: resolvedFinalRole,
   filesChangedCount: files.length,
  }).catch(() => {});
  void inngest.send({
   name: 'cli/push.completed',
   data: {
    projectId,
    taskId,
    userId: user.id,
    commitSha: commitSha.slice(0, 8),
    role: resolvedFinalRole,
    message: message || `Pushed ${files.length} file(s)`,
    filesCount: files.length,
   },
  }).catch(() => {});
  return jsonSuccess({pushId:pushRow.id,commitSha:commitSha.slice(0,8),role:resolvedFinalRole,timestamp:pushRow.pushedAt.toISOString(),filesCount:pushRow.filesCount,transition});
 }catch(error){return routeErrorResponse(error,{requestId:getRequestId(request),scope:'api/v1/extension/task-push',fallback:'Couldn’t link task file versions'});}
}

/** Retries with the same Idempotency-Key and body write once (report A2.4, F72); the key is required. */
export async function POST(request: Request) {
  return idempotentWrite(request, "extension.task-push", handlePost, { required: true });
}
