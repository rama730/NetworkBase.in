"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { useState } from "react";
import type { MediaItem } from "@/components/ui/media-viewer";
import { groupByMonth } from "@/lib/messaging/photos";
import { useOverlayHistory } from "@/lib/navigation/overlay-history";
import { rovingTabKey } from "@/components/messages/keys";
import { PixelBeat } from "@/components/messages/mix/primitives";

const MediaViewerModal = dynamic(() => import("@/components/ui/media-viewer").then((m) => m.MediaViewerModal), { ssr: false });
import Link from "next/link";
import { FileText, Image as ImageIcon, Paperclip, Video } from "lucide-react";

import { listFiles } from "@/app/actions/chat/messages";
import { RowsSkeleton } from "@/components/messages/parts/RowsSkeleton";
import { ErrorNotice } from "@/components/ui/ErrorNotice";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatChatTime, formatFileSize, fullTime } from "@/lib/messaging/channel-view";
import { messageHref } from "@/lib/messaging/routes";
import { queryKeys } from "@/lib/query-keys";
import { Download } from "lucide-react";
import { DownloadLink } from "@/components/ui/download-link";
import { middleCut } from "@/lib/messaging/mix-format";

/** The Files tab: List (every file) or Photos (a month grid of photos and videos, paged). */
export function FilesView({ channelId }: { channelId: string }) {
  const [view, setView] = useState<"list" | "photos">("list");
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="nbm-files-bar">
        <div
          role="radiogroup" aria-label="Show files as" className="nbm-seg"
          onKeyDown={(event) => {
            const key = event.key === "ArrowDown" ? "ArrowRight" : event.key === "ArrowUp" ? "ArrowLeft" : event.key;
            const next = rovingTabKey({ key, preventDefault: () => event.preventDefault() } as React.KeyboardEvent, view === "list" ? 0 : 1, 2);
            if (next === null) return;
            setView(next === 0 ? "list" : "photos");
            (event.currentTarget.children[next] as HTMLElement | undefined)?.focus();
          }}
        >
          {(["list", "photos"] as const).map((value) => (
            <button key={value} type="button" role="radio" aria-checked={view === value} tabIndex={view === value ? 0 : -1} onClick={() => setView(value)}>{value === "list" ? "List" : "Photos"}</button>
          ))}
        </div>
      </div>
      {view === "list" ? <FilesList channelId={channelId} /> : <PhotosGrid channelId={channelId} />}
    </div>
  );
}

/** Photos and videos by month, newest first; "Load older" pages back; a tile opens the viewer over the loaded set. */
function PhotosGrid({ channelId }: { channelId: string }) {
  const media = useInfiniteQuery({
    queryKey: [...queryKeys.chat.files(channelId), "media"],
    initialPageParam: null as { seq: number; idx: number } | null,
    queryFn: async ({ pageParam }) => {
      const result = await listFiles({ channelId, kind: "media", before: pageParam ?? undefined });
      if (!result.success) throw new Error(result.error);
      return result;
    },
    getNextPageParam: (page) => page.next,
    staleTime: 30_000,
  });
  const [open, setOpen] = useState<string | null>(null);
  // Back or swipe closes the viewer first (unified back A3).
  useOverlayHistory("media", open !== null, () => setOpen(null));
  const files = media.data?.pages.flatMap((page) => page.files) ?? [];
  if (media.isLoading) return <RowsSkeleton label="Loading photos…" />;
  if (media.isError && !files.length) return <ErrorNotice what="Photos" onRetry={() => void media.refetch()} className="m-4" />;
  if (!files.length) return <EmptyState compact icon={ImageIcon} title="No photos or videos yet" description="Photos and videos shared here show up in this view." className="m-4" />;
  const items: MediaItem[] = files.map((file) => {
    const url = `/api/v1/chat/attachments/${file.asset_id}`;
    return { id: file.asset_id, url, filename: file.name, type: file.mime.startsWith("video/") ? "video" : "image", thumbnailUrl: file.mime.startsWith("image/") ? url : undefined };
  });
  return (
    <div className="nbm-photos app-scroll app-scroll-y min-h-0 flex-1">
      {groupByMonth(files).map((group, index) => (
        <section key={`${index}:${group.label}`} aria-label={group.label}>
          <p className="nbm-glabel"><span>{group.label}</span><span className="nbm-glabel-rule" aria-hidden="true" /></p>
          <div className="nbm-photos-grid">
            {group.files.map((file) => (
              <button key={`${file.seq}:${file.idx}`} type="button" className="nbm-photo" onClick={() => setOpen(file.asset_id)} aria-label={`Open ${file.name || (file.mime.startsWith("video/") ? "video" : "photo")}`} title={file.name}>
                {file.mime.startsWith("video/") ? (
                  <span className="nbm-photo-video"><Video size={18} aria-hidden="true" /></span>
                ) : (
                  <img src={`/api/v1/chat/attachments/${file.asset_id}`} alt="" loading="lazy" />
                )}
              </button>
            ))}
          </div>
        </section>
      ))}
      {media.isFetchNextPageError ? <ErrorNotice what="Older photos" onRetry={() => void media.fetchNextPage()} className="mx-0" /> : null}
      {media.hasNextPage ? (
        <div className="p-4">
          <button type="button" className="nbm-loadmore" disabled={media.isFetchingNextPage} onClick={() => void media.fetchNextPage()}>{media.isFetchingNextPage ? <><PixelBeat />Loading…</> : "Load older"}</button>
        </div>
      ) : null}
      {open ? <MediaViewerModal attachments={items} initialAttachmentId={open} originRect={null} initialVideoTime={0} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

/** Every file shared in the conversation, newest first, each linking to its message. */
function FilesList({ channelId }: { channelId: string }) {
  const files = useQuery({
    queryKey: queryKeys.chat.files(channelId),
    queryFn: async () => {
      const result = await listFiles({ channelId });
      if (!result.success) throw new Error(result.error);
      return result.files;
    },
    staleTime: 30_000,
  });
  if (files.isLoading) return <RowsSkeleton label="Loading files…" />;
  // An error is not "no files yet".
  if (files.isError) return <ErrorNotice what="Files" onRetry={() => void files.refetch()} className="m-4" />;
  if (!files.data?.length) return <EmptyState compact icon={Paperclip} title="No files yet" description="Files shared here show up in this tab." className="m-4" />;
  return (
    <ul className="app-scroll app-scroll-y min-h-0 flex-1 divide-y divide-border" aria-label="Files">
      {files.data.map((file) => {
        const Icon = file.mime.startsWith("image/") ? ImageIcon : file.mime.startsWith("video/") ? Video : FileText;
        return (
          <li key={`${file.seq}:${file.asset_id}`} className="nbm-lrow">
            {/* Images show themselves; other files their kind. */}
            {file.mime.startsWith("image/") ? (
              <img src={`/api/v1/chat/attachments/${file.asset_id}`} alt="" loading="lazy" className="nbm-lrow-thumb" />
            ) : (
              <span className="nbm-lrow-thumb nbm-lrow-glyph"><Icon size={18} aria-hidden="true" /></span>
            )}
            <span className="min-w-0 flex-1">
              <a href={`/api/v1/chat/attachments/${file.asset_id}`} target="_blank" rel="noopener noreferrer" className="block truncate text-[13px] font-medium hover:underline" title={file.name}>{middleCut(file.name || "File")}</a>
              <span className="nbm-lrow-meta block truncate" title={fullTime(file.created_at)}>{formatFileSize(file.size)} · {file.author ?? "Someone"} · {formatChatTime(file.created_at)}</span>
            </span>
            <DownloadLink href={`/api/v1/chat/attachments/${file.asset_id}`} filename={file.name} aria-label={`Download ${file.name}`} title="Download" className="nbm-cell nb-touch-target flex-none"><Download size={15} aria-hidden="true" /></DownloadLink>
            <Link href={messageHref(channelId, file.seq, file.thread_root_seq)} className="nbm-lrow-act flex-none">View message</Link>
          </li>
        );
      })}
    </ul>
  );
}
