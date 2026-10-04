"use client";

import { usePathname } from "next/navigation";

import { useChatUi } from "@/components/messages/chat-ui-store";
import { useChatShell } from "@/components/messages/ChatShellProvider";

const ROUTE_ID = /^\/messages\/(p\/)?([0-9a-f-]{36})/i;

/** The project shown in the sidebar: the user's pick, else the open channel's project, else Home. */
export function useSelectedProject(): string | null {
  const chosen = useChatUi((state) => state.projectId);
  const { data } = useChatShell();
  const pathname = usePathname() ?? "";
  if (chosen !== undefined) return chosen;
  const match = pathname.match(ROUTE_ID);
  if (!match) return null;
  if (match[1]) return match[2] ?? null;
  const projectId = data?.channels.find((channel) => channel.id === match[2])?.project_id ?? null;
  return projectId && data?.projects?.some((project) => project.id === projectId) ? projectId : null;
}
