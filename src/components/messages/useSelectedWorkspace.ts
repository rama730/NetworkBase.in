"use client";

import { usePathname } from "next/navigation";

import { useChatUi } from "@/components/messages/chat-ui-store";
import { useChatShell } from "@/components/messages/ChatShellProvider";

const ROUTE_ID = /^\/messages\/(p\/)?([0-9a-f-]{36})/i;

/**
 * The project shown in the sidebar: the URL's (/messages/w/{id}; /messages is All), else the open
 * channel's project (opening another project's channel from ⌘K, the Inbox or Search shows that
 * project), else the user's pick. A project you're not in shows All.
 */
export function useSelectedWorkspace(): string | null {
  const chosen = useChatUi((state) => state.projectId);
  const { data } = useChatShell();
  const pathname = usePathname() ?? "";
  const known = (id: string | null | undefined) => Boolean(id) && (!data?.projects || data.projects.some((project) => project.id === id));
  const match = pathname.match(ROUTE_ID);
  if (match?.[1]) return known(match[2]) ? match[2]! : null;
  if (pathname === "/messages") return null;
  if (match) {
    const projectId = data?.channels.find((channel) => channel.id === match[2])?.project_id ?? null;
    if (projectId && data?.projects?.some((project) => project.id === projectId)) return projectId;
  }
  return chosen !== undefined && known(chosen) ? chosen : null;
}
