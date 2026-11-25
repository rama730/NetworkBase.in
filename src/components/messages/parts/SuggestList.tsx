"use client";

export type Suggestion = { id: string; label: string; hint?: string; icon?: React.ReactNode };

/**
 * A suggestion list above the composer (#channels, :emoji:): the spec popover (8px corners, md
 * shadow, 34px rows, 44px on touch). Keys stay in the editor (↑/↓, Tab/Enter, Esc), which points
 * at the active row with aria-activedescendant.
 */
export function SuggestList({ id, label, items, active, onPick, onHover }: {
  id: string;
  label: string;
  items: Suggestion[];
  active: number;
  onPick: (item: Suggestion) => void;
  onHover: (index: number) => void;
}) {
  if (!items.length) return null;
  return (
    <div className="nbm-popover absolute bottom-full left-0 z-30 mb-1 w-[min(20rem,calc(100vw-2rem))]">
      <p className="nbm-popover-head" aria-hidden="true"><span>{label}</span><span className="nbm-popover-keys">↑↓ move · ↵ pick · esc</span></p>
      <div id={id} role="listbox" aria-label={label}>
        {items.map((item, index) => (
          <div
            key={item.id}
            id={`${id}-${index}`}
            role="option"
            aria-selected={index === active}
            onMouseEnter={() => onHover(index)}
            onMouseDown={(event) => {
              event.preventDefault();
              onPick(item);
            }}
            className="nbm-popover-row"
          >
            {item.icon ? <span aria-hidden="true" className="nbm-popover-glyph">{item.icon}</span> : null}
            <span className="min-w-0 flex-1 truncate font-medium">{item.label}</span>
            {item.hint ? <span className="nbm-popover-hint">{item.hint}</span> : null}
          </div>
        ))}
      </div>
    </div>
  );
}
