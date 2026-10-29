import {requireAuthenticatedUser,jsonSuccess,jsonError,getRequestId} from '@/app/api/v1/_shared';
import {db} from '@/lib/db';
import {taskPushes,tasks,projectNodes,taskNodeLinks,fileVersions} from '@/lib/db/schema';
import {eq,and,inArray,isNull,sql} from 'drizzle-orm';
import {routeErrorResponse} from '@/app/api/v1/_error';
import {assertProjectWriteAccessTx,recordNodeEventsBatch} from '@/lib/files/internal-helpers';
import {replaceTaskFileRoleTag} from '@/lib/projects/task-file-intelligence';
import {validateCsrf} from '@/lib/security/csrf';
import {consumeRateLimit} from '@/lib/security/rate-limit';
import {z} from 'zod';
export const runtime='nodejs';
const schema=z.object({taskId:z.string().uuid(),projectId:z.string().uuid(),taskAction:z.enum(['upload_to_task','replace_task_version']),message:z.string().max(500).optional(),files:z.array(z.object({nodeId:z.string().uuid(),version:z.number().int().positive(),contentHash:z.string().regex(/^[a-f0-9]{64}$/i)})).min(1).max(100)});
export async function POST(request:Request){
 const csrfError=validateCsrf(request);if(csrfError)return csrfError;
 try{
  const auth=await requireAuthenticatedUser();if(auth.response)return auth.response;if(!auth.user)return jsonError('Sign in to continue',401,'UNAUTHORIZED');const user=auth.user;
  const parsed=schema.safeParse(await request.json());if(!parsed.success)return jsonError('Invalid task file receipt request',400,'BAD_REQUEST');const {taskId,projectId,taskAction,files,message}=parsed.data;
  const operationId=request.headers.get('idempotency-key')?.trim();if(!operationId||operationId.length>200)return jsonError('A stable operation id is required',400,'BAD_REQUEST');
  if(!(await consumeRateLimit(`extension-task-push:${user.id}`,60,60)).allowed)return jsonError('Too many attempts. Try again in a minute.',429,'RATE_LIMITED');
  const pushRow=await db.transaction(async tx=>{
   await assertProjectWriteAccessTx(tx,projectId,user.id);
   // The project lock serializes receipts even when Redis is unavailable or a response is lost.
   const existing=await tx.query.taskPushes.findFirst({where:and(eq(taskPushes.taskId,taskId),eq(taskPushes.projectId,projectId),eq(taskPushes.pushedBy,user.id),sql`${taskPushes.filesJson} @> ${JSON.stringify([{operationId}])}::jsonb`)});if(existing){const recorded=Array.isArray(existing.filesJson)?existing.filesJson as Array<{nodeId:string;version:number;contentHash:string;taskAction:string}>:[];const normalize=(items:typeof recorded)=>JSON.stringify(items.map(f=>({nodeId:f.nodeId,version:f.version,contentHash:f.contentHash,taskAction:f.taskAction})).sort((a,b)=>a.nodeId.localeCompare(b.nodeId)));if(normalize(recorded)!==normalize(files.map(f=>({...f,taskAction}))))throw new Error('Operation ID was already used for different task file effects');return existing;}
   const task=await tx.query.tasks.findFirst({where:and(eq(tasks.id,taskId),eq(tasks.projectId,projectId),isNull(tasks.deletedAt))});if(!task)throw new Error('Task is unavailable');
   const nodeIds=[...new Set(files.map(f=>f.nodeId))];if(nodeIds.length!==files.length)throw new Error('Duplicate task file receipt');
   const nodes=await tx.select({id:projectNodes.id,path:projectNodes.path,name:projectNodes.name,currentVersion:projectNodes.currentVersion,contentHash:fileVersions.contentHash}).from(projectNodes).innerJoin(fileVersions,and(eq(fileVersions.nodeId,projectNodes.id),eq(fileVersions.version,projectNodes.currentVersion))).where(and(inArray(projectNodes.id,nodeIds),eq(projectNodes.projectId,projectId),eq(projectNodes.type,'file'),isNull(projectNodes.deletedAt)));
   if(nodes.length!==nodeIds.length)throw new Error('A published file is unavailable in this project');
   const links=await tx.select({nodeId:taskNodeLinks.nodeId,order:taskNodeLinks.order}).from(taskNodeLinks).where(eq(taskNodeLinks.taskId,taskId));const linked=new Set(links.map(l=>l.nodeId));const additions=nodes.filter(n=>!linked.has(n.id));if(links.length+additions.length>200)throw new Error('A task can have at most 200 linked files');
   for(const file of files){const node=nodes.find(n=>n.id===file.nodeId)!;if(file.version!==undefined&&node.currentVersion!==file.version||file.contentHash!==undefined&&node.contentHash!==file.contentHash)throw new Error('A file changed after publication. Inspect its current revision before retrying task effects.');}
   if(additions.length)await tx.insert(taskNodeLinks).values(additions.map((node,index)=>({taskId,nodeId:node.id,createdBy:user.id,order:Math.max(0,...links.map(link=>link.order))+index+1,annotation:'#editor_working',tags:replaceTaskFileRoleTag([],'working')}))).onConflictDoNothing({target:[taskNodeLinks.taskId,taskNodeLinks.nodeId]});
   const [created]=await tx.insert(taskPushes).values({taskId,projectId,message:message||'Linked reviewed editor file revisions',filesCount:nodes.length,pushedBy:user.id,filesJson:nodes.map(node=>({nodeId:node.id,path:node.path,name:node.name,version:node.currentVersion,contentHash:node.contentHash,taskAction,operationId}))}).returning();if(!created)throw new Error('Couldn’t record task receipt');
   await recordNodeEventsBatch(projectId,user.id,nodeIds,'extension_task_push',{taskId,taskAction,filesCount:nodes.length,nodeIds,operationId,pushId:created.id},tx);
   return created;
  });
  return jsonSuccess({pushId:pushRow.id,timestamp:pushRow.pushedAt.toISOString(),filesCount:pushRow.filesCount});
 }catch(error){return routeErrorResponse(error,{requestId:getRequestId(request),scope:'api/v1/extension/task-push',fallback:'Couldn’t link task file revisions'});}
}
