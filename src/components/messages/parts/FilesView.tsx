"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { FileText, Image as ImageIcon, Video } from "lucide-react";

import { listFiles } from "@/app/actions/chat/messages";
import { formatChatTime } from "@/lib/messaging/channel-view";
import { messageHref } from "@/lib/messaging/routes";
import { queryKeys } from "@/lib/query-keys";

function size(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Every file shared in the conversation, newest first, each linking to its message. */
export function FilesView({ channelId }: { channelId: string }) {
  const files = useQuery({
    queryKey: queryKeys.chat.files(channelId),
    queryFn: async () => {
      const result = await listFiles({ channelId });
      return result.success ? result.files : [];
    },
    staleTime: 30_000,
  });
  if (files.isLoading) return <p role="status" className="p-6 text-center text-[13px] text-muted-foreground">Loading files…</p>;
  if (!files.data?.length) return <p className="p-6 text-center text-[13px] text-muted-foreground">No files yet. Files shared here show up in this tab.</p>;
  return (
    <ul className="app-scroll app-scroll-y min-h-0 flex-1 divide-y divide-border" aria-label="Files">
      {files.data.map((file) => {
        const Icon = file.mime.startsWith("image/") ? ImageIcon : file.mime.startsWith("video/") ? Video : FileText;
        return (
          <li key={`${file.seq}:${file.asset_id}`} className="flex min-h-14 items-center gap-3 px-4 py-2">
            <span className="grid size-9 flex-none place-items-center rounded-[5px] bg-muted text-muted-foreground"><Icon size={17} aria-hidden="true" /></span>
            <span className="min-w-0 flex-1">
              <a href={`/api/v1/chat/attachments/${file.asset_id}`} target="_blank" rel="noopener noreferrer" className="block truncate text-[14px] font-medium hover:underline">{file.name || "File"}</a>
              <span className="block truncate text-[12px] text-muted-foreground">{size(file.size)} · {file.author ?? "Someone"} · {formatChatTime(file.created_at)}</span>
            </span>
            <Link href={messageHref(channelId, file.seq, file.thread_root_seq)} className="flex-none text-[12px] font-medium text-primary hover:underline">View message</Link>
          </li>
        );
      })}
    </ul>
  );
}
