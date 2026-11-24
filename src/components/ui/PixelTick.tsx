import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';

// The app's square pixel tick (mix pages). With `draw`, it draws left to right, one pixel every 45 ms, when it mounts.
const PIXELS = [[0, 2], [1, 3], [2, 4], [3, 3], [4, 2], [5, 1]] as const;

export function PixelTick({ className, draw = false }: { className?: string; draw?: boolean }) {
    return (
        <span className={cn('nb-pxtick', className)} data-draw={draw ? 'true' : undefined} aria-hidden="true">
            <svg viewBox="0 0 6 6" shapeRendering="crispEdges" fill="currentColor">
                {PIXELS.map(([x, y], i) => <rect key={i} x={x} y={y} width="1" height="1" style={{ '--d': i } as CSSProperties} />)}
            </svg>
        </span>
    );
}
