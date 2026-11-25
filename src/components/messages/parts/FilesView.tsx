"use client";

import { useQuery } from "@tanstack/react-query";
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
            <DownloadLink href={`/api/v1/chat/attachments/${file.asset_id}`} filename={file.name} aria-label={`Download ${file.name}`} title="Download" className="nbm-cell flex-none"><Download size={15} aria-hidden="true" /></DownloadLink>
            <Link href={messageHref(channelId, file.seq, file.thread_root_seq)} className="nbm-lrow-act flex-none">View message</Link>
          </li>
        );
      })}
    </ul>
  );
}
