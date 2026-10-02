"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { House, Moon, Plus } from "lucide-react";

import { useChatUi } from "@/components/messages/chat-ui-store";
import { useChatShell } from "@/components/messages/ChatShellProvider";
import { useSelectedProject } from "@/components/messages/useSelectedProject";
import { BrandMark } from "@/components/brand/BrandMark";
import { ProfileAvatar } from "@/components/layout/header/ProfileAvatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/useAuth";
import { useNotificationPreferences, useUpdateNotificationPreferences } from "@/hooks/useSettingsQueries";
import { initials, projectsByActivity, railBadges } from "@/lib/messaging/channel-view";
import { isNotificationPauseActive } from "@/lib/notifications/preferences";
import { useUIStore } from "@/stores/ui-store";

function Badge({ count }: { count: number }) {
  return count ? <span className="nb-chat-count" aria-hidden="true">{count > 99 ? "99+" : count}</span> : null;
}

function tomorrowMorning() {
  const next = new Date();
  next.setDate(next.getDate() + 1);
  next.setHours(8, 0, 0, 0);
  return next.toISOString();
}

/** 64px project switcher rail (report 7.10). Selecting a tile only changes in-memory state. */
export function ChatRail({ onCreateChannel }: { onCreateChannel: () => void }) {
  const router = useRouter();
  const { data } = useChatShell();
  const { profile } = useAuth();
  const selected = useSelectedProject();
  const setProject = useChatUi((state) => state.setProject);
  const openNavigation = useUIStore((state) => state.setMobileMenuOpen);
  const badges = railBadges(data);
  const projects = projectsByActivity(data);
  const { data: preferences } = useNotificationPreferences();
  const updatePreferences = useUpdateNotificationPreferences();
  const paused = preferences ? isNotificationPauseActive(preferences, new Date()) : false;
  const pause = (until: string | null) => {
    if (preferences) updatePreferences.mutate({ ...preferences, pausedUntil: until });
  };
  const homeCount = badges.get(null) ?? 0;

  return (
    <nav className="nb-chat-rail" aria-label="Projects">
      <button type="button" className="nb-chat-icon" aria-label="Open navigation" onClick={() => openNavigation(true)}>
        <BrandMark variant="dot" size={19} label="NetworkBase" />
      </button>
      <div className="nb-chat-rail-scroll">
        <button
          type="button"
          className="nb-chat-tile"
          aria-current={selected === null ? "true" : undefined}
          aria-label={`Home${homeCount ? `, ${homeCount} unread` : ""}`}
          title="Home"
          onClick={() => setProject(null)}
        >
          <House size={18} aria-hidden="true" />
          <Badge count={homeCount} />
        </button>
        {projects.map((project) => {
          const count = badges.get(project.id) ?? 0;
          return (
            <button
              key={project.id}
              type="button"
              className="nb-chat-tile"
              aria-current={selected === project.id ? "true" : undefined}
              aria-label={`${project.title}${count ? `, ${count} unread` : ""}`}
              title={project.title}
              onClick={() => setProject(project.id)}
            >
              {project.cover_image ? <Image src={project.cover_image} alt="" width={40} height={40} unoptimized /> : initials(project.title)}
              <Badge count={count} />
            </button>
          );
        })}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger className="nb-chat-icon" aria-label="Create">
          <Plus size={18} aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="end">
          <DropdownMenuItem onSelect={() => router.push("/messages/new")}>New message</DropdownMenuItem>
          {selected ? <DropdownMenuItem onSelect={onCreateChannel}>Create channel</DropdownMenuItem> : null}
          <DropdownMenuItem onSelect={() => router.push("/projects/new")}>New project</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger className="nb-chat-icon" aria-label={paused ? "Notifications paused" : "Pause notifications"}>
          <Moon size={18} aria-hidden="true" fill={paused ? "currentColor" : "none"} />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="end">
          <DropdownMenuLabel>{paused ? "Notifications paused" : "Pause notifications"}</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => pause(new Date(Date.now() + 30 * 60_000).toISOString())}>For 30 minutes</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => pause(new Date(Date.now() + 60 * 60_000).toISOString())}>For 1 hour</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => pause(tomorrowMorning())}>Until tomorrow</DropdownMenuItem>
          {paused ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => pause(null)}>Resume notifications</DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger className="nb-chat-icon" aria-label="Account">
          <ProfileAvatar profile={profile ?? null} size={32} />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="end">
          <DropdownMenuItem asChild><Link href="/my-profile">View profile</Link></DropdownMenuItem>
          <DropdownMenuItem asChild><Link href="/settings">Settings</Link></DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </nav>
  );
}
