"use client";

import * as React from "react";
import {
  Archive,
  File,
  Folder,
  Download,
  Search,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ProjectNode } from "@/lib/db/schema";
import { formatBytes } from "../../files-tab/folder/format";
import * as fflate from "fflate";

interface ArchiveEntry {
  path: string;
  name: string;
  size: number;
  compressedSize: number;
  isDir: boolean;
}

interface ArchiveViewerDriverProps {
  node: ProjectNode;
  signedUrl: string;
}

export function ArchiveViewerDriver({
  node,
  signedUrl,
}: ArchiveViewerDriverProps): React.JSX.Element {
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [entries, setEntries] = React.useState<ArchiveEntry[]>([]);
  const [searchQuery, setSearchQuery] = React.useState("");

  React.useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    async function loadArchive() {
      try {
        const res = await fetch(signedUrl);
        if (!res.ok) throw new Error("Couldn’t download archive");
        const buffer = await res.arrayBuffer();

        const parsedEntries: ArchiveEntry[] = [];
        const unzipper = new fflate.Unzip((stream) => {
          const filePath = stream.name;
          const isDir = filePath.endsWith("/");
          const parts = filePath.replace(/\/$/, "").split("/");
          const name = parts[parts.length - 1] || filePath;
          const uncompressedSize =
            typeof stream.originalSize === "number" ? stream.originalSize : (stream.size || 0);
          const compressedSize =
            typeof stream.size === "number" ? stream.size : uncompressedSize;

          parsedEntries.push({
            path: filePath,
            name,
            size: uncompressedSize,
            compressedSize,
            isDir,
          });
        });

        unzipper.push(new Uint8Array(buffer), true);

        // Sort folders first, then alphabetically
        parsedEntries.sort((a, b) => {
          if (a.isDir && !b.isDir) return -1;
          if (!a.isDir && b.isDir) return 1;
          return a.path.localeCompare(b.path);
        });

        if (active) {
          setEntries(parsedEntries);
          setLoading(false);
        }
      } catch (err: any) {
        if (active) {
          setError(err?.message || "Couldn’t inspect archive contents");
          setLoading(false);
        }
      }
    }

    loadArchive();

    return () => {
      active = false;
    };
  }, [signedUrl]);

  const filteredEntries = React.useMemo(() => {
    if (!searchQuery.trim()) return entries;
    const q = searchQuery.toLowerCase();
    return entries.filter((e) => e.path.toLowerCase().includes(q));
  }, [entries, searchQuery]);

  const totalUncompressed = React.useMemo(
    () => entries.reduce((acc, e) => acc + e.size, 0),
    [entries],
  );

  return (
    <div className="flex h-full w-full flex-col bg-background">
      {/* Top Toolbar */}
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Archive className="h-4 w-4 text-amber-500" />
            <span className="text-xs font-semibold text-foreground">{node.name}</span>
          </div>

          <div className="relative w-48 sm:w-64">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search archive files…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-7 pl-8 text-xs"
            />
          </div>

          <span className="text-[11px] text-muted-foreground">
            {entries.length} items · Total {formatBytes(totalUncompressed)}
          </span>
        </div>

        <Button asChild size="sm" variant="outline" className="h-7 px-2 text-xs">
          <a href={signedUrl} download={node.name}>
            <Download className="mr-1 h-3.5 w-3.5" />
            Download ZIP
          </a>
        </Button>
      </div>

      {/* Main Body */}
      <div className="flex-1 overflow-auto p-4">
        {loading ? (
          <div className="flex h-64 flex-col items-center justify-center gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-xs text-muted-foreground">Reading archive directory tree…</p>
          </div>
        ) : error ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
            <AlertTriangle className="h-8 w-8 text-amber-500" />
            <p className="text-sm font-semibold">Archive preview unavailable</p>
            <p className="text-xs text-muted-foreground">{error}</p>
            <Button asChild size="sm" variant="default" className="mt-2">
              <a href={signedUrl} download={node.name}>
                <Download className="mr-1.5 h-4 w-4" />
                Download archive
              </a>
            </Button>
          </div>
        ) : filteredEntries.length === 0 ? (
          <div className="flex h-48 items-center justify-center text-xs text-muted-foreground">
            No files matched your search
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-card">
            <div className="grid grid-cols-[1fr_120px] border-b border-border bg-muted/50 p-2 text-[11px] font-semibold text-muted-foreground">
              <span>File Name / Path</span>
              <span className="text-right">Size</span>
            </div>
            <div className="divide-y divide-border">
              {filteredEntries.map((entry) => (
                <div
                  key={entry.path}
                  className="grid grid-cols-[1fr_120px] items-center p-2 text-xs hover:bg-muted/40 transition-colors"
                >
                  <div className="flex items-center gap-2 truncate">
                    {entry.isDir ? (
                      <Folder className="h-4 w-4 shrink-0 text-amber-500" />
                    ) : (
                      <File className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="truncate font-mono text-[11px] text-foreground">
                      {entry.path}
                    </span>
                  </div>
                  <span className="text-right font-mono text-[11px] text-muted-foreground">
                    {entry.isDir ? "Folder" : formatBytes(entry.size)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
