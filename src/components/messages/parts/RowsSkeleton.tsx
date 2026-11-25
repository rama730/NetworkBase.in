/** A list loading (pins, files, members): square soft blocks that breathe (the mix), avatar-and-lines rows. */
export function RowsSkeleton({ label, rows = 3 }: { label: string; rows?: number }) {
  return (
    <div role="status" className="space-y-4 p-4">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="flex gap-3">
          <span aria-hidden="true" className="nbm-sk size-[34px] flex-none" />
          <div className="flex-1 space-y-2 pt-1">
            <span aria-hidden="true" className="nbm-sk h-[9px] w-32" />
            <span aria-hidden="true" className="nbm-sk h-[9px] w-3/4" />
          </div>
        </div>
      ))}
    </div>
  );
}
