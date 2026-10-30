import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { PgDialect } from 'drizzle-orm/pg-core';
import { createUser, createProject, addMember, sql, loadAppModule, closeAppDb, moduleStubs } from './_helpers';

process.env.APP_URL = 'https://networkbase.in';
process.env.NEXT_PUBLIC_APP_URL = 'https://networkbase.in';
let actor: string | null = null;
const published: unknown[] = [];
moduleStubs.set('@/lib/supabase/auth-user', {getAuthUser:async()=>actor ? {id:actor}:null});
moduleStubs.set('next/headers',{headers:async()=>new Headers({origin:'https://networkbase.in'})});
moduleStubs.set('@/lib/messaging/publish',{publishSentMessage:(value:unknown)=>published.push(value),publishChannel(){},publishUser(){},publishUsers(){}});
let read: typeof import('../../src/lib/sharing/read')['readSharePreview'];
let image: typeof import('../../src/lib/sharing/social-image')['renderShareImage'];
let send: typeof import('../../src/app/actions/sharing')['sendSharedLink'];
let owner='', peer='', stranger='', handle='', channel='';
const projectIds:string[]=[];
let revokeDuringImageRead = false;
let imageReads = 0;
moduleStubs.set('@/lib/storage/bounded-object-read', { readBoundedStorageBytes: async () => {
  imageReads++;
  if (revokeDuringImageRead) await sql`UPDATE profiles SET visibility='private' WHERE id=${owner}`;
  return sharp({create:{width:400,height:400,channels:3,background:'#ff0000'}}).png().toBuffer();
}});

before(async()=>{
  ({readSharePreview:read}=await loadAppModule(()=>import('../../src/lib/sharing/read')));
  ({renderShareImage:image}=await loadAppModule(()=>import('../../src/lib/sharing/social-image')));
  ({sendSharedLink:send}=await loadAppModule(()=>import('../../src/app/actions/sharing')));
  owner=await sql.begin(tx=>createUser(tx));peer=await sql.begin(tx=>createUser(tx));stranger=await sql.begin(tx=>createUser(tx));
  handle=(await sql`SELECT username FROM profiles WHERE id=${owner}`)[0]!.username;
  await sql`INSERT INTO username_aliases(username,user_id,is_primary) VALUES (${handle},${owner},true) ON CONFLICT DO NOTHING`;
  await sql`UPDATE profiles SET full_name='Sharing Fixture',headline='Product Engineer',open_to_collaborate=true WHERE id=${owner}`;
  actor=owner;
  channel=(await sql`INSERT INTO chat_channels(kind,title,created_by) VALUES ('private','Share fixture',${owner}) RETURNING id`)[0]!.id;
  await sql`INSERT INTO chat_channel_members(channel_id,user_id,role) VALUES (${channel},${owner},'owner')`;
});
after(async()=>{
  await sql`DELETE FROM chat_channels WHERE id=${channel}`;
  if(projectIds.length)await sql`DELETE FROM workspaces WHERE id=ANY(${projectIds}::uuid[])`;
  await sql`DELETE FROM auth.users WHERE id=ANY(${[owner,peer,stranger]}::uuid[])`;
  await sql.end();await closeAppDb();
});
const url=()=>`https://networkbase.in/u/${handle}`;
async function project(visibility='public',status='active',role='contributor'){
  const id=await sql.begin(tx=>createProject(tx,owner,{visibility,status}));projectIds.push(id);
  await sql`INSERT INTO profile_contributions(profile_id,workspace_id,source,role_kind,visibility)
    VALUES (${owner},${id},'manual',${role},'public') ON CONFLICT DO NOTHING`;
  return id;
}

test('public portfolio and canonical skills exclude hidden work, drafts, viewers and private edges',async()=>{
  const one=await project();await project('private');await project('unlisted');await project('public','draft');await project('public','active','viewer');
  const [title]=await sql`SELECT title FROM workspaces WHERE id=${one}`;
  const rows=await sql`SELECT id FROM skills WHERE status NOT IN ('hidden','merged') ORDER BY name LIMIT 7`;
  assert.ok(rows.length>=7);
  for(let i=0;i<rows.length;i++)await sql`INSERT INTO profile_skills(profile_id,skill_id,display_order,visibility) VALUES (${owner},${rows[i]!.id},${i},${i===6?'private':'public'})`;
  const visible=await read(url());assert.equal(visible?.state,'ready');assert.equal(visible?.portfolio,`Public portfolio · ${title!.title}`);
  assert.equal(visible?.skills.length,4);assert.equal(visible?.skillOverflow,2);assert.ok(visible?.openToCollaborate);
  const revision=visible!.image;
  await sql`UPDATE profiles SET open_to_collaborate=false WHERE id=${owner}`;
  assert.notEqual((await read(url()))!.image,revision);
  await sql`UPDATE profile_contributions SET ended_at=now() WHERE workspace_id=${one}`;
  await sql`UPDATE workspaces SET status='archived' WHERE id=${one}`;
  assert.equal((await read(url()))?.portfolio,visible?.portfolio);
  await sql`UPDATE workspaces SET title='Canonical renamed title' WHERE id=${one}`;
  assert.equal((await read(url()))?.portfolio,'Public portfolio · Canonical renamed title');
  await project('public','completed');assert.equal((await read(url()))?.portfolio,'Public portfolio · 2 contributions');
});

test('public metadata is independent of owner access, and recipient permission is rechecked after revocation',async()=>{
  await sql`UPDATE profiles SET visibility='connections' WHERE id=${owner}`;
  assert.equal((await read(url()))?.identity,undefined);
  assert.equal((await read(url(),owner))?.identity?.name,'Sharing Fixture');
  assert.equal((await read(url(),stranger))?.identity,undefined);
  await sql`INSERT INTO connections(requester_id,addressee_id,status) VALUES (${owner},${peer},'accepted')`;
  assert.equal((await read(url(),peer))?.state,'ready');
  await sql`UPDATE connections SET status='disconnected' WHERE requester_id=${owner} AND addressee_id=${peer}`;
  assert.equal((await read(url(),peer))?.state,'restricted');
  await sql`UPDATE profiles SET visibility='public' WHERE id=${owner}`;
  await sql`SELECT app_private.block_user(${peer}::uuid, ${owner}::uuid, 'profile', NULL)`;
  assert.equal((await read(url()))?.state,'ready');assert.equal((await read(url(),peer))?.identity,undefined);
  // Later tests add the peer to the owner's own workspace, which a block now refuses (B36).
  await sql`DELETE FROM user_blocks WHERE blocker_id=${peer}`;
});

test('historical username resolves to current canonical URL and deleted profiles reveal no identity',async()=>{
  const alias='old_'+randomUUID().slice(0,8);
  await sql`INSERT INTO username_aliases(username,user_id,is_primary) VALUES (${alias},${owner},false)`;
  assert.equal((await read(`https://networkbase.in/u/${alias}`))?.url,url());
  await sql`UPDATE profiles SET deleted_at=now() WHERE id=${owner}`;
  assert.equal((await read(url()))?.state,'unavailable');assert.equal((await read(url(),owner))?.identity,undefined);
  await sql`UPDATE profiles SET deleted_at=NULL WHERE id=${owner}`;
});

test('privacy revoked during portfolio aggregation removes identity before the workspaceion returns',async()=>{
  const {db}=await loadAppModule(()=>import('../../src/lib/db'));
  const execute=db.execute;
  const dialect=new PgDialect();
  let revoked=false;
  await sql`UPDATE profiles SET visibility='public' WHERE id=${owner}`;
  db.execute=(async function(query:Parameters<typeof execute>[0]) {
    const result=await execute.call(db,query);
    if(!revoked && dialect.sqlToQuery(query).sql.includes('WITH eligible AS')) {
      revoked=true;await sql`UPDATE profiles SET visibility='private' WHERE id=${owner}`;
    }
    return result;
  }) as typeof execute;
  try {
    const preview=await read(url());assert.ok(revoked);assert.equal(preview?.state,'restricted');
    assert.equal(preview?.identity,undefined);assert.deepEqual(preview?.skills,[]);assert.equal(preview?.portfolio,null);
  } finally {
    db.execute=execute;await sql`UPDATE profiles SET visibility='public' WHERE id=${owner}`;
  }
});

test('project previews respect anonymous versus member access, public history and unlisted noindex',async()=>{
  const privateProject=projectIds[1]!;
  const path=`https://networkbase.in/workspaces/p-${privateProject}`;
  assert.equal((await read(path))?.identity,undefined);assert.equal((await read(path,owner))?.state,'ready');
  await sql.begin(tx=>addMember(tx,privateProject,peer));assert.equal((await read(path,peer))?.state,'ready');
  await sql`DELETE FROM workspace_members WHERE workspace_id=${privateProject} AND user_id=${peer}`;
  assert.equal((await read(path,peer))?.identity,undefined);
  const unlisted=await read(`https://networkbase.in/workspaces/p-${projectIds[2]}`);assert.equal(unlisted?.state,'ready');assert.equal(unlisted?.indexable,false);
  const draft=await read(`https://networkbase.in/workspaces/p-${projectIds[3]}`);assert.equal(draft?.identity,undefined);
});

test('real PNG generation is 1200x630, never caches private snapshots, and falls back for unsupported scripts',async()=>{
  const response=await image(url());assert.equal(response.headers.get('content-type'),'image/png');assert.match(response.headers.get('cache-control')!,/no-store/);
  const metadata=await sharp(Buffer.from(await response.arrayBuffer())).metadata();assert.equal(metadata.width,1200);assert.equal(metadata.height,630);
  await sql`UPDATE profiles SET visibility='private' WHERE id=${owner}`;
  const restricted=await image(url());assert.equal(restricted.status,200);assert.match(restricted.headers.get('cache-control')!,/no-store/);
  await sql`UPDATE profiles SET visibility='public',full_name='ليلى عبد الله' WHERE id=${owner}`;
  const localized=await image(url());assert.equal(localized.status,200);
  assert.equal((await read(url()))?.identity?.name,'ليلى عبد الله');
  await sql`UPDATE profiles SET full_name='Sharing Fixture' WHERE id=${owner}`;
});

test('send persists only URL/note, retries reuse a receipt, and revoked conversation membership denies sending',async()=>{
  actor=owner;
  const intent=`sharing-test:${randomUUID()}`;
  const input={url:url(),channelId:channel,note:'A professional introduction',clientId:intent,expectedSenderId:owner};
  const sent=await send(input);assert.ok(sent.success);const before=published.length;
  const retried=await send(input);assert.ok(retried.success);assert.equal(published.length,before);
  const [row]=await sql`SELECT body FROM chat_messages WHERE channel_id=${channel} AND client_message_id=${intent}`;
  assert.equal(row!.body,`${url()}\n\nA professional introduction`);assert.doesNotMatch(row!.body,/Sharing Fixture|Product Engineer|portfolio/);
  assert.equal((await sql`SELECT count(*)::int AS n FROM chat_messages WHERE channel_id=${channel} AND client_message_id=${intent}`)[0]!.n,1);
  actor=stranger;const denied=await send({...input,clientId:'stranger:'+randomUUID(),expectedSenderId:stranger});assert.equal(denied.success,false);
  actor=null;assert.equal((await send(input)).success,false);actor=owner;
});

test('shared workspace references survive renamed slugs while preserving readable message text',async()=>{
  actor=owner;const id=projectIds[0]!;const intent='project-share:'+randomUUID();
  const readable=`https://networkbase.in/workspaces/p-${id}`;
  assert.ok((await send({url:readable,channelId:channel,note:'Another URL: https://example.com',clientId:intent,expectedSenderId:owner})).success);
  const [row]=await sql`SELECT body FROM chat_messages WHERE channel_id=${channel} AND client_message_id=${intent}`;
  assert.match(row!.body,new RegExp(`^\\[${readable.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\]`));
  const nextSlug='renamed-'+randomUUID().slice(0,8);await sql`UPDATE workspaces SET slug=${nextSlug} WHERE id=${id}`;
  assert.equal((await read(`https://networkbase.in/workspaces/${id}`))?.url,`https://networkbase.in/workspaces/${nextSlug}`);
});

test('privacy changes during avatar loading cannot leave a personal image in the generic card',async()=>{
  const asset=randomUUID();
  try {
    await sql`INSERT INTO storage_assets(id,owner_user_id,bucket,storage_key,purpose,state,declared_mime_type,declared_size,verified_mime_type,verified_size,verified_at,expires_at)
      VALUES (${asset},${owner},'avatars',${owner+'/'+asset+'/avatar.png'},'profile_image:avatar','verified','image/png',64,'image/png',64,now(),now()+interval '1 hour')`;
    await sql`UPDATE profiles SET avatar_asset_id=${asset},avatar_url='https://approved.example/avatar.png',visibility='public' WHERE id=${owner}`;
    revokeDuringImageRead=true;
    const response=await image(url());
    assert.ok(imageReads>0);
    const pixels=await sharp(Buffer.from(await response.arrayBuffer())).removeAlpha().raw().toBuffer();
    let red=0;for(let offset=0;offset<pixels.length;offset+=3)if(pixels[offset]===255&&pixels[offset+1]===0&&pixels[offset+2]===0)red++;
    assert.equal(red,0,'A previously permitted avatar survived the final privacy check');
  } finally {
    revokeDuringImageRead=false;
    await sql`UPDATE profiles SET avatar_asset_id=NULL,avatar_url=NULL,visibility='public' WHERE id=${owner}`;
    await sql`DELETE FROM storage_assets WHERE id=${asset}`;
  }
});

test('a renamed profile does not turn a lost send confirmation into a new message',async()=>{
  actor=owner;const oldUrl=url();const oldHandle=handle;const clientId='rename-receipt:'+randomUUID();
  const input={url:oldUrl,channelId:channel,note:'One introduction',clientId,expectedSenderId:owner};
  const first=await send(input);assert.ok(first.success);const key=(await read(oldUrl))?.entityKey;
  const nextHandle='new_'+randomUUID().slice(0,8);
  await sql`UPDATE username_aliases SET is_primary=false WHERE user_id=${owner}`;
  await sql`UPDATE profiles SET username=${nextHandle} WHERE id=${owner}`;
  await sql`INSERT INTO username_aliases(username,user_id,is_primary) VALUES (${nextHandle},${owner},true)`;
  handle=nextHandle;
  assert.equal((await read(oldUrl))?.url,url());assert.equal((await read(oldUrl))?.entityKey,key);
  const publishCount=published.length;
  assert.ok((await send(input)).success);assert.ok((await send({...input,url:url()})).success);
  assert.equal(published.length,publishCount);
  assert.equal((await sql`SELECT count(*)::int AS n FROM chat_messages WHERE channel_id=${channel} AND client_message_id=${clientId}`)[0]!.n,1);
  assert.ok(oldHandle!==handle);
});


test('a changed server session cannot send an earlier account draft into a shared conversation',async()=>{
  await sql`INSERT INTO chat_channel_members(channel_id,user_id,role) VALUES (${channel},${stranger},'member')`;
  actor=stranger;const clientId='account-race:'+randomUUID();
  const denied=await send({url:url(),channelId:channel,note:'Private draft from old account',clientId,expectedSenderId:owner});
  assert.deepEqual(denied,{success:false,error:'chat_unauthorized'});
  assert.equal((await sql`SELECT count(*)::int AS n FROM chat_messages WHERE channel_id=${channel} AND client_message_id=${clientId}`)[0]!.n,0);
  actor=owner;
});

test('project projections filter identity before overflow, preserve read-only metrics and suppress inactive roles',async()=>{
  const id=await project();const path=`https://networkbase.in/workspaces/${id}`;
  const people:string[]=[];
  try {
    for(let i=0;i<7;i++)people.push(await sql.begin(tx=>createUser(tx,{visibility:'public'})));
    await sql`UPDATE profiles SET visibility='public' WHERE id=${owner}`;
    await sql`UPDATE profiles SET full_name='Public collaborator' WHERE id=ANY(${people}::uuid[])`;
    for(const user of people)await sql`INSERT INTO workspace_members(workspace_id,user_id,role) VALUES (${id},${user},'member')`;
    await sql`UPDATE profiles SET visibility='private',full_name='Hidden collaborator' WHERE id=${people[0]!}`;
    const roleIds:string[]=[];
    for(let i=0;i<5;i++)roleIds.push((await sql`INSERT INTO workspace_open_roles(workspace_id,role,title,count,filled) VALUES (${id},${'role'+i},${'Available role '+i},2,0) RETURNING id`)[0]!.id);
    await sql`INSERT INTO role_applications(workspace_id,role_id,applicant_id,creator_id,status,decision_at) VALUES (${id},${roleIds[0]!},${people[1]!},${owner},'accepted',now())`;
    const skillRows=await sql`SELECT id FROM skills WHERE status NOT IN ('hidden','merged') ORDER BY name LIMIT 7`;
    for(const [order,skill]of skillRows.entries())await sql`INSERT INTO workspace_skills(workspace_id,skill_id,display_order) VALUES (${id},${skill.id},${order})`;
    await sql`UPDATE workspaces SET view_count=12345,followers_count=0,cover_image=NULL,import_source='{"metadata":{"leadFocus":"Engineering"}}'::jsonb WHERE id=${id}`;
    let preview=await read(path);assert.equal(preview?.state,'ready');assert.equal(preview?.identity?.avatarUrl,null);assert.equal(preview?.project?.team?.length,5);assert.equal(preview?.project?.team?.[0]?.id,owner);assert.equal(preview?.project?.team?.[0]?.role,'Engineering · Owner');assert.equal(preview?.project?.teamOverflow,2);assert.equal(preview?.project?.team?.find(p=>p.id===people[1])?.role,'Available role 0 · Member');assert.equal(JSON.stringify(preview).includes('Hidden collaborator'),false);assert.equal(preview?.byline,undefined);
    assert.equal(preview?.project?.roles?.length,3);assert.equal(preview?.project?.roleOverflow,2);assert.equal(preview?.project?.views,12345);assert.equal(preview?.project?.followers,0);assert.equal(preview?.skills.length,4);assert.equal(preview?.skillOverflow,3);const rendered=await image(path);const png=Buffer.from(await rendered.arrayBuffer());assert.equal((await sharp(png).metadata()).width,1200);await import('node:fs/promises').then(fs=>fs.writeFile('/tmp/nb-approved-project-share.png',png));
    assert.equal((await sql`SELECT view_count FROM workspaces WHERE id=${id}`)[0]!.view_count,12345);
    await sql`UPDATE workspace_open_roles SET filled=count WHERE id=${roleIds[0]!}`;preview=await read(path);assert.equal(preview?.project?.roleOverflow,1);
    await sql`UPDATE workspaces SET status='completed' WHERE id=${id}`;preview=await read(path);assert.equal(preview?.project?.roles,null);assert.equal(preview?.project?.views,12345);assert.equal(preview?.project?.team?.length,5);
    await sql`UPDATE workspaces SET status='active',public_tab_visibility='{"dashboard":false}'::jsonb WHERE id=${id}`;preview=await read(path);assert.equal(preview?.project?.team,null);assert.equal(preview?.project?.roles,null);assert.deepEqual(preview?.skills,[]);
    await sql`UPDATE workspaces SET visibility='private' WHERE id=${id}`;preview=await read(path);assert.equal(preview?.url,path);assert.equal(preview?.project,undefined);assert.equal(preview?.identity,undefined);
    preview=await read(path,owner);assert.equal(preview?.state,'ready');assert.equal(preview?.project?.roles?.length,3);assert.equal(preview?.project?.team?.length,5);
    await sql`UPDATE workspaces SET visibility='public',status='draft' WHERE id=${id}`;assert.equal((await read(path))?.state,'restricted');preview=await read(path,owner);assert.equal(preview?.draft,true);assert.equal(preview?.indexable,false);assert.equal(preview?.project?.roles,null);
  }finally{await sql`DELETE FROM auth.users WHERE id=ANY(${people}::uuid[])`;}
});

test('workspace team visibility respects connections and blocks; public image never retains a revoked face',async()=>{
  const id=await project();const path=`https://networkbase.in/workspaces/${id}`,asset=randomUUID();
  try{
    await sql`UPDATE profiles SET visibility='public',full_name='Visible Owner',avatar_url='https://approved.example/team.png',avatar_asset_id=NULL WHERE id=${owner}`;
    await sql`INSERT INTO workspace_members(workspace_id,user_id,role) VALUES (${id},${peer},'member')`;
    await sql`UPDATE profiles SET visibility='private' WHERE id=${peer}`;
    assert.equal((await read(path))?.project?.team?.some(p=>p.id===peer),false);
    assert.equal((await read(path,peer))?.project?.team?.some(p=>p.id===peer),true);
    await sql`INSERT INTO connections(requester_id,addressee_id,status) VALUES (${stranger},${peer},'accepted') ON CONFLICT DO NOTHING`;
    assert.equal((await read(path,stranger))?.project?.team?.some(p=>p.id===peer),true);
    await sql`SELECT app_private.block_user(${peer}::uuid, ${stranger}::uuid, 'profile', NULL)`;
    assert.equal((await read(path,stranger))?.project?.team?.some(p=>p.id===peer),false);
    await sql`INSERT INTO storage_assets(id,owner_user_id,bucket,storage_key,purpose,state,declared_mime_type,declared_size,verified_mime_type,verified_size,verified_at,expires_at)
      VALUES (${asset},${owner},'avatars',${owner+'/'+asset+'/team.png'},'profile_image:avatar','verified','image/png',64,'image/png',64,now(),now()+interval '1 hour')`;
    await sql`UPDATE profiles SET avatar_asset_id=${asset} WHERE id=${owner}`;
    const response=await image(path);assert.equal(response.headers.get('Content-Type'),'image/png');const data=await response.arrayBuffer();assert.equal((await sharp(Buffer.from(data)).metadata()).width,1200);assert.equal((await sharp(Buffer.from(data)).metadata()).height,630);const visiblePixels=await sharp(Buffer.from(data)).removeAlpha().raw().toBuffer();let visibleRed=0;for(let p=0;p<visiblePixels.length;p+=3)if(visiblePixels[p]===255&&visiblePixels[p+1]===0&&visiblePixels[p+2]===0)visibleRed++;assert.ok(visibleRed>100,'The permitted team avatar did not render');
    revokeDuringImageRead=true;const revoked=await image(path);const pixels=await sharp(Buffer.from(await revoked.arrayBuffer())).removeAlpha().raw().toBuffer();let red=0;for(let p=0;p<pixels.length;p+=3)if(pixels[p]===255&&pixels[p+1]===0&&pixels[p+2]===0)red++;assert.equal(red,0);
  }finally{revokeDuringImageRead=false;await sql`UPDATE profiles SET avatar_asset_id=NULL,avatar_url=NULL,visibility='public' WHERE id=${owner}`;await sql`DELETE FROM storage_assets WHERE id=${asset}`;await sql`DELETE FROM connections WHERE (requester_id=${stranger} AND addressee_id=${peer}) OR (requester_id=${peer} AND addressee_id=${stranger})`;}
});

test('receipt-only checks cannot publish a missing send or change its original payload',async()=>{
  actor=owner;const clientId='receipt-only:'+randomUUID(),input={url:url(),channelId:channel,note:'Original note',clientId,expectedSenderId:owner};
  const missing=await send({...input,checkOnly:true});assert.ok(missing.success&&'receipt' in missing&&missing.receipt==='missing');assert.equal((await sql`SELECT count(*)::int AS n FROM chat_messages WHERE channel_id=${channel} AND client_message_id=${clientId}`)[0]!.n,0);
  assert.ok((await send(input)).success);const count=published.length;const found=await send({...input,note:'Different draft',checkOnly:true});assert.ok(found.success&&'receipt' in found&&found.receipt==='found');assert.equal(published.length,count);const [message]=await sql`SELECT body FROM chat_messages WHERE channel_id=${channel} AND client_message_id=${clientId}`;assert.match(message!.body,/Original note/);assert.doesNotMatch(message!.body,/Different draft/);
});

test('replacement cover assets change the image revision even when the visible URL stays stable',async()=>{
  const id=await project(),path=`https://networkbase.in/workspaces/${id}`,assets=[randomUUID(),randomUUID()];
  try{
    for(const asset of assets)await sql`INSERT INTO storage_assets(id,owner_user_id,workspace_id,bucket,storage_key,purpose,state,declared_mime_type,declared_size,verified_mime_type,verified_size,verified_at,expires_at)
      VALUES (${asset},${owner},${id},'project-files',${id+'/'+asset+'/cover.png'},'project_cover:cover','verified','image/png',64,'image/png',64,now(),now()+interval '1 hour')`;
    await sql`UPDATE workspaces SET cover_image='https://approved.example/stable.png',cover_image_asset_id=${assets[0]!} WHERE id=${id}`;const before=await read(path);
    await sql`UPDATE workspaces SET cover_image_asset_id=${assets[1]!} WHERE id=${id}`;const after=await read(path);assert.equal(before?.identity?.avatarUrl,after?.identity?.avatarUrl);assert.notEqual(before?.identity?.avatarRevision,after?.identity?.avatarRevision);assert.notEqual(before?.image,after?.image);
  }finally{await sql`UPDATE workspaces SET cover_image_asset_id=NULL,cover_image=NULL WHERE id=${id}`;await sql`DELETE FROM storage_assets WHERE id=ANY(${assets}::uuid[])`;}
});

test('external project artwork never reads a team portrait owned by a different profile',async()=>{
  const id=await project(),asset=randomUUID();
  try{
    await sql`INSERT INTO storage_assets(id,owner_user_id,bucket,storage_key,purpose,state,declared_mime_type,declared_size,verified_mime_type,verified_size,verified_at,expires_at)
      VALUES (${asset},${peer},'avatars',${peer+'/'+asset+'/private.png'},'profile_image:avatar','verified','image/png',64,'image/png',64,now(),now()+interval '1 hour')`;
    await sql`UPDATE profiles SET visibility='public',avatar_url='https://approved.example/wrong-owner.png',avatar_asset_id=${asset} WHERE id=${owner}`;
    const before=imageReads;const result=await image(`https://networkbase.in/workspaces/${id}`);assert.equal(result.headers.get('Content-Type'),'image/png');assert.equal(imageReads,before);
  }finally{await sql`UPDATE profiles SET avatar_url=NULL,avatar_asset_id=NULL WHERE id=${owner}`;await sql`DELETE FROM storage_assets WHERE id=${asset}`;}
});


test('project preview roles match lead focus, accepted member roles and consented guidance labels',async()=>{
  const id=await project(),path=`https://networkbase.in/workspaces/${id}`;
  let invitation:string|null=null;
  try{
    await sql`UPDATE profiles SET visibility='public' WHERE id=ANY(${[owner,peer]}::uuid[])`;
    await sql`UPDATE workspaces SET import_source=NULL WHERE id=${id}`;
    await sql`INSERT INTO workspace_members(workspace_id,user_id,role) VALUES (${id},${peer},'admin')`;
    const role=(await sql`INSERT INTO workspace_open_roles(workspace_id,role,title,count,filled) VALUES (${id},'designer','Design',1,1) RETURNING id`)[0]!.id;
    await sql`INSERT INTO role_applications(workspace_id,role_id,applicant_id,creator_id,status) VALUES (${id},${role},${peer},${owner},'pending')`;
    const preview=await read(path);assert.equal(preview?.project?.team?.find(p=>p.id===owner)?.role,'Owner');assert.equal(preview?.project?.team?.find(p=>p.id===peer)?.role,'Admin');
    await sql`UPDATE role_applications SET status='accepted',decision_at=now() WHERE workspace_id=${id} AND applicant_id=${peer}`;
    assert.equal((await read(path))?.project?.team?.find(p=>p.id===peer)?.role,'Design · Admin');
    invitation=(await sql`INSERT INTO workspace_invitations(workspace_id,inviter_id,candidate_id,kind,guidance_label,project_title,status,expires_at) VALUES (${id},${owner},${peer},'guidance_appointment','Mentor','Project','accepted',now()+interval '1 day') RETURNING id`)[0]!.id;
    await sql`INSERT INTO workspace_mentors(workspace_id,guide_user_id,invitation_id,label,public_attribution_consent) VALUES (${id},${peer},${invitation},'Mentor',false)`;
    assert.equal((await read(path))?.project?.team?.find(p=>p.id===peer)?.role,'Design · Admin');
    assert.equal((await read(path,peer))?.project?.team?.find(p=>p.id===peer)?.role,'Mentor · Admin');
    await sql`UPDATE workspace_mentors SET public_attribution_consent=true WHERE workspace_id=${id}`;
    assert.equal((await read(path))?.project?.team?.find(p=>p.id===peer)?.role,'Mentor · Admin');
    await sql`UPDATE workspace_mentors SET status='ended',ended_at=now() WHERE workspace_id=${id}`;
    assert.equal((await read(path))?.project?.team?.find(p=>p.id===peer)?.role,'Design · Admin');
  }finally{
    await sql`DELETE FROM workspace_mentors WHERE workspace_id=${id}`;
    if(invitation)await sql`DELETE FROM workspace_invitations WHERE id=${invitation}`;
  }
});
