"use client"

import * as React from "react"
import * as AvatarPrimitive from "@radix-ui/react-avatar"

import {
  avatarVariantSizeForDisplay,
  publicAvatarVariantUrl,
  type PublicAvatarVariantSize,
} from "@/lib/profile/avatar-variants"
import { getPersonAvatarTone, PERSON_AVATAR_TONE_STYLES } from "@/lib/ui/avatar"
import { cn } from "@/lib/utils"

function Avatar({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Root>) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      className={cn(
        "relative flex size-[34px] shrink-0 overflow-hidden rounded-md",
        className
      )}
      {...props}
    />
  )
}

function AvatarImage({
  className,
  sourceSize = avatarVariantSizeForDisplay(64),
  src,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Image> & { sourceSize?: PublicAvatarVariantSize }) {
  return (
    <AvatarPrimitive.Image
      data-slot="avatar-image"
      className={cn("aspect-square size-full", className)}
      src={typeof src === "string" ? publicAvatarVariantUrl(src, sourceSize) : src}
      {...props}
    />
  )
}

function AvatarFallback({
  className,
  identityKey,
  style,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Fallback> & { identityKey?: string }) {
  const tone = getPersonAvatarTone(identityKey ?? (typeof props.children === "string" ? props.children : "User"))
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      data-avatar-tone={tone}
      style={{ ...PERSON_AVATAR_TONE_STYLES[tone], ...style }}
      className={cn(
        "bg-muted flex size-full items-center justify-center rounded-md",
        className
      )}
      {...props}
    />
  )
}

export { Avatar, AvatarImage, AvatarFallback }
