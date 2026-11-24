'use client'

import { useRef, type SVGProps } from 'react'
import { cn } from '@/lib/utils'

// The like heart is the app's one pixel icon: 7x7 cells at 2px, so it stays crisp at 14px and 16px.
const OUTLINE = 'M2 2h4v2h-4zM8 2h4v2h-4zM0 4h2v2h-2zM6 4h2v2h-2zM12 4h2v2h-2zM0 6h2v2h-2zM12 6h2v2h-2zM2 8h2v2h-2zM10 8h2v2h-2zM4 10h2v2h-2zM8 10h2v2h-2zM6 12h2v2h-2z'
const INSIDE = 'M2 4h4v2h-4zM8 4h4v2h-4zM2 6h10v2h-10zM4 8h6v2h-6zM6 10h2v2h-2z'

/**
 * Outline when not liked; solid in the like colour (the parent's text colour) when liked.
 * Liking fills the inside row by row from the point up; a post that loads already liked just shows solid.
 */
export function LikeHeart({ liked, size = 14, className, ...props }: Omit<SVGProps<SVGSVGElement>, 'ref'> & { liked: boolean; size?: 14 | 16 }) {
    const loadedLiked = useRef(liked)
    if (!liked) loadedLiked.current = false
    const pad = (size - 14) / 2
    return (
        <svg width={size} height={size} viewBox={`${-pad} ${-pad} ${size} ${size}`} fill="currentColor" shapeRendering="crispEdges" aria-hidden="true" {...props} className={cn('nb-like-heart', liked && !loadedLiked.current && 'is-rising', className)}>
            {liked ? <path className="nb-like-heart-in" d={INSIDE} /> : null}
            <path d={OUTLINE} />
        </svg>
    )
}
