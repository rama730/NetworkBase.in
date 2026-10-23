"use client";
import { useEffect, useState } from "react";
import { EyeOff, FolderGit2, Pencil, Plus } from "lucide-react";
import { Card } from "./Card";
import type { ProfileCollaborationContribution } from "@/lib/profile/collaboration";
import { ContributionStoryView } from "@/components/profile/ContributionStoryView";

interface ProjectContributionsCardProps {
  contributions: ProfileCollaborationContribution[];
  isOwner: boolean;
  profileId?: string;
  onAdd?: () => void;
  projects?: Array<{ id?: string; title?: string; url?: string }>;
  onProjectIntent?: (href: string) => void;
}
export function ProjectContributionsCard({
  contributions,
  isOwner,
  profileId,
  onAdd,
  onProjectIntent,
}: ProjectContributionsCardProps) {
  const [live, setLive] = useState(contributions),
    [showAll, setShowAll] = useState(false);
  useEffect(() => setLive(contributions), [contributions]);
  useEffect(() => {
    if (!profileId) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const response = await fetch(
          `/api/v1/profiles/${encodeURIComponent(profileId)}/contributions?limit=50&stageLimit=20`,
          { cache: "no-store" },
        );
        if (!response.ok) {
          if (!cancelled && [403, 404].includes(response.status)) setLive([]);
          return;
        }
        const body = await response.json();
        if (!cancelled && body.data?.contributions)
          setLive(body.data.contributions);
      } catch {
        /* Keep the currently rendered story; no speculative content replacement. */
      }
    };
    const focus = () => {
      void refresh();
    };
    window.addEventListener("focus", focus);
    const timer = isOwner ? setInterval(() => void refresh(), 30000) : null;
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      window.removeEventListener("focus", focus);
    };
  }, [profileId, isOwner]);
  const visible = live
    .filter((c) => isOwner || c.visibility === "public")
    .sort((a, b) => {
      if (Number(b.featured) !== Number(a.featured)) {
        return Number(b.featured) - Number(a.featured);
      }
      const dateA = a.startDate || a.createdAt || "";
      const dateB = b.startDate || b.createdAt || "";
      if (dateA !== dateB) return dateB.localeCompare(dateA);
      const createdA = a.projectCreatedAt || a.createdAt || "";
      const createdB = b.projectCreatedAt || b.createdAt || "";
      if (createdA !== createdB) return createdB.localeCompare(createdA);
      return b.id.localeCompare(a.id);
    });
  if (!isOwner && !visible.length) return null;
  return (
    <Card
      title="Project contributions"
      onAdd={onAdd}
      addLabel="Add project contribution"
      action={
        isOwner && onAdd ? (
          <button
            type="button"
            aria-label="Edit project contributions"
            onClick={onAdd}
            className="nb-touch-target rounded-[3px] p-1.5 text-muted-foreground hover:bg-muted"
          >
            <Pencil className="size-4" />
          </button>
        ) : null
      }
    >
      <div className="px-5 max-md:px-4">
        {visible.length ? (
          <div className="divide-y divide-border">
            {visible.map((c, index) => (
              <div
                key={c.id + ":" + JSON.stringify(c.presentation)}
                className={!showAll && index >= 2 ? "max-md:hidden" : ""}
              >
                {isOwner && c.visibility === "private" && (
                  <p
                    className="nb-compact pt-4 text-muted-foreground"
                    title="Only you can see this contribution"
                  >
                    <EyeOff className="mr-1 inline size-3.5" />
                    Private · only you can see this contribution
                  </p>
                )}
                <ContributionStoryView
                  contribution={{ ...c, draftStory: null }}
                  onProjectIntent={onProjectIntent}
                />
              </div>
            ))}
            {!showAll && visible.length > 2 && (
              <button
                type="button"
                onClick={() => setShowAll(true)}
                className="nb-touch-target w-full py-3 nb-ui-label text-primary md:hidden"
              >
                Show all {visible.length}
              </button>
            )}
          </div>
        ) : (
          <div className="nb-empty-state nb-grid-ground py-8 text-center">
            <FolderGit2 className="nb-empty-state-icon mb-2" />
            <p className="nb-card-title">No project contributions</p>
            <p className="nb-compact mt-1 text-muted-foreground">
              {isOwner
                ? "Add your external projects or contribute to projects on NetworkBase."
                : "No public project contributions yet."}
            </p>
            {isOwner && onAdd && (
              <button
                type="button"
                onClick={onAdd}
                className="nb-touch-target mt-3 inline-flex items-center gap-1 nb-ui-label text-primary"
              >
                <Plus className="size-4" />
                Add contribution
              </button>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
