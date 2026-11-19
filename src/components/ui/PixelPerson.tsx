import { PIXEL_PERSON, pixelPersonLayout, pixelPersonPair } from '@/lib/ui/avatar'
import { cn } from '@/lib/utils'

const CELLS = PIXEL_PERSON.flatMap((row, y) => [...row].flatMap((bit, x) => (bit === '#' ? [[x, y] as const] : [])))
// Each row's runs of cells as [x, y, length]: one short path instead of 31 squares.
const RUNS = PIXEL_PERSON.flatMap((row, y) => [...row.matchAll(/#+/g)].map((run) => [run.index!, y, run[0].length] as const))

/**
 * Everyone's avatar until they add a photo: the home page band's pixel person on a square tile, in the colour pair their
 * id picks. Give `size` (px) and every cell lands on whole pixels; without it the tile scales to its box.
 * `tile={false}` draws the figure alone (the people row). `pop` lets the cells appear one by one (CSS, onboarding).
 */
export function PixelPerson({
    identityKey,
    size,
    tile = true,
    pop = false,
    className,
}: {
    identityKey: string
    size?: number
    tile?: boolean
    pop?: boolean
    className?: string
}) {
    const [figure, background] = pixelPersonPair(identityKey)
    const { box, cell, left, top } = tile ? pixelPersonLayout(size) : { box: 0, cell: 1, left: 0, top: 0 }
    const viewBox = tile ? `0 0 ${box} ${box}` : '0 0 7 8'
    return (
        <svg
            data-slot="pixel-person"
            className={cn('nb-pixel-person', pop && 'nb-pixel-pop', className)}
            viewBox={viewBox}
            shapeRendering="crispEdges"
            aria-hidden="true"
        >
            {tile ? <rect width={box} height={box} fill={background} /> : null}
            {pop ? (
                <g fill={figure}>
                    {CELLS.map(([x, y], i) => (
                        <rect key={i} x={left + x * cell} y={top + y * cell} width={cell} height={cell} style={{ ['--i' as string]: i }} />
                    ))}
                </g>
            ) : (
                <path fill={figure} d={RUNS.map(([x, y, n]) => `M${left + x * cell} ${top + y * cell}h${n * cell}v${cell}h-${n * cell}z`).join('')} />
            )}
        </svg>
    )
}
