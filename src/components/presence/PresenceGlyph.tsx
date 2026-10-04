export type GlyphKind = "person" | "at" | "group";

/**
 * Node person and @mention icons: drawn for NetworkBase on a 20-unit grid, one
 * stroke weight, round joins, `currentColor`. (Statuses use plain emoji.)
 */
export function PresenceGlyph({ kind, className, strokeWidth = 1.75 }: { kind: GlyphKind; className?: string; strokeWidth?: number }) {
  return (
    <svg viewBox="0 0 20 20" className={className} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {GLYPHS[kind]}
    </svg>
  );
}

const GLYPHS: Record<GlyphKind, React.ReactNode> = {
  person: (
    <>
      <rect x="6.6" y="2.9" width="6.8" height="6.8" rx="2.3" />
      <path d="M3.4 17.2a6.6 6.6 0 0 1 13.2 0" />
    </>
  ),
  at: (
    <>
      <rect x="7" y="7" width="6" height="6" rx="2" />
      <path d="M13 10v1.6a2.2 2.2 0 0 0 4.4 0V10A7.4 7.4 0 1 0 14.6 15.8" />
    </>
  ),
  group: (
    <>
      <rect x="3.4" y="4.2" width="5.2" height="5.2" rx="1.8" />
      <rect x="11.4" y="4.2" width="5.2" height="5.2" rx="1.8" />
      <path d="M1.8 16.4a4.2 4.2 0 0 1 8.4 0M9.8 16.4a4.2 4.2 0 0 1 8.4 0" />
    </>
  ),
};
