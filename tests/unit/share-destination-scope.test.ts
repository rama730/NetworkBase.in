import assert from 'node:assert/strict';
import test from 'node:test';
import {channelInScope,scopeKey,conversationScopeTitle,type ConversationScope} from '../../src/lib/sharing/destination-scope';
import type {ChatBootstrap,ChatChannelSummary} from '../../src/lib/messaging/types';
const p1='11111111-1111-4111-8111-111111111111',p2='22222222-2222-4222-8222-222222222222';
const c=(id:string,patch:Partial<ChatChannelSummary>={})=>({id,name:'general',kind:'public',project_id:p1,application_id:null,starred:false,archived_at:null,channel_archived_at:null,is_default:false,last_message_at:null,...patch} as ChatChannelSummary);
const rows=[c('a'),c('b',{project_id:p2}),c('d',{kind:'dm',project_id:null,name:null,starred:true}),c('g',{kind:'private',project_id:null,name:null}),c('app',{kind:'private',application_id:'app',name:null}),c('orphan',{project_id:null})];
const data={projects:[{id:p1,title:'Same title'},{id:p2,title:'Same title'}],channels:rows} as ChatBootstrap;
test('each hierarchy is disjoint, and project context precedes DM-like shape',()=>{
  const cases:[ConversationScope,string[]][]=[[{kind:'projects'},[]],[{kind:'project',projectId:p1},['a']],[{kind:'project',projectId:p2},['b']],[{kind:'dms'},['d']],[{kind:'groups'},['g']],[{kind:'project-applications',projectId:p1},['app']],[{kind:'applications'},['app']]];
  for(const [scope,ids] of cases)assert.deepEqual(rows.filter(c=>channelInScope(c,scope)).map(c=>c.id),ids);
});
test('picker scope identity uses IDs rather than repeated project titles',()=>{
  assert.notEqual(scopeKey({kind:'project',projectId:p1}),scopeKey({kind:'project',projectId:p2}));
  assert.equal(conversationScopeTitle({kind:'project',projectId:p1},data),'Same title');
  assert.equal(conversationScopeTitle({kind:'dms'}),'Direct messages');
});
