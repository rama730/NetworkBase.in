import 'server-only';

import { BarChart2, UsersRound } from 'lucide-react';
import { ImageResponse } from 'next/og';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { and, eq, isNull, or } from 'drizzle-orm';
import { isUuid } from '@/lib/validations/uuid';
import sharp from 'sharp';
import { db } from '@/lib/db';
import { profiles, workspaces, storageAssets } from '@/lib/db/schema';
import { readBoundedStorageBytes } from '@/lib/storage/bounded-object-read';
import { initialsForName } from '@/lib/profile/display';
import { genericSharePreview, parseShareResource, shareText, projectRolesFitImage, projectImageSkillsFit, socialImageCanRender, type SharePreview } from './presentation';
import { readSharePreview } from './read';
import { formatCount } from '@/lib/format-count';
import { logger } from '@/lib/logger';

// Static instances of the app's existing licensed variable fonts; read once, without remote font requests.
const imageFonts = Promise.all([
  readFile(join(process.cwd(), 'src/app/fonts/InstrumentSans-Share-Regular.ttf')),
  readFile(join(process.cwd(), 'src/app/fonts/InstrumentSans-Share-Semibold.ttf')),
  readFile(join(process.cwd(), 'src/app/fonts/JetBrainsMono-Share-Regular.ttf')),
]).then(([regular,semibold,mono]) => [
  {name:'Instrument Sans',data:regular,weight:400 as const,style:'normal' as const},
  {name:'Instrument Sans',data:semibold,weight:600 as const,style:'normal' as const},
  {name:'JetBrains Mono',data:mono,weight:400 as const,style:'normal' as const},
]).catch(error => { logger.warn('share.image.fonts_unavailable', { error: String(error) }); return null; });

// The app's local font exports cover Latin. Other scripts keep complete HTML metadata
// and use a branded image instead of leaking text to an external font service.
export { socialImageCanRender } from './presentation';

async function verifiedImage(preview: SharePreview, small = false, budgetMs = 2500): Promise<string | null> {
  if (!preview.identity?.avatarUrl || budgetMs <= 0) return null;
  const deadline = Date.now() + budgetMs;
  const path = new URL(preview.url).pathname.split('/').pop()!;
  const reference = preview.kind === 'profile'
    ? await db.select({ assetId: profiles.avatarAssetId, entityId: profiles.id }).from(profiles)
      .where(and(eq(profiles.username, path), eq(profiles.visibility, 'public'), isNull(profiles.deletedAt))).limit(1)
    : await db.select({ assetId: workspaces.coverImageAssetId, entityId: workspaces.id }).from(workspaces).where(and(isUuid(path) ? or(eq(workspaces.id,path),eq(workspaces.slug,path)) : eq(workspaces.slug, path), isNull(workspaces.deletedAt))).limit(1);
  const assetId = reference[0]?.assetId;
  if (!assetId) return null;
  const [asset] = await db.select({ bucket: storageAssets.bucket, key: storageAssets.storageKey, mime: storageAssets.verifiedMimeType, ownerId: storageAssets.ownerUserId, projectId: storageAssets.projectId })
    .from(storageAssets).where(and(eq(storageAssets.id, assetId), eq(storageAssets.state, 'verified'))).limit(1);
  if (!asset || (preview.kind === 'profile' ? asset.ownerId !== reference[0]?.entityId : asset.projectId !== reference[0]?.entityId) || !['avatars', 'project-files'].includes(asset.bucket) || !asset.mime?.startsWith('image/')) return null;
  if (Date.now() >= deadline) return null;
  const bytes = await readBoundedStorageBytes({ bucket: asset.bucket, storageKey: asset.key, maxBytes: (small ? 1 : 6) * 1024 * 1024, timeoutMs: Math.max(1, Math.min(2500,deadline-Date.now())) });
  const sanitized = await sharp(Buffer.from(bytes), { limitInputPixels: small ? 4_000_000 : 16_000_000, animated: false }).resize(small ? 64 : 400,small ? 64 : 400,{ fit:'cover' }).png().toBuffer();
  return 'data:image/png;base64,' + sanitized.toString('base64');
}

function ProjectSocialImage({preview,avatar,teamAvatars}:{preview:SharePreview;avatar:string|null;teamAvatars:Record<string,string>}) {
  const ready=preview.state==='ready',project=ready?preview.project:undefined;
  const name=ready?preview.identity?.name??preview.title:preview.title;
  const mark=(name:string,username:string|null)=>{const value=initialsForName(name,username);return /^[\u0020-\u024f]{1,3}$/.test(value)?value:'?';};
  const chip={display:'flex',fontSize:18,border:'1px solid #DDD6CB',borderRadius:4,padding:'4px 8px',color:'#637078',background:'white',maxWidth:500} as const;
  return <div style={{display:'flex',flexDirection:'column',width:'100%',height:'100%',padding:'44px 60px',justifyContent:'space-between',background:'#FAF8F4',color:'#192125',fontFamily:'Instrument Sans'}}>
    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}><div style={{display:'flex',alignItems:'center',gap:7,fontSize:32,fontWeight:600}}><div style={{width:13,height:13,borderRadius:3,background:'#C74620'}}/>NetworkBase</div><div style={{fontSize:16,color:'#C74620',letterSpacing:2}}>WORKSPACE</div></div>
    <div style={{display:'flex',flexDirection:'column',gap:16}}>
      <div style={{display:'flex',alignItems:'flex-start',gap:24}}>
        {ready&&avatar?<img src={avatar} alt="" width={112} height={112} style={{borderRadius:4,objectFit:'cover',flexShrink:0}}/>:null}
        <div style={{display:'flex',flexDirection:'column',gap:10,flex:1,minWidth:0}}><div style={{fontSize:name.length>45?38:48,fontWeight:600,lineHeight:1.12,maxHeight:(name.length>45?38:48)*1.12*2,overflow:'hidden',overflowWrap:'anywhere'}}>{name.length>140?name.slice(0,137)+'…':name}</div><div style={{fontSize:22,color:'#637078',lineHeight:1.25,maxHeight:55,overflow:'hidden',overflowWrap:'anywhere'}}>{preview.description.length>170?preview.description.slice(0,167)+'…':preview.description}</div></div>
      </div>
      {project?<div style={{display:'flex',alignItems:'center',gap:28,flexWrap:'wrap'}}>
        {project.team?.length?<div style={{display:'flex',alignItems:'center'}}>{project.team.map((person,i)=><div key={person.id} style={{display:'flex',width:40,height:40,borderRadius:5,overflow:'hidden',border:'3px solid #FAF8F4',marginLeft:i?-7:0,background:'#EFE1D8',color:'#8B573E',alignItems:'center',justifyContent:'center',fontSize:14}}>{teamAvatars[person.id]?<img src={teamAvatars[person.id]} alt="" width={40} height={40}/>:mark(person.name,person.username)}</div>)}{project.teamOverflow?<div style={{display:'flex',width:40,height:40,borderRadius:5,border:'3px solid #FAF8F4',marginLeft:-7,background:'#EFEAE2',alignItems:'center',justifyContent:'center',fontSize:13,color:'#637078'}}>{'+'+project.teamOverflow}</div>:null}</div>:null}
        {project.views!==null||project.followers!==null?<div style={{display:'flex',alignItems:'center',gap:20,fontSize:18,color:'#637078'}}>{([['views',project.views,BarChart2],['followers',project.followers,UsersRound]] as const).filter(([label,count])=>label!=='views'||count!==0).map(([label,count,Icon])=><div key={label} style={{display:'flex',alignItems:'center',gap:6}}><Icon width={20} height={20} color="#637078" strokeWidth={1.75}/>{(count===null?'—':formatCount(count))+' '+(count===1?label.slice(0,-1):label)}</div>)}</div>:null}
      </div>:null}
      {ready&&preview.skills.length&&projectImageSkillsFit(preview)?<div style={{display:'flex',flexWrap:'wrap',gap:8}}>{preview.skills.map(skill=><div key={skill} style={{...chip,fontSize:skill.length>40?14:18}}>{skill.length>70?skill.slice(0,67)+'…':skill}</div>)}{preview.skillOverflow?<div style={chip}>{'+'+preview.skillOverflow}</div>:null}</div>:null}
      {project?.roles?.length&&projectRolesFitImage(preview)?<div style={{display:'flex',flexDirection:'column',gap:6}}><div style={{fontSize:16,color:'#637078'}}>Open roles</div><div style={{display:'flex',flexWrap:'wrap',gap:8}}>{project.roles.slice(0,-1).map(role=><div key={role.id} style={chip}>{role.title}</div>)}<div style={{display:'flex',gap:8}}><div style={chip}>{project.roles.at(-1)!.title}</div>{project.roleOverflow?<div style={chip}>{'+'+project.roleOverflow}</div>:null}</div></div></div>:null}
    </div>
    <div style={{display:'flex',justifyContent:'space-between',fontFamily:'JetBrains Mono',fontSize:16,color:'#637078'}}><div>{new URL(preview.url).hostname+(ready&&preview.identity?new URL(preview.url).pathname:'')}</div><div>Professional network for people</div></div>
  </div>;
}

function imageSafetySignature(preview:SharePreview) {
  return JSON.stringify({...preview,image:'',imageAlt:'',project:preview.project?{...preview.project,views:null,followers:null}:undefined});
}

export function SocialShareImage({ preview, avatar, teamAvatars = {} }: { preview: SharePreview; avatar: string | null; teamAvatars?: Record<string,string> }) {
  if(preview.kind==='project')return <ProjectSocialImage preview={preview} avatar={avatar} teamAvatars={teamAvatars}/>;
  const identity = preview.state === 'ready' ? preview.identity : undefined;
  const name = identity?.name ?? preview.title;
  const compactName = name.length > 65 ? name.slice(0, 62) + '…' : name;
  const description = shareText(identity?.headline ?? preview.description);
  const headline = description.length > 130 ? description.slice(0,127) + '…' : description;
  const skills = preview.skills;
  return <div style={{ width:'100%',height:'100%',display:'flex',flexDirection:'column',justifyContent:'space-between',padding:'48px 72px',background:'#FAF8F4',color:'#192125',fontFamily:'Instrument Sans' }}>
    <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between' }}>
      <div style={{ display:'flex',alignItems:'center',gap:7,fontSize:32,fontWeight:600,letterSpacing:-1 }}><div style={{ width:13,height:13,borderRadius:3,background:'#C74620' }} />NetworkBase</div>
      <div style={{ fontSize:16,letterSpacing:2,color:'#C74620',textTransform:'uppercase' }}>{preview.kind}</div>
    </div>
    <div style={{ display:'flex',alignItems:'center',gap:40,height:232 }}>
      <div style={{ width:186,height:186,display:'flex',flexShrink:0,alignItems:'center',justifyContent:'center',background:'#EFE1D8',border:'1px solid #DED0C5',borderRadius:3,color:'#8B573E',fontSize:66 }}>
        {avatar ? <img src={avatar} alt="" width={186} height={186} style={{objectFit:'cover'}} /> : identity ? initialsForName(identity.name === `@${identity.username}` ? identity.username : identity.name,identity.username) : 'NB'}
      </div>
      <div style={{ display:'flex',flexDirection:'column',flex:1,minWidth:0,gap:12 }}>
        <div style={{ fontSize:name.length>32?44:60,fontWeight:600,lineHeight:1.1,letterSpacing:-1.5,overflowWrap:'anywhere',maxHeight:132,overflow:'hidden' }}>{compactName}</div>
        {identity?.username && identity.name !== `@${identity.username}` ? <div style={{fontFamily:'JetBrains Mono',fontSize:20,color:'#637078'}}>{`@${identity.username}`}</div> : null}
        {identity && preview.byline ? <div style={{fontSize:18,color:'#637078'}}>{preview.byline}</div> : null}
        {headline ? <div style={{fontSize:24,color:'#637078',lineHeight:1.25,maxHeight:60,overflow:'hidden',overflowWrap:'anywhere'}}>{headline}</div> : null}
        {identity && preview.openToCollaborate ? <div style={{display:'flex'}}><div style={{fontSize:14,color:'#297C50',border:'1px solid #A9C9B5',borderRadius:3,padding:'4px 8px'}}>Open to collaboration</div></div> : null}
      </div>
    </div>
    {identity && (preview.portfolio || skills.length) ? <div style={{ display:'flex',flexDirection:'column',gap:12,maxHeight:154 }}>
      {preview.portfolio ? <div style={{ fontSize:preview.portfolio.length>110?17:22,color:'#637078',lineHeight:1.25 }}>{preview.portfolio.length>180 ? preview.portfolio.slice(0,177)+'…':preview.portfolio}</div> : null}
      {skills.length ? <div style={{display:'flex',flexWrap:'wrap',gap:8}}>{skills.map(skill=><div key={skill} style={{display:'flex',fontSize:skill.length>40?15:18,border:'1px solid #DDD6CB',borderRadius:4,padding:'4px 8px',color:'#637078',maxWidth:510,background:'white'}}>{skill}</div>)}{preview.skillOverflow>0?<div style={{fontSize:18,border:'1px solid #DDD6CB',borderRadius:4,padding:'4px 8px',background:'#EFEAE2',color:'#637078'}}>{`+${preview.skillOverflow}`}</div>:null}</div>:null}
    </div> : null}
    <div style={{display:'flex',justifyContent:'space-between',fontFamily:'JetBrains Mono',fontSize:17,color:'#637078'}}><div>{new URL(preview.url).hostname + (identity ? new URL(preview.url).pathname : '')}</div><div>Professional network for people</div></div>
  </div>;
}

export async function renderShareImage(url: string) {
  const resource = parseShareResource(url);
  if (!resource) return new Response('Invalid sharing link', { status:400,headers:{'Cache-Control':'no-store'} });
  let preview = await readSharePreview(url) ?? genericSharePreview(resource);
  if (!socialImageCanRender(preview)) preview = genericSharePreview(resource, 'ready');
  const originalAvatarUrl = preview.identity?.avatarUrl;
  const originalAvatarRevision = preview.identity?.avatarRevision;
  const originalTeam = new Map((preview.project?.team ?? []).map(p=>[p.id,JSON.stringify([p.avatarUrl,p.avatarRevision])]));
  const teamAvatars:Record<string,string> = {};
  const assetDeadline = Date.now() + 5000;
  const avatar = await verifiedImage(preview).catch(() => null);
  // Bounded verified local assets only. Two at a time keeps decode memory bounded.
  const team = preview.project?.team ?? [];
  for(let offset=0;offset<team.length;offset+=2)await Promise.all(team.slice(offset,offset+2).map(async person=>{
    if(!person.username||!person.avatarUrl||Date.now()>=assetDeadline)return;
    const image=await verifiedImage({...preview,kind:'profile',url:new URL('/u/'+encodeURIComponent(person.username),preview.url).href,identity:{name:person.name,username:person.username,avatarUrl:person.avatarUrl,headline:null}},true,Math.min(2500,assetDeadline-Date.now())).catch(()=>null);
    if(image)teamAvatars[person.id]=image;
  }));
  // Images are never permission-bearing snapshots. Check again after asynchronous asset loading.
  const latest = await readSharePreview(url);
  if (!latest || latest.state !== 'ready' || !socialImageCanRender(latest)) preview = genericSharePreview(resource);
  else preview = latest;
  for(const person of preview.project?.team ?? [])if(JSON.stringify([person.avatarUrl,person.avatarRevision])!==originalTeam.get(person.id))delete teamAvatars[person.id];
  const headers = { 'Cache-Control':'private, no-store, no-cache, must-revalidate', 'X-Content-Type-Options':'nosniff' };
  const fonts = await imageFonts;
  if (!fonts) return new Response(null, {status:307,headers:{...headers,Location:new URL('/og/routes-card.png',resource.url).href}});
  try {
    const generated = new ImageResponse(<SocialShareImage preview={preview} teamAvatars={teamAvatars} avatar={preview.identity && preview.identity.avatarUrl === originalAvatarUrl && preview.identity.avatarRevision === originalAvatarRevision ? avatar : null} />, {width:1200,height:630,fonts});
    const bytes = await generated.arrayBuffer();
    if (preview.identity) {
      const final = await readSharePreview(url);
      if (!final || final.state !== 'ready' || imageSafetySignature(final) !== imageSafetySignature(preview)) {
        const neutral = new ImageResponse(<SocialShareImage preview={genericSharePreview(resource)} avatar={null} />, {width:1200,height:630,fonts});
        return new Response(await neutral.arrayBuffer(), {headers:{...headers,'Content-Type':'image/png'}});
      }
    }
    return new Response(bytes, {headers:{...headers,'Content-Type':'image/png'}});
  } catch (error) {
    logger.warn('share.image.fallback', {kind:resource.kind,error:String(error)});
    const fallback = new ImageResponse(<SocialShareImage preview={genericSharePreview(resource)} avatar={null} />, {width:1200,height:630,fonts});
    return new Response(await fallback.arrayBuffer(), {headers:{...headers,'Content-Type':'image/png'}});
  }
}
