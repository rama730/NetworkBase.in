'use client'

import { useRef } from 'react'
import { Heart, type IconProps } from '@/components/ui/icons'
import { cn } from '@/lib/utils'

/**
 * The like heart: an outline, or solid in the like colour (set by the parent's text colour).
 * Liking fills it row by row from the point up; a post that loads already liked just shows solid.
 */
export function LikeHeart({ liked, className, ...props }: IconProps & { liked: boolean }) {
    const loadedLiked = useRef(liked)
    if (!liked) loadedLiked.current = false
    return <Heart {...props} rise={liked && !loadedLiked.current} className={cn(liked && 'fill-current', className)} />
}
