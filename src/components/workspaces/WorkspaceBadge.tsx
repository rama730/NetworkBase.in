"use client";

import Image from "next/image";
import { useState } from "react";
import { getProjectAvatarUrl } from "@/components/workspaces/WorkspaceAvatar";
import { cn } from "@/lib/utils";

export interface ProjectBadgeProps {
  project?: {
    title?: string | null;
    coverImage?: string | null;
    cover_image?: string | null;
    coverImageUrl?: string | null;
    cover_image_url?: string | null;
  } | null;
  title?: string;
  coverImage?: string | null;
  size?: "xs" | "sm" | "md";
  className?: string;
}

/**
 * Standard project icon according to NetworkBase specifications:
 * - If a project image/avatar exists: render the image thumbnail.
 * - If absent: render the single uppercase initial (e.g. "C" for Caveman).
 */
export function ProjectBadge({
  project,
  title: explicitTitle,
  coverImage: explicitCoverImage,
  size = "sm",
  className,
}: ProjectBadgeProps) {
  const title = (explicitTitle || project?.title || "").trim();
  const avatarUrl = explicitCoverImage ?? (project ? getProjectAvatarUrl(project as any) : null);
  const [hasError, setHasError] = useState(false);

  // Single uppercase letter fallback
  const initial = title ? title.charAt(0).toUpperCase() : "P";

  const sizeClasses = {
    xs: "size-[18px] text-[10px] rounded-[3px]",
    sm: "size-5 text-[10px] rounded-[4px]",
    md: "size-6 text-xs rounded-[5px]",
  }[size];

  if (avatarUrl && !hasError) {
    return (
      <span
        aria-hidden="true"
        className={cn(
          "relative flex-none overflow-hidden bg-muted/60 ring-1 ring-inset ring-black/10 dark:ring-white/10",
          sizeClasses,
          className,
        )}
      >
        <Image
          src={avatarUrl}
          alt=""
          fill
          sizes={size === "md" ? "24px" : "20px"}
          className="object-cover"
          onError={() => setHasError(true)}
          unoptimized
        />
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid flex-none place-items-center bg-secondary font-mono font-semibold text-foreground border border-border/40 select-none",
        sizeClasses,
        className,
      )}
    >
      {initial}
    </span>
  );
}
