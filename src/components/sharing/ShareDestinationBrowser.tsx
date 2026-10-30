"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronRight, FileText, Star, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { WorkspaceBadge } from "@/components/workspaces/WorkspaceBadge";

import { useShareDestinations, useShareWorkspaces } from "./useShareDestinations";
import { ConversationIcon } from "@/components/messages/ConversationIcon";
import { channelTitle } from "@/lib/messaging/channel-view";
import { conversationScopeTitle,scopeKey,type ConversationScope,type ShareDestination } from "@/lib/sharing/destination-scope";
import { chatErrorMessage } from "@/lib/messaging/errors";

import { useAuth } from "@/hooks/useAuth";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";

export type ConversationListMemory=Map<string,{query:string;scroll:number}>;

/** Scoped destination hierarchy inside the sharing dialog only. */
export function ShareDestinationBrowser({scope,onScopeChange,onSelect,selectedId,disabled=false,memory:providedMemory,onAuthRequired}: {
  scope:ConversationScope;onScopeChange:(scope:ConversationScope)=>void;onSelect:(channel:ShareDestination)=>void;
  selectedId?:string|null;disabled?:boolean;memory?:ConversationListMemory;onAuthRequired?:(required:boolean)=>void;
}) {
  const {user}=useAuth();const online=useOnlineStatus();
  const [localMemory]=useState<ConversationListMemory>(()=>new Map());const memory=providedMemory??localMemory;
  const key=`${user?.id??'guest'}:${scopeKey(scope)}`;
  const [searchState,setSearchState]=useState({key,query:memory.get(key)?.query??''});
  const query=searchState.key===key?searchState.query:memory.get(key)?.query??'';
  const list=useShareDestinations(scope,query);
  const listRef=useRef<HTMLDivElement>(null);const searchRef=useRef<HTMLInputElement>(null);const previousScope=useRef(key);
  const root=scope.kind==='projects'||scope.kind==='more';
  const rootList=useShareWorkspaces(query,scope.kind==='projects');
  const readyRoot=rootList.ready;
  const safeData={projects:scope.kind==='projects'?rootList.projects:list.ready&&list.data?.pages[0]?.project?[list.data.pages[0].project]:[]};
  const project='projectId' in scope ? safeData?.projects?.find(p=>p.id===scope.projectId) : null;
  const title=conversationScopeTitle(scope,safeData);
  const family='projectId' in scope?'projects':['groups','applications'].includes(scope.kind)?'more':scope.kind;

  const projects=readyRoot?rootList.projects:[];
  const rows=list.channels;
  useEffect(()=>{if(previousScope.current!==key){previousScope.current=key;searchRef.current?.focus();}},[key]);
  const change=(next:ConversationScope)=>{if(disabled)return;onScopeChange(next);};
  const blocked=!online||(!user)|| (scope.kind==='projects'?rootList.isError:scope.kind==='more'?false:list.isError);
  const loading=scope.kind==='projects'?rootList.isPending||rootList.isRefetching:scope.kind==='more'?false:list.loading;
  const failure=root ? rootList.error?.message : list.error?.message;
  useLayoutEffect(()=>{if(!loading&&!blocked&&listRef.current)listRef.current.scrollTop=memory.get(key)?.scroll??0;},[key,memory,rows.length,projects.length,loading,blocked]);
  useEffect(()=>{if(failure==='chat_unauthorized')onAuthRequired?.(true);},[failure,onAuthRequired]);
  const placeholder=scope.kind==='projects'?'Search workspaces':scope.kind==='project'?'Search channels in this workspace':scope.kind==='dms'?'Search direct messages':`Search ${title.toLowerCase()}`;
  const retry=()=>{if(scope.kind==='projects')void rootList.refetch();else void list.refetch();};
  const rowDetail=(channel:ShareDestination)=>channel.can_send===false ? channel.send_disabled_reason==='unavailable'?'Read-only · messaging unavailable':'Read-only conversation'
    : channel.kind==='dm' ? (channel.dm_user?.username?`@${channel.dm_user.username}`:'Direct message')
    : channel.application_id ? `${channel.project_title??'Workspace'} · application conversation`
    : channel.project_id ? (channel.kind==='private'?'Private · joined channel':'Joined channel') : 'Group message';
  return <div className="min-w-0 space-y-3" data-testid="conversation-browser" data-scope={scopeKey(scope)}>
    <div role="group" aria-label="Conversation type" className="flex flex-wrap gap-2">
      {([{kind:'projects',label:'Workspaces'},{kind:'dms',label:'Direct messages'},{kind:'more',label:'More'}] as const).map(tab=><Button key={tab.kind} type="button" size="sm" variant={family===tab.kind?'secondary':'outline'} aria-pressed={family===tab.kind} disabled={disabled} onClick={()=>change({kind:tab.kind})}>{tab.label}</Button>)}
    </div>
    <div className="flex min-w-0 items-start gap-2">
      {!root ? <div className="min-w-0 flex-1 space-y-1"><Button type="button" size="sm" variant="ghost" disabled={disabled} className="h-auto min-h-9 px-0 text-primary" onClick={()=>change({kind:'projectId' in scope?'projects':scope.kind==='dms'?'projects':'more'})}><ArrowLeft className="size-3.5"/>{'projectId' in scope?'All workspaces':scope.kind==='dms'?'Workspaces':'More conversations'}</Button><p className="break-words text-[13px] font-semibold text-foreground">{project?<span className="mr-1.5 inline-flex"><WorkspaceBadge project={project} size="sm"/></span>:null}{title}</p></div>:<h2 className="nb-card-title min-w-0 flex-1">{title}</h2>}
    </div>
    {'projectId' in scope ? <div className="flex flex-wrap gap-2" role="group" aria-label="Workspace conversation type"><Button type="button" size="sm" variant={scope.kind==='project'?'secondary':'outline'} disabled={disabled} onClick={()=>change({kind:'project',projectId:scope.projectId})}>Channels</Button><Button type="button" size="sm" variant={scope.kind==='project-applications'?'secondary':'outline'} disabled={disabled} onClick={()=>change({kind:'project-applications',projectId:scope.projectId})}>Applications</Button></div>:null}
    {scope.kind!=='more'&&scope.kind!=='unavailable'?<Input ref={searchRef} type="search" value={query} maxLength={100} aria-label={placeholder} placeholder={placeholder} disabled={disabled||blocked} onChange={event=>{const value=event.target.value;memory.set(key,{query:value,scroll:0});setSearchState({key,query:value});}}/>:null}
    <div ref={listRef} onScroll={event=>{if(!loading&&!blocked)memory.set(key,{...memory.get(key),query,scroll:event.currentTarget.scrollTop});}} className="app-scroll app-scroll-y min-w-0 max-h-64 min-h-40 space-y-1" role={!root?'radiogroup':undefined} aria-label={!root?'Send to':undefined}>
      {blocked ? <div className="space-y-2 py-5 text-[13px] text-muted-foreground" role="status">{!online?'You are offline. Reconnect to check your conversations.':!user||failure==='chat_unauthorized'?'Sign in again to check your conversations.':`Conversations could not load. ${failure?chatErrorMessage(failure):''}`}<div>{online&&user?<Button type="button" size="sm" variant="outline" onClick={retry}>Retry conversations</Button>:null}</div></div>
      : loading ? <div role="status" aria-label="Loading conversations" className="space-y-3 py-3">{[1,2,3].map(i=><div key={i} className="h-11 animate-pulse rounded-md bg-muted"/>)}<span className="sr-only">Loading conversations…</span></div>
      : scope.kind==='projects'?projects.length?projects.map(p=><button key={p.id} type="button" disabled={disabled} data-testid={`conversation-project-${p.id}`} className="flex min-h-16 w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-muted focus-visible:outline-ring" onClick={()=>change({kind:'project',projectId:p.id})}><WorkspaceBadge project={p} size="md"/><span className="min-w-0 flex-1"><span className="block break-words text-[13px] font-semibold">{p.title}</span><span className="nb-meta block break-words">{p.slug?`/${p.slug}`:`Workspace ${p.id.slice(0,8)}`} · {p.joined_channels??0} joined channels</span></span>{p.mention_count?<span className="nb-chat-count">{p.mention_count}<span className="sr-only"> mentions</span></span>:null}<ChevronRight className="size-4 shrink-0 text-muted-foreground"/></button>):<p className="py-6 text-[13px] text-muted-foreground">{query?'No workspaces match. Try another name.':'No joined workspaces. Direct messages are still available.'}</p>
      : scope.kind==='more'?<>{([{kind:'groups',label:'Group messages',detail:'Existing groups outside workspaces',Icon:Users},{kind:'applications',label:'Application conversations',detail:'Applicant and role',Icon:FileText}] as const).map(item=><button key={item.kind} type="button" disabled={disabled} className="flex min-h-16 w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-muted" onClick={()=>change({kind:item.kind})}><item.Icon className="size-5 shrink-0 text-muted-foreground"/><span className="min-w-0 flex-1"><span className="block text-[13px] font-semibold">{item.label}</span><span className="block text-[12px] text-muted-foreground">{item.detail}</span></span><ChevronRight className="size-4 shrink-0 text-muted-foreground"/></button>)}</>
      : scope.kind==='unavailable'?<p className="py-5 text-[13px] text-muted-foreground">This conversation is no longer in your list. Return to Workspaces or Direct messages.</p>
      : rows.length?<>{rows.map(channel=><label key={channel.id} className={`flex min-h-16 items-center gap-3 rounded-md border px-2 py-2 text-[13px] ${selectedId===channel.id?'border-border bg-muted':'border-transparent hover:bg-muted'} ${disabled||channel.can_send===false?'opacity-60':'cursor-pointer'}`}><input type="radio" name="share-conversation" aria-label={`${channelTitle(channel,user?.id??null)} · ${rowDetail(channel)}`} value={channel.id} checked={selectedId===channel.id} disabled={disabled||channel.can_send!==true} onChange={()=>onSelect(channel)}/>{channel.kind==='dm'?<UserAvatar identity={channel.dm_user} size={34}/>:<ConversationIcon channel={channel} className="size-5 shrink-0 text-muted-foreground"/>}<span className="min-w-0 flex-1"><span className="block break-words font-semibold">{channelTitle(channel,user?.id??null)}</span><span className="block break-words text-[12px] text-muted-foreground">{rowDetail(channel)}</span></span>{channel.starred?<Star className="size-3.5 shrink-0 text-muted-foreground" aria-label="Starred"/>:null}</label>)}</>
      :<div className="space-y-2 py-5 text-[13px] text-muted-foreground"><p>{query?'No conversations match in this scope.':scope.kind==='dms'?'No direct messages yet.':'No joined conversations here.'}</p>{!query?<Button size="sm" variant="outline" asChild><Link href={'projectId' in scope?`/messages/w/${scope.projectId}/browse`:'/messages/new'} target="_blank" rel="noopener">{'projectId' in scope?'Browse channels':'Start in Messages'}</Link></Button>:null}</div>}
      {!blocked&&!loading&&scope.kind==='projects'&&rootList.hasNextPage?<Button type="button" size="sm" variant="outline" disabled={disabled||rootList.isFetchingNextPage} onClick={()=>void rootList.fetchNextPage()}>{rootList.isFetchingNextPage?'Loading…':'Load more workspaces'}</Button>:null}
      {!blocked&&!loading&&!root&&list.hasNextPage?<Button type="button" size="sm" variant="outline" disabled={disabled||list.isFetchingNextPage} onClick={()=>void list.fetchNextPage()}>{list.isFetchingNextPage?'Loading…':'Load more conversations'}</Button>:null}
    </div>
  </div>;
}
