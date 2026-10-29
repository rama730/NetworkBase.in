import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {sql,createUser,createProject,addMember,loadAppModule,closeAppDb,moduleStubs} from './_helpers';
let actor:string|null=null;
moduleStubs.set('@/lib/supabase/auth-user',{getAuthUser:async()=>actor?{id:actor}:null});
let list:typeof import('../../src/app/actions/sharing-destinations')['listShareDestinations'];
let get:typeof import('../../src/app/actions/sharing-destinations')['getShareDestination'];
let projects:typeof import('../../src/app/actions/sharing-destinations')['listShareWorkspaces'];
let owner='',outsider='',peer='',p1='',p2='';const users:string[]=[],channels:string[]=[];
async function channel(kind:string,projectId:string|null,name:string|null,other?:string,applicationId?:string){
  const id=randomUUID();channels.push(id);
  await sql`INSERT INTO chat_channels(id,kind,dm_key,workspace_id,name,application_id,created_by,last_message_at) VALUES (${id},${kind},${kind==='dm'?[owner,other].sort().join(':'):null},${projectId},${name},${applicationId??null},${owner},now())`;
  await sql`INSERT INTO chat_channel_members(channel_id,user_id,role) VALUES (${id},${owner},'owner')`;
  if(other)await sql`INSERT INTO chat_channel_members(channel_id,user_id,role) VALUES (${id},${other},'member')`;
  return id;
}
before(async()=>{
  ({listShareDestinations:list}=await loadAppModule(()=>import('../../src/app/actions/sharing-destinations')));
  ({getShareDestination:get}=await loadAppModule(()=>import('../../src/app/actions/sharing-destinations')));
  ({listShareWorkspaces:projects}=await loadAppModule(()=>import('../../src/app/actions/sharing-destinations')));
  for(let i=0;i<109;i++)users.push(await sql.begin(tx=>createUser(tx)));
  [owner,outsider,peer]=users as [string,string,string];actor=owner;
  p1=await sql.begin(tx=>createProject(tx,owner));p2=await sql.begin(tx=>createProject(tx,owner));
  await sql.begin(async tx=>{await addMember(tx,p1,owner,'owner');await addMember(tx,p2,owner,'owner');});
  await channel('public',p1,'general');await channel('public',p2,'general');await channel('private',p1,'private-design');
  for(const person of users.slice(2))await channel('dm',null,null,person);
  await channel('private',null,null,peer);
});
after(async()=>{
  await sql`DELETE FROM chat_channels WHERE id=ANY(${channels}::uuid[])`;
  await sql`DELETE FROM workspaces WHERE id=ANY(${[p1,p2]}::uuid[])`;
  await sql`DELETE FROM connections WHERE requester_id=ANY(${users}::uuid[]) OR addressee_id=ANY(${users}::uuid[])`;
  await sql`DELETE FROM auth.users WHERE id=ANY(${users}::uuid[])`;
  await sql.end();await closeAppDb();
});
const input=(scope:any,extra:any={})=>({scope,expectedActorId:owner,...extra});
test('root workspaces are member-only and page by stable identity without exposing channel names',async()=>{
  const first=await projects({expectedActorId:owner,limit:1});assert.ok(first.success);assert.equal(first.projects.length,1);assert.ok(first.nextCursor);
  const second=await projects({expectedActorId:owner,limit:1,cursor:first.nextCursor});assert.ok(second.success);assert.equal(second.projects.length,1);assert.equal(second.nextCursor,null);
  assert.deepEqual(new Set([first.projects[0]!.id,second.projects[0]!.id]),new Set([p1,p2]));
  assert.equal(first.projects[0]!.joined_channels,first.projects[0]!.id===p1?2:1);
  actor=outsider;const empty=await projects({expectedActorId:outsider});assert.ok(empty.success);assert.deepEqual(empty.projects,[]);
  actor=owner;assert.equal((await projects({expectedActorId:outsider})).success,false);
});
test('project pages show only that project and stable IDs disambiguate repeated general names',async()=>{
  const first=await list(input({kind:'project',projectId:p1}));assert.ok(first.success);assert.equal(first.channels.length,2);assert.ok(first.channels.every(c=>c.project_id===p1&&!c.application_id));
  const second=await list(input({kind:'project',projectId:p2}));assert.ok(second.success);assert.equal(second.channels.length,1);assert.notEqual(first.channels.find(c=>c.name==='general')!.id,second.channels[0]!.id);
  const group=await list(input({kind:'groups'}));assert.ok(group.success);assert.equal(group.channels.length,1);assert.equal(group.channels[0]!.project_id,null);
});
test('all DMs, including beyond bootstrap 100, remain reachable without duplicated keyset rows',async()=>{
  const ids=new Set<string>();let cursor:string|null=null;let pages=0;
  do {const result=await list(input({kind:'dms'},{cursor}));assert.ok(result.success);pages++;for(const row of result.channels){assert.ok(!ids.has(row.id));ids.add(row.id);assert.equal(row.kind,'dm');assert.equal(row.project_id,null);}cursor=result.nextCursor;}while(cursor);
  assert.equal(ids.size,Number((await sql`SELECT count(*)::int AS n FROM chat_channel_members m JOIN chat_channels c ON c.id=m.channel_id WHERE m.user_id=${owner} AND c.kind='dm' AND m.archived_at IS NULL`)[0]!.n));assert.ok(ids.size>=107);assert.equal(pages,3);
});
test('live capability distinguishes readable blocked DMs, and archived channels cannot be selected',async()=>{
  await sql`INSERT INTO connections(requester_id,addressee_id,status,blocked_by,blocked_at) VALUES (${owner},${peer},'blocked',${owner},now())`;
  const dm=await list(input({kind:'dms'},{query:peer.slice(0,8)}));assert.ok(dm.success);assert.equal(dm.channels.length,1);assert.equal(dm.channels[0]!.can_send,false);assert.equal(dm.channels[0]!.send_disabled_reason,'blocked');
  const details=await get({channelId:dm.channels[0]!.id,expectedActorId:owner});assert.ok(details.success);assert.equal(details.channel.can_send,false);
  await sql`UPDATE chat_channels SET archived_at=now() WHERE id=${channels[0]!}`;
  const projects=await list(input({kind:'project',projectId:p1}));assert.ok(projects.success);assert.equal(projects.channels.length,1);
});
test('membership, session changes, deleted projects and malformed cursors fail closed',async()=>{
  actor=outsider;assert.equal((await list(input({kind:'dms'}))).success,false);
  assert.equal((await list({scope:{kind:'project',projectId:p1},expectedActorId:outsider})).success,false);
  actor=owner;assert.equal((await list(input({kind:'dms'},{cursor:'malformed'}))).success,false);
  assert.equal((await list(input({kind:'project',projectId:'not-a-uuid'}))).success,false);
  await sql`DELETE FROM workspace_members WHERE workspace_id=${p1} AND user_id=${owner}`;
  assert.equal((await list(input({kind:'project',projectId:p1}))).success,false);
  await sql`UPDATE workspaces SET deleted_at=now() WHERE id=${p2}`;
  assert.equal((await list(input({kind:'project',projectId:p2}))).success,false);
  actor=null;assert.equal((await list(input({kind:'dms'}))).success,false);
});
