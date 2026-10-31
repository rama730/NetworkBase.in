"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { readDownloadHistoryAction } from "@/app/actions/files/download-history";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Row = Extract<Awaited<ReturnType<typeof readDownloadHistoryAction>>, { success: true }>["rows"][number];
type Cursor = { createdAt: string; id: string } | null;

const KIND_LABEL: Record<string, string> = {
  file: "File",
  version: "Old version",
  folder_zip: "Folder zip",
  selection_zip: "Selected files zip",
  submissions_zip: "Submissions zip",
};

/** One history row. Exported so its text can be tested without a browser. */
export function DownloadHistoryRow({ row }: { row: Row }) {
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-3 py-2 text-sm">
      <span className="min-w-0 flex-1 truncate font-medium text-foreground" title={row.fileName}>{row.fileName}</span>
      <span className="text-xs text-muted-foreground">
        {row.actorId ? row.actorName ?? "Unknown person" : "Signed-out visitor or deleted account"}
        {" · "}{KIND_LABEL[row.kind] ?? row.kind}
        {row.kind.endsWith("_zip") ? ` · ${row.fileCount} ${row.fileCount === 1 ? "file" : "files"}` : ""}
        {" · "}{new Date(row.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
      </span>
    </li>
  );
}

/** Who downloaded what in this workspace, for the last 90 days. Downloads from messages are never listed. */
export function DownloadHistory({ projectId }: { projectId: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [cursor, setCursor] = useState<Cursor>(null);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [actorId, setActorId] = useState("");
  const [people, setPeople] = useState<Array<{ id: string; name: string | null }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (from: Cursor) => {
    setLoading(true);
    setError(null);
    const result = await readDownloadHistoryAction({ projectId, search: appliedSearch, personId: actorId || undefined, cursor: from })
      .catch(() => ({ success: false as const, error: "Couldn’t load download history" }));
    setLoading(false);
    if (!result.success) return setError(result.error);
    setRows((current) => (from ? [...current, ...result.rows] : result.rows));
    setCursor(result.nextCursor);
    if (result.people) setPeople(result.people);
  }, [actorId, appliedSearch, projectId]);

  useEffect(() => {
    void load(null);
  }, [load]);

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-medium text-foreground">Download history</h3>
        <p className="text-xs text-muted-foreground">Who downloaded files from this workspace in the last 90 days.</p>
      </div>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setAppliedSearch(search);
        }}
      >
        <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by file name" aria-label="Search by file name" className="min-w-0 flex-1" maxLength={200} />
        <select value={actorId} onChange={(event) => setActorId(event.target.value)} aria-label="Filter by person" className="h-[var(--ui-control-height)] rounded-md border border-border bg-background px-2 text-sm">
          <option value="">Everyone</option>
          {people.map((person) => <option key={person.id} value={person.id}>{person.name ?? "Unknown person"}</option>)}
        </select>
        <Button type="submit" variant="outline" size="sm">Search</Button>
      </form>
      {error ? <p role="alert" className="text-sm text-[var(--status-danger)]">{error}</p> : null}
      {!error && !loading && rows.length === 0 ? <p className="text-sm text-muted-foreground">No downloads found.</p> : null}
      {rows.length > 0 ? (
        <ul className="divide-y divide-border rounded-md border border-border">
          {rows.map((row) => <DownloadHistoryRow key={row.id} row={row} />)}
        </ul>
      ) : null}
      {loading ? <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Loading" /> : null}
      {cursor && !loading ? <Button type="button" variant="outline" size="sm" onClick={() => void load(cursor)}>Load more</Button> : null}
    </div>
  );
}
