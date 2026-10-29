'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Copy, Share2, Send } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/use-auth';
import { useChatShell } from '@/components/messages/ChatShellProvider';
import { channelTitle } from '@/lib/messaging/channel-view';
import { WORKSPACES_SCOPE,type ConversationScope } from '@/lib/sharing/destination-scope';
import { ShareDestinationBrowser,type ConversationListMemory } from './ShareDestinationBrowser';
import { getShareDestination } from '@/app/actions/sharing-destinations';
import { chatErrorMessage } from '@/lib/messaging/errors';
import { buildAuthPageHref } from '@/lib/auth/redirects';
import { sendSharedLink, saveShareUsername } from '@/app/actions/sharing';
import { normalizeUsername, validateUsername } from '@/lib/validations/username';
import { accessCopy, genericSharePreview, parseShareResource, profileSharePath, shareOrigin, type ShareKind, type SharePreview } from '@/lib/sharing/presentation';
import { queryKeys } from '@/lib/query-keys';
import { getSessionIdentifierFromSession } from '@/lib/auth/session-identifier';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { SharePreviewCard } from './SharePreviewCard';

export type SharePreviewResponse = { publicPreview: SharePreview; viewerPreview: SharePreview; viewerId: string | null };
export async function fetchSharePreview(url: string, signal?: AbortSignal): Promise<SharePreviewResponse> {
  const response = await fetch(`/api/v1/share-preview?url=${encodeURIComponent(url)}`, { signal, cache: 'no-store' });
  const body = await response.json();
  if (!response.ok || !body.success || !body.data?.publicPreview) throw new Error('Preview details could not load.');
  return body.data;
}

export function ShareDialog({ kind, path, onClose, ownerUsernameSetup, returnFocusElement }: {
  kind: ShareKind; path: string | null; onClose: () => void;
  ownerUsernameSetup?: { profileId: string; updatedAt?: string | Date | null; onSaved: (username: string) => void };
  returnFocusElement?: HTMLElement | null;
}) {
  const { user, session, refreshProfile } = useAuth();
  const userId = user?.id ?? null;
  const authScope = JSON.stringify([userId,getSessionIdentifierFromSession(session)]);
  const online = useOnlineStatus();
  const mobile = useMediaQuery('(max-width: 639px)');
  const shell = useChatShell();
  const origin = shareOrigin();
  const [newPath, setNewPath] = useState<string | null>(null);
  const sourceUrl = (newPath || path) ? new URL((newPath || path)!, origin).href : null;
  const resource = sourceUrl ? parseShareResource(sourceUrl, origin) : null;
  const url = resource?.url ?? null;
  const fallback = resource ? genericSharePreview(resource) : null;
  const [format, setFormat] = useState<'public' | 'internal'>('public');
  const [step, setStep] = useState<'share' | 'send' | 'username'>('share');
  const [message, setMessage] = useState('');
  const [manual, setManual] = useState(false);
  const [target, setTarget] = useState('');
  const [note, setNote] = useState('');
  const [scope,setScope]=useState<ConversationScope>(WORKSPACES_SCOPE);
  const [listMemory]=useState<ConversationListMemory>(()=>new Map());
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [receiptState, setReceiptState] = useState<'none'|'unknown'|'missing'>('none');
  const [nativeAvailable, setNativeAvailable] = useState(false);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [draftAccount, setDraftAccount] = useState(userId);
  const pending = useRef(false);
  const alive = useRef(true);
  const draftIntent = useRef<{ fingerprint:string;id:string;channelId:string;url:string;note:string;entityKey:string|null }|null>(null);
  const field = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLElement | null>(returnFocusElement ?? (typeof document !== 'undefined' ? document.activeElement as HTMLElement : null));
  const resolvedUrl = useRef<{ source: string | null; scope: string; url: string | null }>({source:url,scope:authScope,url:null});
  const composeEntity = useRef<string | null>(null);
  const currentUser = useRef(userId); currentUser.current = userId;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const previewQuery = useQuery({ queryKey: queryKeys.sharing.preview(url, userId, getSessionIdentifierFromSession(session)),
    queryFn: ({ signal }) => fetchSharePreview(url!, signal), enabled: Boolean(resource), staleTime: 0, gcTime: 0,
    refetchOnWindowFocus: true, refetchInterval: 30_000, retry: false });
  // Refetching/offline never paints an earlier permission-qualified snapshot.
  const current = online && !previewQuery.isFetching && !previewQuery.isPaused && previewQuery.data?.viewerId === userId ? previewQuery.data : undefined;
  const publicPreview = current?.publicPreview ?? fallback;
  const internalPreview = current?.viewerPreview ?? fallback;
  if (current?.viewerPreview.entityKey) composeEntity.current = current.viewerPreview.entityKey;
  if (current?.publicPreview.url) resolvedUrl.current = {source:url,scope:authScope,url:current.viewerPreview.state === 'ready' ? current.viewerPreview.url : current.publicPreview.url};
  const sameDraftAccount = !userId || !draftAccount || userId === draftAccount;
  const canonicalUrl = sameDraftAccount ? (resolvedUrl.current.source === url && resolvedUrl.current.scope === authScope ? resolvedUrl.current.url : null) ?? resource?.url ?? null : null;
  const selectedRaw = format === 'public' ? publicPreview : internalPreview;
  const selected = selectedRaw && canonicalUrl ? {...selectedRaw,url:canonicalUrl} : selectedRaw;
  const unavailable = current?.viewerPreview.state === 'unavailable';
  useEffect(() => { if (userId && previewQuery.data?.viewerId === userId) setNeedsAuth(false); }, [userId, previewQuery.dataUpdatedAt, previewQuery.data?.viewerId]);
  useEffect(() => { setNativeAvailable(window.isSecureContext && typeof navigator.share === 'function'); }, []);
  useEffect(() => {
    if (userId && draftAccount && userId !== draftAccount) {
      setNote(''); setTarget(''); setScope(WORKSPACES_SCOPE); listMemory.clear(); setUsername(''); setNewPath(null); draftIntent.current = null; setReceiptState('none'); composeEntity.current = null;
      setMessage('Account changed. Choose a conversation for this account.');
    }
    if (userId) setDraftAccount(userId);
  }, [userId, draftAccount]);
  const targetQuery=useQuery({queryKey:queryKeys.sharing.destination(userId,getSessionIdentifierFromSession(session),target),
    enabled:Boolean(target&&userId&&online&&step==='send'),staleTime:0,gcTime:0,refetchInterval:30_000,refetchOnWindowFocus:true,refetchOnReconnect:true,retry:false,
    queryFn:async({signal})=>{const result=await getShareDestination({channelId:target,expectedActorId:userId!});signal.throwIfAborted();if(!result.success)throw new Error(result.error);if(result.viewerId!==userId)throw new Error('chat_unauthorized');return result.channel;}});
  const targetData=online&&draftAccount===userId&&!targetQuery.isRefetching&&!targetQuery.isError?targetQuery.data:undefined;
  const targetAvailable=Boolean(targetData?.is_member&&targetData.can_send===true);
  useEffect(()=>{if(targetQuery.error?.message==='chat_unauthorized')setNeedsAuth(true);
    else if(target&&((targetQuery.isError)||targetQuery.data?.can_send===false||targetQuery.data?.is_member===false)){setTarget('');setMessage('This destination is no longer available. Your note is kept.');shell.refresh();}
  },[targetQuery.data,targetQuery.isError,targetQuery.error?.message,target,shell.refresh]);
  const targetLabel=targetData?`${targetData.project_title?targetData.project_title+' / ':''}${targetData.kind!=='dm'&&targetData.name?'#':''}${channelTitle(targetData,userId)}`:target?'Checking destination…':'';
  const canCheckReceipt=Boolean(sameDraftAccount && draftIntent.current && receiptState!=='none');
  const receiptTarget=draftIntent.current?.channelId ?? '';
  const receiptDestination=useQuery({queryKey:queryKeys.sharing.destination(userId,getSessionIdentifierFromSession(session),receiptTarget),
    enabled:Boolean(receiptState!=='none'&&receiptTarget&&userId&&online&&!needsAuth),staleTime:0,gcTime:0,retry:false,
    queryFn:async({signal})=>{const result=await getShareDestination({channelId:receiptTarget,expectedActorId:userId!});signal.throwIfAborted();if(!result.success||result.viewerId!==userId)throw new Error('chat_unauthorized');return result.channel;}});
  const canRetryOriginal=Boolean(receiptState==='missing' && online && !needsAuth && draftIntent.current && !receiptDestination.isFetching && !receiptDestination.isError
    && receiptDestination.data?.is_member && receiptDestination.data.can_send && current?.viewerPreview.state==='ready' && (canonicalUrl===draftIntent.current.url || current.viewerPreview.entityKey===draftIntent.current.entityKey));
  const changeScope=(next:ConversationScope)=>{if(!pending.current){setScope(next);setTarget('');setMessage('');}};
  const copy = async () => {
    if (!canonicalUrl) return;
    try { await navigator.clipboard.writeText(canonicalUrl); if (alive.current) { setManual(false); setMessage('Link copied'); } }
    catch { if (alive.current) { setManual(true); setMessage('Select and copy the link manually.'); field.current?.focus(); field.current?.select(); } }
  };
  const nativeShare = async () => {
    if (!publicPreview || !canonicalUrl) return;
    try { await navigator.share({ title: publicPreview.title, text: publicPreview.description, url: canonicalUrl });
      if (alive.current) setMessage('Returned from device sharing.'); }
    catch (error) { if (alive.current) setMessage(error instanceof Error && error.name === 'AbortError' ? 'Device sharing canceled.' : 'Couldn’t share with that app. Copy the link instead.'); }
  };
  const send = async (retryOriginal = false) => {
    if(receiptState!=='none'&&!retryOriginal)return;
    if(retryOriginal&&!canRetryOriginal)return;
    const checkingReceipt=retryOriginal||!targetAvailable&&Boolean(draftIntent.current&&(!target||target===draftIntent.current.channelId));
    if(pending.current||!online||!userId||needsAuth||(!checkingReceipt&&(!targetAvailable||!canonicalUrl||current?.viewerPreview.state!=='ready')))return;
    const account=userId;
    const fingerprint=JSON.stringify([account,target,current?.viewerPreview.entityKey??composeEntity.current??url,note]);
    if(!checkingReceipt&&draftIntent.current?.fingerprint!==fingerprint)draftIntent.current={fingerprint,id:`share:${crypto.randomUUID()}`,channelId:target,url:canonicalUrl!,note,entityKey:current?.viewerPreview.entityKey??composeEntity.current};
    const intent=draftIntent.current!;
    pending.current=true;setBusy(true);setMessage(checkingReceipt?'Checking the earlier send…':'Sending…');
    try {
      const result=await sendSharedLink({url:checkingReceipt&&canonicalUrl!==intent.url&&current?.viewerPreview.entityKey===intent.entityKey?canonicalUrl!:checkingReceipt?intent.url:canonicalUrl!,channelId:intent.channelId,note:checkingReceipt?intent.note:note,clientId:intent.id,expectedSenderId:account});
      if(!alive.current||currentUser.current!==account)return;
      if(!result.success){
        if(result.error==='chat_unauthorized')setNeedsAuth(true);
        if(['chat_not_member','chat_channel_not_found','chat_channel_archived','chat_blocked'].includes(result.error)){setTarget('');}
        setMessage(result.error==='share_link_changed'?'The link changed. Review the refreshed preview before retrying.':result.error==='share_unavailable'?'This link is no longer available to share. Your note is kept.':chatErrorMessage(result.error));
        void previewQuery.refetch();void targetQuery.refetch();shell.refresh();return;
      }
      const changedDraft=checkingReceipt&&(note!==intent.note||Boolean(target&&target!==intent.channelId));
      draftIntent.current=null;setReceiptState('none');if(note===intent.note)setNote('');if(!changedDraft){setTarget('');setStep('share');}setMessage(checkingReceipt?'Already sent.':'Link sent in the selected conversation.');shell.refresh();
    } catch {if(alive.current&&currentUser.current===account){setReceiptState('unknown');setMessage('The send could not be confirmed. Check the earlier receipt before sending again. Your draft is kept.');}}
    finally {pending.current=false;if(alive.current)setBusy(false);}
  };
  const checkReceipt = async () => {
    const intent=draftIntent.current;
    if(!intent||pending.current||!online||!userId||needsAuth)return;
    const account=userId;pending.current=true;setBusy(true);setMessage('Checking the earlier send…');
    try {
      const result=await sendSharedLink({url:intent.url,channelId:intent.channelId,note:intent.note,clientId:intent.id,expectedSenderId:account,checkOnly:true});
      if(!alive.current||currentUser.current!==account)return;
      if(!result.success){if(result.error==='chat_unauthorized')setNeedsAuth(true);setMessage('The earlier receipt could not be checked. No new message was attempted. Your draft is kept.');return;}
      if('receipt' in result&&result.receipt==='missing'){setReceiptState('missing');setMessage('No earlier receipt is confirmed. Retry its original send intent after current access is verified; your edited draft stays separate.');return;}
      const changed=note!==intent.note||Boolean(target&&target!==intent.channelId);
      draftIntent.current=null;setReceiptState('none');if(note===intent.note)setNote('');if(target===intent.channelId&&!changed)setTarget('');
      if(!changed)setStep('share');setMessage('Already sent.');shell.refresh();
    } catch {if(alive.current&&currentUser.current===account)setMessage('Receipt check unavailable. No new message was attempted. Your draft is kept.');}
    finally{pending.current=false;if(alive.current)setBusy(false);}
  };
  const saveUsername = async () => {
    const normalized = normalizeUsername(username), validation = validateUsername(normalized);
    if (!validation.valid) return setMessage(validation.message);
    if (pending.current || !ownerUsernameSetup || !userId) return;
    if (ownerUsernameSetup.profileId !== userId) return setMessage('Your account changed. Return to your own profile to set its username.');
    const account = userId;
    pending.current = true; setBusy(true);
    try {
      const result = await saveShareUsername({ username: normalized, expectedSenderId:account,
        expectedUpdatedAt: ownerUsernameSetup.updatedAt ? new Date(ownerUsernameSetup.updatedAt).toISOString() : undefined });
      if (!alive.current || currentUser.current !== account) return;
      if (!result.success) return setMessage(result.error || 'Couldn’t save the username.');
      setNewPath(profileSharePath(normalized)); ownerUsernameSetup.onSaved(normalized); await refreshProfile(); setStep('share'); setMessage('Username saved. Your sharing link is ready.');
    } catch { if (alive.current) setMessage('Couldn’t save the username. Try again.'); }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  };
  const title = `Share ${kind === 'application' ? 'NetworkBase' : kind}`;
  return <Dialog open onOpenChange={open => { if (!open && !pending.current) onClose(); }}>
    <DialogContent presentation={mobile ? 'bottom-sheet' : 'center'} className={`gap-4 p-6 max-h-[90dvh] overflow-y-auto sm:max-w-[480px] ${mobile ? 'pb-[calc(1.5rem+env(safe-area-inset-bottom))]' : ''}`} onCloseAutoFocus={event => { event.preventDefault(); trigger.current?.focus(); }}
      onEscapeKeyDown={event => { if (pending.current) event.preventDefault(); }} showCloseButton={!busy}>
      <DialogHeader><DialogTitle>{step === 'send' ? `Send ${kind}` : step === 'username' ? 'Set your username' : title}</DialogTitle>
        <DialogDescription>{step === 'send' ? 'Choose a conversation you already have access to.' : step === 'username' ? 'Set a username to get a short profile link.' : 'Review the link and what recipients can see.'}</DialogDescription></DialogHeader>
      {step === 'username' ? <>
        <label className="space-y-2 text-[13px]">Username<Input value={sameDraftAccount?username:''} maxLength={20} onChange={event => setUsername(event.target.value)} autoComplete="off" disabled={busy} /></label>
        <p className="nb-compact text-muted-foreground">3–20 lowercase letters, numbers or underscores. Your profile visibility stays the same.</p>
        <div className="flex gap-2"><Button variant="outline" disabled={busy} onClick={() => { setStep('share'); setMessage(''); }}>Back</Button><Button disabled={busy} onClick={() => void saveUsername()}>{busy ? 'Saving…' : 'Save username'}</Button></div>
      </> : step === 'send' ? <>
        {!userId || needsAuth ? <><p className="nb-compact text-muted-foreground">Sign in again to send. Your draft stays here until you close this dialog.</p><Button asChild><a href={buildAuthPageHref('/login', canonicalUrl ? new URL(canonicalUrl).pathname : '/discover')} target="_blank" rel="noopener">Sign in</a></Button><Button variant="outline" onClick={() => void previewQuery.refetch()}>Check sign-in</Button></> : <>
          <ShareDestinationBrowser scope={scope} onScopeChange={changeScope} selectedId={target} disabled={busy} memory={listMemory} onAuthRequired={setNeedsAuth} onSelect={channel=>{setTarget(channel.id);setMessage('');}}/>
        </>}
        <label className="space-y-2 text-[13px]">Note (optional)<textarea value={sameDraftAccount?note:''} maxLength={1000} rows={2} disabled={busy} onChange={event => setNote(event.target.value)} className="w-full rounded-md border border-input bg-card px-3 py-2 outline-none focus:border-ring" /></label>
        <p className="nb-compact text-muted-foreground">Recipients see the details permitted for their own accounts.</p>
        {canCheckReceipt?<div className="rounded-md border border-border bg-muted p-3"><p className="nb-compact mb-2">Resolve the earlier send before starting a new one. Changed notes and destinations remain separate.</p><div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy||!online||!userId||needsAuth} onClick={()=>void checkReceipt()}>Check earlier send</Button>{receiptState==='missing'?<Button disabled={busy||!canRetryOriginal} onClick={()=>void send(true)}>Retry earlier send</Button>:null}</div></div>:null}
        <p className="break-words text-[12px] text-muted-foreground">{targetLabel?`Send to ${targetLabel}`:draftIntent.current?'An earlier send can be checked safely.':'Choose a channel or a person to continue.'}</p>
        <div className="flex justify-between gap-2"><Button variant="outline" disabled={busy} onClick={() => { setStep('share'); setMessage(''); }}>Back to sharing</Button><Button disabled={receiptState!=='none'||!online||!userId||needsAuth||busy||!targetAvailable||(unavailable||current?.viewerPreview.state!=='ready')} onClick={() => void send()}>{busy?'Sending…':'Send'}</Button></div>
      </> : <>
        <label className="space-y-2 text-[13px]">{kind === 'profile' ? 'Profile link' : 'Link'}<Input ref={field} readOnly value={canonicalUrl ?? ''} placeholder={ownerUsernameSetup ? 'Set a username to get a profile link' : 'No valid sharing link'} onFocus={event => { if (manual) event.target.select(); }} className="font-mono text-[12px]" /></label>
        <p className="nb-compact text-muted-foreground">{!online ? 'You are offline. Copy the link now; reconnect to load the preview and send.' : publicPreview ? accessCopy(internalPreview?.draft ? internalPreview : publicPreview) : 'A valid username is needed before sharing this profile.'}</p>
        {canonicalUrl && selected ? <>
          <div role="group" aria-label="Preview audience" className="flex flex-wrap gap-2"><Button size="sm" variant={format === 'public' ? 'secondary' : 'outline'} aria-pressed={format === 'public'} onClick={() => setFormat('public')}>Outside NetworkBase</Button><Button size="sm" variant={format === 'internal' ? 'secondary' : 'outline'} aria-pressed={format === 'internal'} onClick={() => setFormat('internal')}>On NetworkBase</Button></div>
          <SharePreviewCard preview={selected} loading={previewQuery.isLoading} />
          <p className="nb-compact text-muted-foreground">{format === 'public' ? 'External apps receive public metadata. Their framing and refresh timing may differ.' : 'This sample uses your current access. Each recipient’s permissions are checked separately.'}</p>
          {previewQuery.isError || publicPreview?.state === 'unknown' ? <Button size="sm" variant="outline" disabled={!online||previewQuery.isFetching} onClick={() => void previewQuery.refetch()}>Retry preview</Button> : null}
        </> : null}
        {ownerUsernameSetup && !canonicalUrl ? <Button onClick={() => { setStep('username'); setMessage(''); }}>Set username</Button> : <>
          <Button disabled={!canonicalUrl || unavailable} onClick={() => void copy()}><Copy className="size-4" />Copy link</Button>
          {nativeAvailable ? <Button variant="outline" disabled={!canonicalUrl || unavailable} onClick={() => void nativeShare()}><Share2 className="size-4" />Share to…</Button> : null}
          {<Button variant="outline" disabled={!canonicalUrl || unavailable} onClick={() => { setScope(WORKSPACES_SCOPE);setTarget('');setStep('send');setMessage('');shell.refresh(); }}><Send className="size-4" />{userId?'Send in NetworkBase':'Sign in to send in NetworkBase'}</Button>}
        </>}
      </>}
      <p role="status" aria-live="polite" className="min-h-5 break-words text-[12px] text-muted-foreground">{message}</p>
    </DialogContent>
  </Dialog>;
}
