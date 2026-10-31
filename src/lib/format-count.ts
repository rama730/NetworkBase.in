// A fixed locale: the server and the browser must print the same text, or hydration breaks.
const STANDARD = new Intl.NumberFormat("en-US");
const COMPACT = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

export function formatCount(value: number): string {
  return (value >= 10_000 ? COMPACT : STANDARD).format(value);
}

export type ViewCountDisplay = { visible: boolean; text: string; exact: string };

/** How a view count reads. An unknown count is a dash, never a confident zero; only the team sees a zero. */
export function viewCountDisplay(count: number | null | undefined, isTeam: boolean): ViewCountDisplay {
  if (typeof count !== "number") return { visible: true, text: "—", exact: "Views unavailable" };
  if (count === 0) return { visible: isTeam, text: "0", exact: "0 views yet" };
  return { visible: true, text: formatCount(count), exact: `${STANDARD.format(count)} ${count === 1 ? "view" : "views"}` };
}
