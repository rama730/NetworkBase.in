"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { useDebounce } from "use-debounce";
import { listShareDestinations, listShareWorkspaces } from "@/app/actions/sharing-destinations";
import { useAuth } from "@/hooks/useAuth";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { getSessionIdentifierFromSession } from "@/lib/auth/session-identifier";
import { scopeKey, type ConversationScope } from "@/lib/sharing/destination-scope";
import { queryKeys } from "@/lib/query-keys";

export function useShareDestinations(scope:ConversationScope, search:string, enabled=true) {
  const {user,session}=useAuth();
  const userId=user?.id??null;
  const online=useOnlineStatus();
  const [query]=useDebounce(search.trim(),200);
  const list=!['projects','more','unavailable'].includes(scope.kind);
  const result=useInfiniteQuery({
    queryKey:queryKeys.sharing.destinations(userId,getSessionIdentifierFromSession(session),scopeKey(scope),query),
    enabled:Boolean(enabled&&online&&userId&&list), initialPageParam:null as string|null,
    queryFn:async({pageParam,signal})=>{
      const response=await listShareDestinations({scope,query,cursor:pageParam,expectedActorId:userId!});
      signal.throwIfAborted();
      if(!response.success)throw new Error(response.error);
      if(response.viewerId!==userId)throw new Error('chat_unauthorized');
      return response;
    }, getNextPageParam:page=>page.nextCursor,staleTime:0,gcTime:5*60_000,
    refetchOnMount:'always',refetchOnWindowFocus:true,refetchOnReconnect:true,retry:false,
  });
  // Cached pages are account/session scoped and never persisted. Withhold them while access is unknown.
  const ready=list&&enabled&&online&&!result.isRefetching&&!result.isError&&query===search.trim();
  const seen=new Set<string>();
  const channels=ready ? (result.data?.pages.flatMap(page=>page.channels)??[]).filter(channel=>!seen.has(channel.id)&&Boolean(seen.add(channel.id))) : [];
  return {...result,channels,ready,online,loading:list&&(result.isPending||result.isRefetching||query!==search.trim())};
}

export function useShareWorkspaces(search:string,enabled:boolean) {
  const {user,session}=useAuth();const userId=user?.id??null;const online=useOnlineStatus();
  const [query]=useDebounce(search.trim(),200);
  const result=useInfiniteQuery({queryKey:queryKeys.sharing.destinations(userId,getSessionIdentifierFromSession(session),'projects',query),
    enabled:Boolean(enabled&&online&&userId),initialPageParam:null as string|null,
    queryFn:async({pageParam,signal})=>{const response=await listShareWorkspaces({expectedActorId:userId!,query,cursor:pageParam});signal.throwIfAborted();
      if(!response.success)throw new Error(response.error);if(response.viewerId!==userId)throw new Error('chat_unauthorized');return response;},
    getNextPageParam:page=>page.nextCursor,staleTime:0,gcTime:5*60_000,refetchOnMount:'always',refetchOnWindowFocus:true,refetchOnReconnect:true,retry:false});
  const ready=enabled&&online&&!result.isRefetching&&!result.isError&&query===search.trim();
  const ids=new Set<string>();
  return {...result,ready,projects:ready?(result.data?.pages.flatMap(page=>page.projects)??[]).filter(p=>!ids.has(p.id)&&Boolean(ids.add(p.id))):[]};
}
