/** Where the clay marker goes: under the open tab, in the list's own (scrolling) coordinates. */
export function markerBox(list: { left: number }, tab: { left: number; width: number }, scrollLeft: number) {
  return { left: tab.left - list.left + scrollLeft, width: tab.width };
}

/** Counts in tab bars and lane heads are two-digit mono, like the shell's counters: 3 → "03". */
export const padCount = (n: number) => String(n).padStart(2, "0");
