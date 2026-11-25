// One sound at a time across the page: a player that starts claims the sound, and the one before pauses.
type Pausable = { pause: () => void };
let current: Pausable | null = null;

export function claimSound(player: Pausable) {
  if (current && current !== player) current.pause();
  current = player;
}

/** The audio speed cell: 1 → 1.5 → 2 → 0.75 → 1. */
export function nextSpeed(speed: number) {
  const order = [1, 1.5, 2, 0.75];
  const index = order.indexOf(speed);
  return index === -1 ? 1 : order[(index + 1) % order.length]!;
}
