import { PIXEL_INK_TILE, PIXEL_PERSON, PIXEL_PLACES, pixelPersonLayout, pixelPersonPair, type PixelPlaceKind } from '@/lib/ui/avatar'
import { cn } from '@/lib/utils'

type Bitmap = readonly string[]
const cellsOf = (bitmap: Bitmap) => bitmap.flatMap((row, y) => [...row].flatMap((bit, x) => (bit === '#' ? [[x, y] as const] : [])))
// Each row's runs of cells as [x, y, length]: one short path instead of 30-odd squares.
const runsOf = (bitmap: Bitmap) => bitmap.flatMap((row, y) => [...row.matchAll(/#+/g)].map((run) => [run.index!, y, run[0].length] as const))
const PERSON = { cells: cellsOf(PIXEL_PERSON), runs: runsOf(PIXEL_PERSON) }
const PLACES = Object.fromEntries(Object.entries(PIXEL_PLACES).map(([kind, bitmap]) => [kind, { cells: cellsOf(bitmap), runs: runsOf(bitmap) }])) as Record<PixelPlaceKind, typeof PERSON>

/**
 * A pixel figure on a square tile, in the colour pair `identityKey` picks. Give `size` (px) and every cell lands on whole
 * pixels; without it the tile scales to its box. `tile={false}` draws the figure alone. `pop` lets the cells appear one by
 * one (CSS). A tile on the ink colour gets a 1px inner edge in dark mode (`--nb-tile-edge`).
 */
function PixelFigure({ figure, identityKey, size, tile = true, pop = false, className, slot }: {
    figure: typeof PERSON
    identityKey: string
    size?: number
    tile?: boolean
    pop?: boolean
    className?: string
    slot: string
}) {
    const [ink, background] = pixelPersonPair(identityKey)
    const { box, cell, left, top } = tile ? pixelPersonLayout(size) : { box: 0, cell: 1, left: 0, top: 0 }
    return (
        <svg
            data-slot={slot}
            className={cn('nb-pixel-person', pop && 'nb-pixel-pop', className)}
            viewBox={tile ? `0 0 ${box} ${box}` : '0 0 7 8'}
            shapeRendering="crispEdges"
            aria-hidden="true"
        >
            {tile ? <rect width={box} height={box} fill={background} /> : null}
            {pop ? (
                <g fill={ink}>
                    {figure.cells.map(([x, y], i) => (
                        <rect key={i} x={left + x * cell} y={top + y * cell} width={cell} height={cell} style={{ ['--i' as string]: i }} />
                    ))}
                </g>
            ) : (
                <path fill={ink} d={figure.runs.map(([x, y, n]) => `M${left + x * cell} ${top + y * cell}h${n * cell}v${cell}h-${n * cell}z`).join('')} />
            )}
            {tile && background === PIXEL_INK_TILE ? (
                <rect x={0.5} y={0.5} width={box - 1} height={box - 1} fill="none" strokeWidth={1} className="nb-pixel-edge" />
            ) : null}
        </svg>
    )
}

/** Everyone's avatar until they add a photo: the home page band's pixel person, in the colour pair their id picks. */
export function PixelPerson(props: { identityKey: string; size?: number; tile?: boolean; pop?: boolean; className?: string }) {
    return <PixelFigure {...props} figure={PERSON} slot="pixel-person" />
}

/**
 * A workspace or organization without a picture: a building (organization), a desk (workspace), or the desk under its
 * org's roof (child workspace). Pass the org's id as `identityKey` for a child, so it wears its org's colours.
 */
export function PixelPlace({ kind, ...props }: { kind: PixelPlaceKind; identityKey: string; size?: number; tile?: boolean; className?: string }) {
    return <PixelFigure {...props} figure={PLACES[kind]} slot="pixel-place" />
}
