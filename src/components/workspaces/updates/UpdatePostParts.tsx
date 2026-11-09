'use client';

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { Heart, Share2 } from 'lucide-react';
import { useToggleWorkspaceFollow } from '@/hooks/mutations/useWorkspaceMutations';
import { renderCommentContent } from '@/components/workspaces/updates/update-helpers';
import { toast } from '@/lib/feedback';
import { setWorkspaceUpdateReplyPolicyAction, toggleWorkspaceUpdateCommentLikeAction, type WorkspaceUpdateCommentView } from '@/app/actions/workspace/updates';
import { muteNotificationScopeAction } from '@/app/actions/notifications';
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import type { BlockPerson } from '@/components/privacy/BlockDialog';
import { patchUpdateEverywhere } from '@/hooks/useUpdateLive';
import { WorkspaceUpdateLikersModal } from '@/components/workspaces/updates/WorkspaceUpdateLikersModal';
import { cn } from '@/lib/utils';
import type { UpdatePreview } from '@/lib/workspaces/update-previews';
import { copyText } from '@/lib/clipboard';

// The parts every post card shares, on Discover and on the Updates tab (UP9).

/** @deprecated LikedByLine was removed in favor of the clean reaction footer with the like counter trigger. */
export function LikedByLine(_props: { likeCount?: number; likedByViewer?: boolean; likedByName?: string | null | undefined; onOpen?: () => void }) {
  return null;
}

/** Up to two comments under the post; the rest are one tap away. */
export function CommentPreview({ preview, commentCount, onOpen }: { preview: UpdatePreview | null | undefined; commentCount: number; onOpen: () => void }) {
  const comments = preview?.comments ?? [];
  if (comments.length === 0) return null;
  return (
    <div className="mt-2 space-y-1">
      {comments.map((comment) => (
        <p key={comment.id} className="line-clamp-2 break-words text-[13px] leading-snug text-foreground/85">
          {comment.authorUsername ? (
            <Link href={`/u/${comment.authorUsername}`} onClick={(e) => e.stopPropagation()} className="font-medium text-foreground hover:underline">{comment.authorName}</Link>
          ) : <span className="font-medium text-foreground">{comment.authorName}</span>}{' '}
          {renderCommentContent(comment.content)}
        </p>
      ))}
      {commentCount > comments.length ? (
        <button type="button" onClick={(e) => { e.stopPropagation(); onOpen(); }} className="inline-flex min-h-8 items-center text-xs text-muted-foreground hover:text-foreground focus-visible:underline">
          View all {commentCount} comments
        </button>
      ) : null}
    </div>
  );
}

/** The phone's share sheet where there is one, otherwise a copied link. */
export function ShareUpdateButton({ path }: { path: string }) {
  const share = async () => {
    const url = new URL(path, window.location.origin).href;
    try {
      if (navigator.share) {
        await navigator.share({ url });
        return;
      }
      await copyText(url);
      toast.success('Link copied');
    } catch (error) {
      if ((error as Error)?.name !== 'AbortError') toast.error('Couldn’t copy the link');
    }
  };
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); void share(); }} aria-label="Share this update" className="inline-flex min-h-11 items-center gap-1.5 rounded-[5px] px-2.5 text-xs transition-colors hover:bg-muted hover:text-foreground focus-visible:bg-muted">
      <Share2 className="h-3.5 w-3.5" aria-hidden="true" />
    </button>
  );
}

/** For people outside the workspace: this is what turns a stranger's like into an audience. */
export function FollowWorkspaceButton({ projectId, userId, following: initial }: { projectId: string; userId: string; following: boolean }) {
  const { mutateAsync, isPending } = useToggleWorkspaceFollow();
  const [following, setFollowing] = useState(initial);
  useEffect(() => setFollowing(initial), [initial]);
  return (
    <button
      type="button"
      disabled={isPending}
      aria-pressed={following}
      onClick={async (e) => {
        e.stopPropagation();
        setFollowing(!following);
        try {
          await mutateAsync({ projectId, currentStatus: following, userId });
        } catch {
          setFollowing(following);
          toast.error('Couldn’t update your follow');
        }
      }}
      className="inline-flex min-h-11 shrink-0 items-center rounded-[5px] px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:bg-muted"
    >
      {following ? 'Following' : 'Follow'}
    </button>
  );
}

/** A heart on a comment or reply: live like the post's, and its count opens "Liked by" (UP10). */
export function CommentLikeButton({ comment, projectId, signedIn }: { comment: WorkspaceUpdateCommentView; projectId: string; signedIn: boolean }) {
  const [state, setState] = useState({ liked: comment.likedByViewer, count: comment.likeCount });
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  // Live counts arrive through a reload of the thread; your own tap isn't undone by one on its way.
  useEffect(() => { if (!busy) setState({ liked: comment.likedByViewer, count: comment.likeCount }); }, [busy, comment.likeCount, comment.likedByViewer]);
  const toggle = async () => {
    if (busy) return;
    const previous = state;
    setBusy(true);
    setState({ liked: !previous.liked, count: Math.max(0, previous.count + (previous.liked ? -1 : 1)) });
    const result = await toggleWorkspaceUpdateCommentLikeAction(projectId, comment.id).catch(() => null);
    if (result?.success) setState({ liked: result.liked, count: result.likeCount });
    else {
      setState(previous);
      toast.error(result?.error ?? 'Couldn’t update the like');
    }
    setBusy(false);
  };
  return (
    <span className={cn('inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground', state.liked && 'text-[var(--status-danger)]')}>
      {signedIn ? (
        <button type="button" onClick={() => void toggle()} aria-pressed={state.liked} aria-label="Like this comment" className="nb-touch-target inline-flex items-center justify-center rounded-sm transition-transform active:scale-90 motion-reduce:transition-none motion-reduce:active:scale-100">
          <Heart className={cn('h-3.5 w-3.5', state.liked && 'fill-current')} aria-hidden="true" />
        </button>
      ) : <Heart className="h-3.5 w-3.5" aria-hidden="true" />}
      {state.count > 0 ? (
        <button type="button" onClick={() => setOpen(true)} aria-label={`View ${state.count} ${state.count === 1 ? 'like' : 'likes'}`} className="tabular-nums hover:underline">{state.count}</button>
      ) : null}
      {open ? <WorkspaceUpdateLikersModal open onOpenChange={setOpen} projectId={projectId} updateId={comment.updateId} commentId={comment.id} likeCount={state.count} /> : null}
    </span>
  );
}

const REPLY_CHOICES = [
  { id: 'logged_in', label: 'Anyone signed in can reply' },
  { id: 'members', label: 'Only members can reply' },
  { id: 'closed', label: 'Turn off replies' },
] as const;

/** For the author and admins, in the post's "⋯": the quick way out of a thread that's going badly (UP13). */
export function ReplyPolicyMenuItems({ projectId, updateId, current }: { projectId: string; updateId: string; current: string }) {
  const queryClient = useQueryClient();
  const choose = async (replyPolicy: (typeof REPLY_CHOICES)[number]['id']) => {
    const result = await setWorkspaceUpdateReplyPolicyAction(projectId, updateId, replyPolicy).catch(() => null);
    if (!result?.success) return void toast.error(result?.error ?? 'Couldn’t change who can reply');
    patchUpdateEverywhere<{ id: string; replyPolicy: string; canComment: boolean }>(queryClient, projectId, updateId, (item) => ({ ...item, replyPolicy, canComment: replyPolicy !== 'closed' }));
    toast.success(replyPolicy === 'closed' ? 'Replies are off' : 'Reply setting changed');
  };
  return (
    <>
      <DropdownMenuSeparator />
      {REPLY_CHOICES.filter((choice) => choice.id !== current).map((choice) => (
        <DropdownMenuItem key={choice.id} onSelect={() => void choose(choice.id)}>{choice.label}</DropdownMenuItem>
      ))}
      <DropdownMenuSeparator />
    </>
  );
}

/** "Mute this post" for one that gets busy. Settings → Notifications lists it, and unmutes it. */
export function MutePostMenuItem({ updateId }: { updateId: string }) {
  return (
    <DropdownMenuItem onSelect={() => {
      void muteNotificationScopeAction({ kind: 'update', value: updateId, label: 'A post you muted', mutedAt: null })
        .then((result) => {
          if (result.success) toast.success('Post muted. Unmute it in Settings → Notifications.');
          else toast.error('Couldn’t mute this post');
        })
        .catch(() => toast.error('Couldn’t mute this post'));
    }}>
      Mute this post
    </DropdownMenuItem>
  );
}

/** "Block Ravi" in a post's or comment's "⋯". The caller holds the confirmation, because the menu closes when this is chosen. */
export function BlockPostAuthorItem({ person, onBlock }: { person: BlockPerson; onBlock: (person: BlockPerson) => void }) {
  return <DropdownMenuItem variant="destructive" onSelect={() => onBlock(person)}>Block {person.name}</DropdownMenuItem>;
}
