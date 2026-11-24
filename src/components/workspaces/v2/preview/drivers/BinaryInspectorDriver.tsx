"use client";

import * as React from "react";
import {
  Binary,
  Download,
  ExternalLink,
  Copy,
  Check,
  FileCode,
  Info,
} from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import type { WorkspaceNode } from "@/lib/db/schema";
import { formatBytes } from "../../files-tab/folder/format";
import { toast } from "@/lib/feedback";
import { DownloadLink } from "@/components/ui/download-link";
import { copyText } from "@/lib/clipboard";

interface BinaryInspectorDriverProps {
  node: WorkspaceNode;
  fileUrl: string | null;
}

const MAX_BINARY_HEX_CACHE_ENTRIES = 10;
const binaryHexCache = new Map<string, string>();

function getCachedBinaryHex(url: string): string | null {
  const existing = binaryHexCache.get(url);
  if (existing === undefined) return null;
  binaryHexCache.delete(url);
  binaryHexCache.set(url, existing);
  return existing;
}

function setCachedBinaryHex(url: string, dump: string) {
  binaryHexCache.delete(url);
  while (binaryHexCache.size >= MAX_BINARY_HEX_CACHE_ENTRIES) {
    const oldestKey = binaryHexCache.keys().next().value;
    if (!oldestKey) break;
    binaryHexCache.delete(oldestKey);
  }
  binaryHexCache.set(url, dump);
}

export function BinaryInspectorDriver({
  node,
  fileUrl,
}: BinaryInspectorDriverProps): React.JSX.Element {
  const [hexDump, setHexDump] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!fileUrl) return;
    const targetUrl = fileUrl;
    let active = true;
    setLoading(true);

    async function fetchHex() {
      try {
        const cached = getCachedBinaryHex(targetUrl);
        if (cached !== null) {
          if (active) {
            setHexDump(cached);
            setLoading(false);
          }
          return;
        }
        // Fetch up to first 2KB for hex preview
        const res = await fetch(targetUrl, {
          headers: { Range: "bytes=0-2047" },
        });
        const buffer = await res.arrayBuffer();
        const bytes = new Uint8Array(buffer);

        let dump = "";
        for (let i = 0; i < bytes.length; i += 16) {
          const chunk = bytes.slice(i, i + 16);
          const offset = i.toString(16).padStart(8, "0");
          let hex = "";
          let ascii = "";

          for (let j = 0; j < 16; j++) {
            if (j === 8) hex += " ";
            if (j < chunk.length) {
              const b = chunk[j]!;
              hex += b.toString(16).padStart(2, "0") + " ";
              ascii += b >= 32 && b <= 126 ? String.fromCharCode(b) : ".";
            } else {
              hex += "   ";
            }
          }

          dump += `${offset}  ${hex} |${ascii}|\n`;
        }

        setCachedBinaryHex(targetUrl, dump);
        if (active) {
          setHexDump(dump);
          setLoading(false);
        }
      } catch {
        if (active) setLoading(false);
      }
    }

    fetchHex();

    return () => {
      active = false;
    };
  }, [fileUrl]);

  const copyHex = React.useCallback(async () => {
    if (!hexDump) return;
    try {
      await copyText(hexDump);
      setCopied(true);
      toast.success("Hex dump copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn’t copy the hex dump");
    }
  }, [hexDump]);

  return (
    <div className="flex h-full w-full flex-col bg-background">
      {/* Top Details Bar */}
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="flex items-center gap-2">
          <Binary className="h-4 w-4 text-primary" />
          <span className="text-xs font-semibold text-foreground">{node.name}</span>
          <span className="text-[11px] text-muted-foreground">
            ({formatBytes(node.size)} · {node.mimeType || "application/octet-stream"})
          </span>
        </div>

        <div className="flex items-center gap-2">
          {hexDump && (
            <Button
              size="sm"
              variant="ghost"
              onClick={copyHex}
              className="h-7 px-2 text-xs"
            >
              {copied ? (
                <Check className="mr-1 h-3.5 w-3.5 text-emerald-500" />
              ) : (
                <Copy className="mr-1 h-3.5 w-3.5" />
              )}
              {copied ? "Copied" : "Copy hex"}
            </Button>
          )}

          {fileUrl && (
            <Button asChild size="sm" variant="outline" className="h-7 px-2 text-xs">
              <DownloadLink href={fileUrl} filename={node.name}>
                <Download className="mr-1 h-3.5 w-3.5" />
                Download
              </DownloadLink>
            </Button>
          )}
        </div>
      </div>

      {/* Main Body */}
      <div className="flex-1 overflow-auto p-4">
        {hexDump ? (
          <div className="rounded-lg border border-border bg-muted/20 p-4 font-mono text-xs leading-relaxed text-foreground select-text overflow-x-auto">
            <div className="mb-2 text-[11px] font-sans font-medium text-muted-foreground">
              Initial 2 KB Hex Representation:
            </div>
            <pre className="whitespace-pre">{hexDump}</pre>
          </div>
        ) : (
          <div className="flex h-64 flex-col items-center justify-center gap-3 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
              <Binary className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-sm font-semibold text-foreground">{node.name}</p>
            <p className="max-w-md text-xs text-muted-foreground">
              This binary file cannot be rendered inline. You can download it or open it in an external application.
            </p>
            {fileUrl && (
              <Button asChild size="sm" variant="default" className="mt-2">
                <DownloadLink href={fileUrl} filename={node.name}>
                  <Download className="mr-1.5 h-4 w-4" />
                  Download file
                </DownloadLink>
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
