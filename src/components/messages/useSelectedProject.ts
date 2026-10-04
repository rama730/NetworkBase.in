"use client";

import { usePathname } from "next/navigation";

import { useChatUi } from "@/components/messages/chat-ui-store";
import { useChatShell } from "@/components/messages/ChatShellProvider";

const ROUTE_ID = /^\/messages\/(p\/)?([0-9a-f-]{36})/i;

/**
 * The project shown in the sidebar: the URL's (/messages/p/{id}; /messages is All), else the
 * user's pick, else the open channel's project. A project you're not in shows All.
 */
export function useSelectedProject(): string | null {
  const chosen = useChatUi((state) => state.projectId);
  const { data } = useChatShell();
  const pathname = usePathname() ?? "";
  const known = (id: string | null | undefined) => Boolean(id) && (!data?.projects || data.projects.some((project) => project.id === id));
  const match = pathname.match(ROUTE_ID);
  if (match?.[1]) return known(match[2]) ? match[2]! : null;
  if (pathname === "/messages") return null;
  if (chosen !== undefined) return known(chosen) ? chosen : null;
  if (!match) return null;
  const projectId = data?.channels.find((channel) => channel.id === match[2])?.project_id ?? null;
  return projectId && data?.projects?.some((project) => project.id === projectId) ? projectId : null;
}
