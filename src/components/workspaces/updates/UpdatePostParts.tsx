'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Share2 } from 'lucide-react';
import { useToggleWorkspaceFollow } from '@/hooks/mutations/useWorkspaceMutations';
import { renderCommentContent } from '@/components/workspaces/updates/update-helpers';
import { toast } from '@/lib/feedback';
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
