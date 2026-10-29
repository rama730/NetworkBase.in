"use server";

import { sql } from "drizzle-orm";
import { shareDestinationWorkspaceion } from "@/lib/sharing/destination-read";
import { chatFailure, chatRows, invalidInput, isUuid, requireChatUser, unauthorized } from "@/lib/messaging/server";
import type { ConversationScope } from "@/lib/sharing/destination-scope";
import type { ShareDestination, ShareWorkspace } from "@/lib/sharing/destination-scope";

type Cursor = { id: string; starred: number; default: number; name: string; time: string };
type Row = ShareDestination & { sort_time: string | Date; sort_name: string; sort_star: number; sort_default: number };

/** Joined conversations only, with live capability and stable keyset pagination; never joins/creates a channel. */
export async function listShareDestinations(input: { scope: ConversationScope; query?: string; cursor?: string | null; expectedActorId: string; limit?: number }) {
  const user = await requireChatUser();
  if (!user || input?.expectedActorId !== user.id) return unauthorized;
  const scope = input?.scope;
  if (!scope || !["project", "project-applications", "dms", "groups", "applications"].includes(scope.kind)
    || ("projectId" in scope && !isUuid(scope.projectId)) || (["project", "project-applications"].includes(scope.kind) && !("projectId" in scope))
    || (input.query !== undefined && (typeof input.query !== "string" || input.query.length > 100))) return invalidInput;
  let cursor: Cursor | null = null;
  if (input.cursor) {
    try {
      if (typeof input.cursor !== "string" || input.cursor.length > 2048) return invalidInput;
      cursor = JSON.parse(Buffer.from(input.cursor, "base64url").toString());
      if (!cursor || !isUuid(cursor.id) || ![0,1].includes(cursor.starred) || ![0,1].includes(cursor.default)
        || typeof cursor.name !== "string" || Array.from(cursor.name).length > 300 || typeof cursor.time !== "string" || !Number.isFinite(Date.parse(cursor.time))) return invalidInput;
    } catch { return invalidInput; }
  }
  const query = input.query?.trim() ?? "";
  const pattern = `%${query.replace(/[%_\\]/g, "\\$&")}%`;
  const limit = Number.isInteger(input.limit) ? Math.min(50,Math.max(1,input.limit!)) : 50;
  const projectId = "projectId" in scope ? scope.projectId : null;
  const filter = scope.kind === "project" ? sql`c.project_id = ${projectId}::uuid AND c.application_id IS NULL AND app_private.chat_is_project_member(c.project_id, ${user.id}::uuid)`
    : scope.kind === "project-applications" ? sql`c.project_id = ${projectId}::uuid AND c.application_id IS NOT NULL AND app_private.chat_is_project_member(c.project_id, ${user.id}::uuid)`
    : scope.kind === "applications" ? sql`c.application_id IS NOT NULL`
    : scope.kind === "dms" ? sql`c.kind = 'dm' AND c.project_id IS NULL AND c.application_id IS NULL`
    : sql`c.kind = 'private' AND c.project_id IS NULL AND c.application_id IS NULL`;
  const projectOrder = scope.kind === "project";
  const after = !cursor ? sql`TRUE` : projectOrder
    ? sql`(-sort_star, -sort_default, sort_name, id) > (${-cursor.starred}, ${-cursor.default}, ${cursor.name}, ${cursor.id}::uuid)`
    : sql`(sort_star, sort_time::timestamptz, id) < (${cursor.starred}, ${cursor.time}::timestamptz, ${cursor.id}::uuid)`;
  try {
    let project:null|{id:string;title:string;slug:string|null;cover_image:string|null;role:string}=null;
    if(projectId) {
      const [access]=await chatRows<NonNullable<typeof project>>(sql`SELECT p.id,p.title,p.slug,p.cover_image,m.role FROM projects p JOIN project_members m ON m.project_id=p.id
        WHERE p.id=${projectId}::uuid AND m.user_id=${user.id}::uuid AND p.deleted_at IS NULL`);
      if(!access)return {success:false as const,error:'chat_not_member'};
      project=access;
    }
    const rows = await chatRows<Row>(sql`
      WITH eligible AS (
        SELECT ${shareDestinationWorkspaceion(user.id)}, coalesce(c.last_message_at,m.joined_at)::text AS sort_time,
          left(lower(coalesce(c.name,c.title,c.id::text)),300) AS sort_name,
          m.starred::int AS sort_star, c.is_default::int AS sort_default
        FROM chat_channel_members m JOIN chat_channels c ON c.id = m.channel_id
        LEFT JOIN projects p ON p.id = c.project_id
        WHERE m.user_id = ${user.id}::uuid AND m.archived_at IS NULL AND c.archived_at IS NULL
          AND (c.project_id IS NULL OR (p.id IS NOT NULL AND p.deleted_at IS NULL)) AND ${filter}
      )
      SELECT * FROM eligible WHERE ${after} AND (${query === ""} OR
        concat_ws(' ',name,title,dm_user->>'full_name',dm_user->>'username',project_title) ILIKE ${pattern} ESCAPE '\\')
      ORDER BY ${projectOrder ? sql`sort_star DESC, sort_default DESC, sort_name ASC, id ASC` : sql`sort_star DESC, sort_time::timestamptz DESC, id DESC`}
      LIMIT ${limit + 1}
    `);
    const page = rows.slice(0,limit);
    const last = page.at(-1);
    const nextCursor = rows.length > limit && last ? Buffer.from(JSON.stringify({ id:last.id,starred:last.sort_star,default:last.sort_default,
      // Preserve PostgreSQL microseconds; converting the key to a JS Date can skip nearby conversations.
      name:last.sort_name,time:typeof last.sort_time==='string'?last.sort_time:last.sort_time.toISOString() } satisfies Cursor)).toString("base64url") : null;
    return { success:true as const, viewerId:user.id, project, channels:page.map(({sort_time:_time,sort_name:_name,sort_star:_star,sort_default:_default,...channel}) => ({...channel,
      last_message_at:channel.last_message_at ? new Date(channel.last_message_at).toISOString() : null})), nextCursor };
  } catch (error) { return chatFailure(error,"conversation_destinations"); }
}

/** A fresh member-only lookup used by the sharing picker and share-send preflight. */
export async function getShareDestination(input:{channelId:string;expectedActorId:string}) {
  const user=await requireChatUser();
  if(!user||input?.expectedActorId!==user.id)return unauthorized;
  if(!isUuid(input.channelId))return invalidInput;
  try {
    const [channel]=await chatRows<ShareDestination>(sql`SELECT ${shareDestinationWorkspaceion(user.id)}, TRUE AS is_member
      FROM chat_channel_members m JOIN chat_channels c ON c.id=m.channel_id LEFT JOIN projects p ON p.id=c.project_id
      WHERE m.user_id=${user.id}::uuid AND c.id=${input.channelId}::uuid`);
    if(!channel)return {success:false as const,error:'chat_not_member'};
    return {success:true as const,viewerId:user.id,channel};
  } catch(error){return chatFailure(error,'share_destination');}
}

/** Projects are fetched for sharing only; the Messages bootstrap and sorting are unchanged. */
export async function listShareWorkspaces(input:{expectedActorId:string;query?:string;cursor?:string|null;limit?:number}) {
  const user=await requireChatUser();
  if(!user||input?.expectedActorId!==user.id)return unauthorized;
  if(input.query!==undefined&&(typeof input.query!=='string'||input.query.length>100))return invalidInput;
  let cursor:{id:string;name:string}|null=null;
  if(input.cursor){try{if(typeof input.cursor!=='string'||input.cursor.length>2048)return invalidInput;cursor=JSON.parse(Buffer.from(input.cursor,'base64url').toString());
    if(!cursor||!isUuid(cursor.id)||typeof cursor.name!=='string'||Array.from(cursor.name).length>300)return invalidInput;}catch{return invalidInput;}}
  const query=input.query?.trim()??'';
  const pattern=`%${query.replace(/[%_\\]/g,'\\$&')}%`;
  const limit=Number.isInteger(input.limit)?Math.min(50,Math.max(1,input.limit!)):50;
  try {
    const rows=await chatRows<ShareWorkspace&{sort_name:string}>(sql`
      SELECT p.id,p.title,p.slug,p.cover_image,m.role,left(lower(p.title),300) AS sort_name,
        (SELECT count(*)::int FROM chat_channel_members cm JOIN chat_channels c ON c.id=cm.channel_id
          WHERE cm.user_id=${user.id}::uuid AND c.project_id=p.id AND c.application_id IS NULL AND cm.archived_at IS NULL AND c.archived_at IS NULL) AS joined_channels,
        (SELECT coalesce(sum(cm.mention_count),0)::int FROM chat_channel_members cm JOIN chat_channels c ON c.id=cm.channel_id
          WHERE cm.user_id=${user.id}::uuid AND c.project_id=p.id AND cm.archived_at IS NULL AND c.archived_at IS NULL) AS mention_count
      FROM project_members m JOIN projects p ON p.id=m.project_id WHERE m.user_id=${user.id}::uuid AND p.deleted_at IS NULL
        AND (${query===''} OR concat_ws(' ',p.title,p.slug) ILIKE ${pattern} ESCAPE '\\')
        AND ${cursor?sql`(left(lower(p.title),300),p.id)>(${cursor.name},${cursor.id}::uuid)`:sql`TRUE`}
      ORDER BY sort_name,p.id LIMIT ${limit+1}`);
    const page=rows.slice(0,limit),last=page.at(-1);
    return {success:true as const,viewerId:user.id,projects:page.map(({sort_name:_sort,...project})=>project),
      nextCursor:rows.length>limit&&last?Buffer.from(JSON.stringify({id:last.id,name:last.sort_name})).toString('base64url'):null};
  }catch(error){return chatFailure(error,'share_projects');}
}
