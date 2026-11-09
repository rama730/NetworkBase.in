// Where you were on each page (unified back §3.1, A4, R10, R11). Pages scroll inside their own
// `data-scroll-root="route"` box, so the browser can't restore it; this keeps, per history entry,
// the box's position, the cards at the top of the screen, the card you opened, and any named inner
// areas. Restoring anchors on the card, not the pixel, so lazy lists and late images land right.

export type ScrollRecord = {
  top: number;
  /** The first visible card's id and the next four, in case some were deleted meanwhile. */
  anchors: string[];
  /** The first anchor's top edge relative to the box's top, in px. */
  anchorOffset: number;
  /** The card you opened from here (focus and a soft tint on return). */
  opened: string | null;
  /** That card's top edge relative to the box's top, in px: it is the card held in place on return. */
  openedOffset?: number | null;
  areas: Record<string, { top: number; left: number }>;
};

export type StorageLike = { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void };

const PREFIX = "nb-scroll:";
const INDEX = "nb-scroll:index";
const CAP = 50;

function readIndex(store: StorageLike): string[] {
  const raw = store.getItem(INDEX);
  const parsed = raw ? (JSON.parse(raw) as unknown) : [];
  return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
}

/** Keep this entry's record; the oldest beyond 50 are dropped. Blocked storage is a no-op. */
export function saveRecord(store: StorageLike, entryId: string, record: ScrollRecord) {
  try {
    const index = readIndex(store).filter((id) => id !== entryId);
    index.push(entryId);
    while (index.length > CAP) store.removeItem(`${PREFIX}${index.shift()}`);
    store.setItem(`${PREFIX}${entryId}`, JSON.stringify(record));
    store.setItem(INDEX, JSON.stringify(index));
  } catch {
    // Storage blocked or full: back starts at the top.
  }
}

export function loadRecord(store: StorageLike, entryId: string): ScrollRecord | null {
  try {
    const raw = store.getItem(`${PREFIX}${entryId}`);
    return raw ? (JSON.parse(raw) as ScrollRecord) : null;
  } catch {
    return null;
  }
}

/** Tops/bottoms are relative to the scroll box's top edge. */
export function chooseAnchors(items: { id: string; top: number; bottom: number }[], viewportTop: number) {
  const first = items.findIndex((item) => item.bottom > viewportTop);
  if (first < 0) return { anchors: [] as string[], anchorOffset: 0 };
  return { anchors: items.slice(first, first + 5).map((item) => item.id), anchorOffset: (items[first]?.top ?? viewportTop) - viewportTop };
}

/** The first remembered card that still exists. */
export function pickAnchor(anchors: string[], exists: (id: string) => boolean): string | null {
  return anchors.find(exists) ?? null;
}
