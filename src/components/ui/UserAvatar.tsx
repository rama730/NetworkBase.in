"use client";

import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import Image from "next/image";

import { avatarVariantSizeForDisplay, publicAvatarVariantUrl } from "@/lib/profile/avatar-variants";
import { buildIdentityPresentation, type IdentityRecord } from "@/lib/ui/identity";
import { cn } from "@/lib/utils";
import { PresenceGlyph } from "@/components/presence/PresenceGlyph";
import { PixelPerson } from "@/components/ui/PixelPerson";

export type UserAvatarProps = {
  identity: IdentityRecord;
  size?: number;
  className?: string;
  style?: CSSProperties;
  roundedClassName?: string;
  imageClassName?: string;
  fallbackClassName?: string;
  priority?: boolean;
  unoptimized?: boolean;
  title?: string;
  sizes?: string;
  fallbackDisplayName?: string;
  fallbackInitials?: string;
};

export function UserAvatar({
  identity,
  size,
  className,
  style,
  roundedClassName = "rounded-md",
  imageClassName,
  fallbackClassName,
  priority = false,
  unoptimized = false,
  title,
  sizes,
  fallbackDisplayName,
  fallbackInitials,
}: UserAvatarProps) {
  const presentation = buildIdentityPresentation(identity, { fallbackDisplayName, fallbackInitials });
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [presentation.avatarUrl]);

  const shouldRenderImage = Boolean(presentation.avatarUrl) && !imageFailed;
  // No photo: the pixel person, coloured by the id, so the same person looks the same everywhere.
  const identityKey = presentation.id ?? presentation.username ?? presentation.displayName;
  const avatarUrl = presentation.avatarUrl && unoptimized
    ? publicAvatarVariantUrl(presentation.avatarUrl, avatarVariantSizeForDisplay(size))
    : presentation.avatarUrl;

  return (
    <div
      data-slot="user-avatar"
      title={title ?? presentation.displayName}
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden",
        roundedClassName,
        className,
      )}
      style={size ? { width: size, height: size, ...style } : style}
    >
      {shouldRenderImage ? (
        <Image
          src={avatarUrl as string}
          alt={presentation.alt}
          fill
          unoptimized={unoptimized}
          sizes={sizes ?? (size ? `${size}px` : "40px")}
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : "auto"}
          className={cn("object-cover", roundedClassName, imageClassName)}
          onError={() => setImageFailed(true)}
        />
      ) : null}

      {!shouldRenderImage ? (
        <div
          data-avatar="pixel"
          className={cn(
            "absolute inset-0 flex items-center justify-center overflow-hidden bg-secondary text-foreground",
            roundedClassName,
            fallbackClassName,
          )}
        >
          {presentation.anonymous ? <PresenceGlyph kind="person" className="size-[58%]" /> : <PixelPerson identityKey={identityKey} size={size} className="size-full" />}
        </div>
      ) : null}
    </div>
  );
}
