'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Heart, Share2 } from 'lucide-react';
import { useToggleWorkspaceFollow } from '@/hooks/mutations/useWorkspaceMutations';
import { renderCommentContent } from '@/components/workspaces/updates/update-helpers';
import { toast } from '@/lib/feedback';
import { toggleWorkspaceUpdateCommentLikeAction, type WorkspaceUpdateCommentView } from '@/app/actions/workspace/updates';
import { WorkspaceUpdateLikersModal } from '@/components/workspaces/updates/WorkspaceUpdateLikersModal';
import { cn } from '@/lib/utils';
import type { UpdatePreview } from '@/lib/workspaces/update-previews';

// The parts every post card shares, on Discover and on the Updates tab (UP9).

/** "Liked by Ravi and 12 others"; it opens "Liked by". Someone private isn't named, so then it's just the count. */
export function LikedByLine({ likeCount, likedByViewer, likedByName, onOpen }: { likeCount: number; likedByViewer: boolean; likedByName: string | null | undefined; onOpen: () => void }) {
  if (likeCount <= 0) return null;
  const others = (name: string, rest: number) => `${name}${rest > 0 ? ` and ${rest} ${rest === 1 ? 'other' : 'others'}` : ''}`;
  const label = likedByViewer && likeCount === 1 ? 'Liked by you'
    : likedByName ? `Liked by ${others(likedByName, likeCount - 1)}`
    : likedByViewer ? `Liked by ${others('you', likeCount - 1)}`
    : `${likeCount} ${likeCount === 1 ? 'like' : 'likes'}`;
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); onOpen(); }} className="mt-2 block max-w-full truncate text-left text-xs text-muted-foreground hover:text-foreground hover:underline focus-visible:underline">
      {label}
    </button>
  );
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
      await navigator.clipboard.writeText(url);
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
