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
    <div className="absolute bottom-full left-0 z-30 mb-1 w-[min(20rem,calc(100vw-2rem))] rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md">
      <p className="nb-micro px-2 py-1" aria-hidden="true">{label}</p>
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
            className={`flex min-h-[34px] cursor-pointer items-center gap-2 rounded-md px-2 text-[13px] pointer-coarse:min-h-11 ${index === active ? "bg-accent text-accent-foreground" : "hover:bg-muted"}`}
          >
            {item.icon ? <span aria-hidden="true" className="grid w-5 place-items-center text-[17px] leading-none">{item.icon}</span> : null}
            <span className="min-w-0 flex-1 truncate font-medium">{item.label}</span>
            {item.hint ? <span className="nb-meta truncate">{item.hint}</span> : null}
          </div>
        ))}
      </div>
    </div>
  );
}
