type Box = { top: number; bottom: number; left: number; width: number };

/** Above the control and centred on it; below when there's no room above; 8 px inside the screen's sides. */
export function placeTip(target: Box, tip: { width: number; height: number }, viewport: { width: number }, gap = 8) {
  const above = target.top - tip.height - gap;
  const side = above < 8 ? "bottom" : "top";
  const top = side === "top" ? above : target.bottom + gap;
  const left = Math.min(Math.max(8, target.left + target.width / 2 - tip.width / 2), viewport.width - tip.width - 8);
  return { top, left, side } as const;
}

/** 500 ms for the first tooltip, then instant while one was just showing ("warm"); keyboard focus shows it at once. */
export const tipDelay = ({ warm, keyboard }: { warm: boolean; keyboard: boolean }) => (warm || keyboard ? 0 : 500);
