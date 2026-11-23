const CELLS = [[-1, -1], [0, -1.3], [1, -1], [1.3, 0], [1, 1], [0, 1.3], [-1, 1], [-1.3, 0]] as const;

/** A one-time pixel moment around a tile (joining, first finish): eight squares step out and fade. Off with reduced motion. */
export function PixelBurst() {
  return (
    <span className="nb-pixel-burst" aria-hidden="true">
      {CELLS.map(([x, y], i) => <i key={i} style={{ ["--x" as string]: x, ["--y" as string]: y, ["--i" as string]: i }} />)}
    </span>
  );
}
