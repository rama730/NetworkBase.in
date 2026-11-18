import { PIXEL_ICONS, type PixelIconName } from '@/lib/pixel-icons'
import { cn } from '@/lib/utils'

/**
 * A pixel icon in the current text colour. 12px for rows and messages, 24px for a page's status mark: whole 2px or 4px
 * cells, so it stays crisp. Decorative: the words next to it say what it means.
 */
export function PixelIcon({ name, size = 12, className }: { name: PixelIconName; size?: 12 | 24; className?: string }) {
    return (
        <svg className={cn('nb-px', className)} width={size} height={size} viewBox="0 0 6 6" shapeRendering="crispEdges" aria-hidden="true">
            {PIXEL_ICONS[name].flatMap((row, y) => [...row].map((bit, x) => bit === '#'
                ? <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill="currentColor" style={{ ['--i' as string]: y * 6 + x }} />
                : null))}
        </svg>
    )
}

// Eight cells round a 3x3 square, clockwise from the top left: 4px cells with 1px gaps on whole pixels.
const SPIN_CELLS = [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2], [1, 2], [0, 2], [0, 1]] as const

/** The loading mark: a bright cell and a fading tail stepping round clockwise, like the cursor trail. Still under reduced motion. */
export function PixelSpinner({ className }: { className?: string }) {
    return (
        <svg className={cn('nb-px-spin', className)} width="14" height="14" viewBox="0 0 14 14" shapeRendering="crispEdges" aria-hidden="true">
            {SPIN_CELLS.map(([x, y], n) => <rect key={n} x={x * 5} y={y * 5} width="4" height="4" fill="currentColor" style={{ ['--n' as string]: n }} />)}
        </svg>
    )
}
