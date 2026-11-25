// The mix player remembers volume and speed per device; a blocked storage just means defaults.
export const PLAYER_SPEEDS = [0.75, 1, 1.25, 1.5, 2] as const;
type Storage = { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void };
const KEY = "nb-player";

export function readPlayerPrefs(storage: Storage | null | undefined): { volume: number; speed: number } {
  try {
    const raw = JSON.parse(storage?.getItem(KEY) ?? "{}") as { volume?: unknown; speed?: unknown };
    const volume = typeof raw.volume === "number" && raw.volume >= 0 && raw.volume <= 1 ? raw.volume : 1;
    const speed = (PLAYER_SPEEDS as readonly number[]).includes(raw.speed as number) ? (raw.speed as number) : 1;
    return { volume, speed };
  } catch {
    return { volume: 1, speed: 1 };
  }
}

export function writePlayerPrefs(storage: Storage | null | undefined, prefs: { volume: number; speed: number }) {
  try {
    storage?.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Storage blocked: the prefs last until reload.
  }
}
