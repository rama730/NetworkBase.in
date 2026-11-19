"use client"

import * as React from "react"
import * as AvatarPrimitive from "@radix-ui/react-avatar"

import {
  avatarVariantSizeForDisplay,
  publicAvatarVariantUrl,
  type PublicAvatarVariantSize,
} from "@/lib/profile/avatar-variants"
import { PixelPerson } from "@/components/ui/PixelPerson"
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
  // A person (identityKey given) without a photo is drawn as their pixel person; anything else keeps its text.
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      data-avatar={identityKey ? "pixel" : undefined}
      style={style}
      className={cn(
        "bg-muted flex size-full items-center justify-center overflow-hidden rounded-md",
        className
      )}
      {...props}
    >
      {identityKey ? <PixelPerson identityKey={identityKey} className="size-full" /> : props.children}
    </AvatarPrimitive.Fallback>
  )
}

export { Avatar, AvatarImage, AvatarFallback }
