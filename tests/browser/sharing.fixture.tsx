import React, { Profiler, useEffect, useState } from 'react';
import { Toaster } from 'sonner';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ShareDialog } from '@/components/sharing/ShareDialog';
import { LinkPreviewCard } from '@/components/messages/parts/LinkPreviewCard';
import { MessageRow } from '@/components/messages/MessageRow';
import { ConversationContext } from '@/components/messages/conversation-context';
import { queryKeys } from '@/lib/query-keys';
import { invalidateLinkPreviewAccess } from '@/lib/links/client-preview-cache';
import type { ChatMessageView } from '@/lib/messaging/types';
import { channelInScope } from '@/lib/sharing/destination-scope';
import { genericSharePreview, parseShareResource, previewAlt, type SharePreview } from '@/lib/sharing/presentation';

const id='11111111-1111-4111-8111-111111111111';
const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
const fixture=(window as any).sharingFixture={
  user:{id},session:{id:'session-a'},path:'/u/builder',kind:'profile',privacy:'public',mode:'dialog',open:false,
  nativeResult:'success',copyDenied:false,sendResult:'success',serverSignedIn:true,delay:0,attempts:[] as any[],receipts:new Set<string>(),payload:null as any,trigger:null as HTMLElement|null,
  refresh:()=>{},previewFetching:()=>client.isFetching({queryKey:queryKeys.sharing.linksRoot()}),invalidate:()=>client.invalidateQueries(),invalidateAccess:()=>invalidateLinkPreviewAccess(client),
  laneWidth:960,rowCount:1,messageGap:0,removeFails:false,hideAttempts:[] as any[],messagePages:[] as ChatMessageView[][],previewDelay:0,wrongActor:false,wrongSession:false,expiredLease:false,previewError:false,previewDenied:false,requests:0,displayName:'Builder One',commits:[] as any[],
  async hidePreview(input:any){fixture.hideAttempts.push(input);return fixture.removeFails?{success:false,error:'chat_not_editable'}:{success:true};},
  patchMessages(patch:any){fixture.messagePages=patch(fixture.messagePages);fixture.refresh();},
  projects:[{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',title:'Ponytail',slug:'ponytail',role:'owner'},{id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',title:'DeepScope AI',slug:'deepscope',role:'member'}],
  channels:[
    {id:'22222222-2222-4222-8222-222222222222',kind:'public',title:null,name:'general',project_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',application_id:null,archived_at:null,channel_archived_at:null,can_send:true},
    {id:'44444444-4444-4444-8444-444444444444',kind:'public',title:null,name:'general',project_id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',application_id:null,archived_at:null,channel_archived_at:null,can_send:true},
    {id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',kind:'dm',title:null,name:null,project_id:null,application_id:null,dm_user:{id:'33333333-3333-4333-8333-333333333333',full_name:'Priya Sharma',username:'priya'},archived_at:null,channel_archived_at:null,can_send:true},
    {id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',kind:'private',title:'Design review',name:null,project_id:null,application_id:null,archived_at:null,channel_archived_at:null,can_send:true},
  ], destinationError:false,
  async list(input:any){if(!fixture.serverSignedIn||input.expectedActorId!==fixture.user?.id)return {success:false,error:'chat_unauthorized'};if(fixture.destinationError)return {success:false,error:'chat_unavailable'};
    const project='projectId' in input.scope?fixture.projects.find(p=>p.id===input.scope.projectId):null;
    if('projectId' in input.scope&&!project)return {success:false,error:'chat_not_member'};
    const rows=fixture.channels.filter(c=>!c.archived_at&&!c.channel_archived_at&&channelInScope(c as any,input.scope)).filter(c=>[c.name,c.title,c.dm_user?.full_name,c.dm_user?.username].join(' ').toLowerCase().includes((input.query||'').toLowerCase()));
    const start=Number(input.cursor||0),page=rows.slice(start,start+50);
    return {success:true,viewerId:fixture.user.id,project,channels:page.map(c=>({...c,project_title:project?.title??null})),nextCursor:start+50<rows.length?String(start+50):null};
  },
  async listProjects(input:any){if(!fixture.serverSignedIn||input.expectedActorId!==fixture.user?.id)return {success:false,error:'chat_unauthorized'};if(fixture.destinationError)return {success:false,error:'chat_unavailable'};
    const all=fixture.projects.filter(p=>[p.title,p.slug].join(' ').toLowerCase().includes((input.query||'').toLowerCase()));const start=Number(input.cursor||0);
    return {success:true,viewerId:fixture.user.id,projects:all.slice(start,start+50).map(p=>({...p,joined_channels:fixture.channels.filter(c=>c.project_id===p.id&&!c.application_id).length,mention_count:0})),nextCursor:start+50<all.length?String(start+50):null};
  },
  async destination(input:any){if(!fixture.serverSignedIn||input.expectedActorId!==fixture.user?.id)return {success:false,error:'chat_unauthorized'};
    const c=fixture.channels.find(c=>c.id===input.channelId);if(!c)return {success:false,error:'chat_not_member'};
    const p=fixture.projects.find(p=>p.id===c.project_id);return {success:true,viewerId:fixture.user.id,channel:{...c,is_member:true,project_title:p?.title??null,can_send:c.can_send!==false&&!c.archived_at&&!c.channel_archived_at}};
  },
  async send(input:any){fixture.attempts.push(input);if(!fixture.serverSignedIn||input.expectedSenderId!==fixture.user?.id)return {success:false,error:'chat_unauthorized'};if(fixture.delay)await new Promise(resolve=>setTimeout(resolve,fixture.delay));
    if(fixture.receipts.has(input.clientId))return {success:true,receipt:'found'};
    if(input.checkOnly)return {success:true,receipt:'missing'};
    if(fixture.sendResult==='unconfirmed-missing')throw new Error('Not confirmed');
    if(fixture.sendResult==='uncertain'){fixture.receipts.add(input.clientId);throw new Error('Confirmation lost');}
    if(fixture.sendResult==='failure')return {success:false,error:'chat_not_member'};
    if(fixture.sendResult==='auth'){fixture.serverSignedIn=false;return {success:false,error:'chat_unauthorized'};}
    fixture.receipts.add(input.clientId);return {success:true};
  },
  preview(url:string,internal=false){
    const resource=parseShareResource(url)!;const generic=genericSharePreview(resource,fixture.privacy==='unknown'?'unknown':'restricted');
    if(fixture.previewDenied||fixture.privacy!=='public'&&!internal)return generic;
    const preview:SharePreview={...generic,state:'ready',entityKey:'b'.repeat(64),indexable:fixture.privacy==='public',visibility:fixture.privacy==='public'?'public':'private',
      identity:{name:fixture.displayName,username:'builder',avatarUrl:null,headline:'Product Engineer'},title:fixture.displayName+' (@builder) · NetworkBase',description:'Product Engineer',
      portfolio:'Public portfolio · Ponytail',skills:['Claude Code','CodeRabbit','Cursor','GitHub'],skillOverflow:3,openToCollaborate:true};
    if(resource.kind==='project'){preview.identity={name:'Ponytail',username:null,avatarUrl:null,headline:null};preview.title='Ponytail';preview.description='A collaborative project';preview.byline=undefined;preview.portfolio=null;preview.project={team:Array.from({length:5},(_,i)=>({id:i===0?id:`${String(i+2).repeat(8)}-2222-4222-8222-222222222222`,name:i===0?'Builder One':'Collaborator '+i,username:i===0?'builder':null,avatarUrl:null,role:i===0?'Lead / Product Engineer':i===1?'Designer · Member':'Member'})),teamOverflow:2,views:12345,followers:0,roles:Array.from({length:3},(_,i)=>({id:`${String(i+5).repeat(8)}-2222-4222-8222-222222222222`,title:['Designer','Engineer','Researcher'][i]!})),roleOverflow:2};}
    preview.imageAlt=previewAlt(preview);return preview;
  },
};
Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{if(fixture.copyDenied)throw new Error('Denied');}}});
Object.defineProperty(navigator,'share',{configurable:true,value:async(data:any)=>{fixture.payload=data;
  if(fixture.nativeResult==='cancel')throw new DOMException('Canceled','AbortError');if(fixture.nativeResult==='failure')throw new Error('Target failed');}});
function Message(){
  // eslint-disable-next-line react-hooks/immutability -- the fixture is seeded once, on first render
  if(!fixture.messagePages.length)fixture.messagePages=[Array.from({length:fixture.rowCount},(_,i)=>({channel_id:'22222222-2222-4222-8222-222222222222',seq:i+1,author_id:id,author:{id,full_name:'Message Author',username:'author',avatar_url:null},kind:'user' as const,
    body:'https://networkbase.in'+fixture.path+'\nSharing this for you to explore.',thread_root_seq:null,reply_count:0,last_reply_seq:null,last_reply_at:null,edited_at:null,deleted_at:null,created_at:'2026-10-15T00:00:00.000Z',client_message_id:null,attachments:[],reactions:[{emoji:'👍',count:1,me:true}],card:null,pinned:false}))];
  const context={channelId:'22222222-2222-4222-8222-222222222222',meId:fixture.user.id,canAdmin:false,isDm:true,people:[],nameOf:()=>undefined,channelNameOf:()=>undefined,editingSeq:null,setEditingSeq:()=>{},openThread:()=>{},inThread:false,isMember:true};
  return <div data-chat-pane style={{width:fixture.laneWidth,maxWidth:'100%',marginTop:fixture.messageGap}}><ConversationContext.Provider value={context}>
    {fixture.messagePages[0]!.map(message=><Profiler key={message.seq} id={`message-${message.seq}`} onRender={(id,phase,duration)=>fixture.commits.push({id,phase,duration})}><MessageRow message={message} grouped={false} tabStop /></Profiler>)}
  </ConversationContext.Provider></div>;
}
function Fixture(){const [,setTick]=useState(0);useEffect(()=>{fixture.refresh=()=>setTick(value=>value+1);},[]);
  return <QueryClientProvider client={client}><Toaster/><button onClick={event=>{fixture.trigger=event.currentTarget;fixture.open=true;fixture.refresh();}}>Share profile</button>
    {fixture.mode==='message'?<Message/>:fixture.open?<ShareDialog kind={fixture.kind} path={fixture.path} returnFocusElement={fixture.trigger} onClose={()=>{fixture.open=false;fixture.refresh();}}
      ownerUsernameSetup={{profileId:id,updatedAt:'2026-10-14T00:00:00.000Z',onSaved:username=>{fixture.path='/u/'+username;fixture.refresh();}}}/>:null}
  </QueryClientProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
