"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { FileText, Image as ImageIcon, Paperclip, Video } from "@/components/ui/icons";

import { listFiles } from "@/app/actions/chat/messages";
import { RowsSkeleton } from "@/components/messages/parts/RowsSkeleton";
import { ErrorNotice } from "@/components/ui/ErrorNotice";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatChatTime, formatFileSize, fullTime } from "@/lib/messaging/channel-view";
import { messageHref } from "@/lib/messaging/routes";
import { queryKeys } from "@/lib/query-keys";
import { Download } from "@/components/ui/icons";
import { DownloadLink } from "@/components/ui/download-link";

/** Every file shared in the conversation, newest first, each linking to its message. */
export function FilesView({ channelId }: { channelId: string }) {
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
          <li key={`${file.seq}:${file.asset_id}`} className="flex min-h-14 items-center gap-3 px-4 py-2">
            {/* Images show themselves; other files their kind. */}
            {file.mime.startsWith("image/") ? (
              <img src={`/api/v1/chat/attachments/${file.asset_id}`} alt="" loading="lazy" className="size-[34px] flex-none rounded-md bg-muted object-cover" />
            ) : (
              <span className="grid size-[34px] flex-none place-items-center rounded-md bg-muted text-muted-foreground"><Icon size={18} aria-hidden="true" /></span>
            )}
            <span className="min-w-0 flex-1">
              <a href={`/api/v1/chat/attachments/${file.asset_id}`} target="_blank" rel="noopener noreferrer" className="block truncate text-[13px] font-medium hover:underline">{file.name || "File"}</a>
              <span className="nb-meta block truncate" title={fullTime(file.created_at)}>{formatFileSize(file.size)} · {file.author ?? "Someone"} · {formatChatTime(file.created_at)}</span>
            </span>
            <DownloadLink href={`/api/v1/chat/attachments/${file.asset_id}`} filename={file.name} aria-label={`Download ${file.name}`} title="Download" className="nb-icon-button size-8 flex-none pointer-coarse:size-11"><Download size={15} aria-hidden="true" /></DownloadLink>
            <Link href={messageHref(channelId, file.seq, file.thread_root_seq)} className="flex-none text-[13px] font-medium text-primary hover:underline pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center">View message</Link>
          </li>
        );
      })}
    </ul>
  );
}
