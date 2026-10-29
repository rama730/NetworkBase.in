import type {ChatChannelSummary,ChatWorkspaceSummary} from '@/lib/messaging/types';

/** Navigation belongs only to the sharing picker; it never updates Messages scope or routes. */
export type ConversationScope =
  | {kind:'projects'|'dms'|'more'|'groups'|'applications'|'unavailable'}
  | {kind:'project'|'project-applications';projectId:string};
export type ShareWorkspace=ChatWorkspaceSummary&{joined_channels:number;mention_count:number};
export type ShareDestination=ChatChannelSummary&{
  can_send:boolean;send_disabled_reason:'blocked'|'archived'|null;
  project_title:string|null;project_slug:string|null;is_member?:boolean;
};
export const WORKSPACES_SCOPE:ConversationScope={kind:'projects'};
export const scopeKey=(scope:ConversationScope)=>`${scope.kind}${'projectId' in scope?':'+scope.projectId:''}`;
export function channelInScope(channel:ChatChannelSummary,scope:ConversationScope){
  switch(scope.kind){
    case 'project':return channel.project_id===scope.projectId&&!channel.application_id;
    case 'project-applications':return channel.project_id===scope.projectId&&Boolean(channel.application_id);
    case 'applications':return Boolean(channel.application_id);
    case 'dms':return !channel.project_id&&!channel.application_id&&channel.kind==='dm';
    case 'groups':return !channel.project_id&&!channel.application_id&&channel.kind==='private';
    default:return false;
  }
}
export function conversationScopeTitle(scope:ConversationScope,data?:{projects?:{id:string;title:string}[]}){
  if('projectId' in scope)return data?.projects?.find(p=>p.id===scope.projectId)?.title??'Workspace conversations';
  return {projects:'Workspaces',dms:'Direct messages',more:'More conversations',groups:'Group messages',applications:'Application conversations',unavailable:'Conversation unavailable'}[scope.kind];
}
