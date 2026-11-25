import { rovingTabKey } from "@/components/messages/keys";

/** Three stepping squares: the only loader in Messages. A label makes it a status for screen readers. */
export function PixelBeat({ label, className = "" }: { label?: string; className?: string }) {
  return (
    <span className={`nbm-beat ${className}`} role={label ? "status" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <i /><i /><i />
    </span>
  );
}

/** Ten squares, one per 10 %. */
export function PixelProgress({ value, label, className = "" }: { value: number; label: string; className?: string }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <span className={`nbm-pxprog ${className}`} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={v}>
      {Array.from({ length: 10 }, (_, i) => <i key={i} data-on={v >= (i + 1) * 10 ? "" : undefined} />)}
    </span>
  );
}

/** Segmented radio cells (the mix): one Tab stop, ←/→ and ↑/↓ move the choice, like native radios. */
export function RadioCells<T extends string>({ label, value, options, onChange, className = "" }: {
  label: string; value: T; options: readonly (readonly [T, string])[]; onChange: (value: T) => void; className?: string;
}) {
  const index = Math.max(0, options.findIndex(([v]) => v === value));
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={`nbm-seg ${className}`}
      onKeyDown={(event) => {
        const key = event.key === "ArrowDown" ? "ArrowRight" : event.key === "ArrowUp" ? "ArrowLeft" : event.key;
        const next = rovingTabKey({ key, preventDefault: () => event.preventDefault() } as React.KeyboardEvent, index, options.length);
        if (next === null) return;
        onChange(options[next]![0]);
        (event.currentTarget.children[next] as HTMLElement | undefined)?.focus();
      }}
    >
      {options.map(([v, text]) => (
        <button key={v} type="button" role="radio" aria-checked={v === value} tabIndex={v === value ? 0 : -1} onClick={() => onChange(v)}>{text}</button>
      ))}
    </div>
  );
}
