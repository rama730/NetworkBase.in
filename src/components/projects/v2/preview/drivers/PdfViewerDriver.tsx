"use client";

import * as React from "react";
import {
  ExternalLink,
  Download,
  AlertTriangle,
  FileText,
  Maximize2,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ProjectNode } from "@/lib/db/schema";
import { formatBytes } from "../../files-tab/folder/format";

interface PdfViewerDriverProps {
  node: ProjectNode;
  signedUrl: string | null;
  projectId: string;
}

export function PdfViewerDriver({
  node,
  signedUrl,
  projectId,
}: PdfViewerDriverProps): React.JSX.Element {
  const [loadError, setLoadError] = React.useState(false);
  const [isRetrying, setIsRetrying] = React.useState(false);

  // Use the inline streaming preview route which sets inline disposition and byte range headers
  const previewUrl = React.useMemo(() => {
    const pId = encodeURIComponent(node.projectId || projectId);
    const nId = encodeURIComponent(node.id);
    const ver = encodeURIComponent(String(node.currentVersion ?? 1));
    return `/api/v1/projects/${pId}/files/${nId}/preview?v=${ver}`;
  }, [node.projectId, projectId, node.id, node.currentVersion]);

  const downloadUrl = React.useMemo(() => {
    return `${previewUrl}&download=1`;
  }, [previewUrl]);

  const handleRetry = React.useCallback(() => {
    setIsRetrying(true);
    setLoadError(false);
    setTimeout(() => setIsRetrying(false), 500);
  }, []);

  return (
    <div className="relative flex h-full w-full flex-col bg-muted/10">
      {/* Top Controls Bar */}
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-border bg-background px-4">
        <div className="flex items-center gap-2 overflow-hidden">
          <FileText className="h-4 w-4 shrink-0 text-red-500" />
          <span className="truncate text-xs font-medium text-foreground">
            {node.name}
          </span>
          <span className="text-[11px] text-muted-foreground">
            ({formatBytes(node.size)})
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            onClick={handleRetry}
            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
            title="Reload PDF"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRetrying ? "animate-spin" : ""}`} />
          </Button>

          <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-xs">
            <a href={downloadUrl} download={node.name} title="Download PDF">
              <Download className="mr-1 h-3.5 w-3.5" />
              Download
            </a>
          </Button>

          <Button asChild size="sm" variant="outline" className="h-7 px-2 text-xs">
            <a href={signedUrl || previewUrl} target="_blank" rel="noreferrer" title="Open full PDF viewer">
              <ExternalLink className="mr-1 h-3.5 w-3.5" />
              Open in tab
            </a>
          </Button>
        </div>
      </div>

      {/* Embedded PDF Viewer */}
      <div className="relative flex-1 overflow-hidden bg-zinc-100 dark:bg-zinc-900">
        {loadError ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
            <AlertTriangle className="h-8 w-8 text-amber-500" />
            <p className="text-sm font-medium text-foreground">
              Browser blocked inline PDF rendering
            </p>
            <p className="max-w-md text-xs text-muted-foreground">
              Some browser privacy settings prevent embedded PDF rendering. You can open the PDF in a new tab or download it directly.
            </p>
            <div className="flex items-center gap-2 pt-2">
              <Button asChild size="sm" variant="default">
                <a href={signedUrl || previewUrl} target="_blank" rel="noreferrer">
                  <ExternalLink className="mr-1.5 h-4 w-4" />
                  Open in new tab
                </a>
              </Button>
              <Button asChild size="sm" variant="outline">
                <a href={downloadUrl} download={node.name}>
                  <Download className="mr-1.5 h-4 w-4" />
                  Download
                </a>
              </Button>
            </div>
          </div>
        ) : (
          <object
            data={previewUrl}
            type="application/pdf"
            className="h-full w-full border-0"
            onError={() => setLoadError(true)}
          >
            {/* Fallback iframe for Safari WebKit */}
            <iframe
              title={node.name}
              src={previewUrl}
              className="h-full w-full border-0"
              onError={() => setLoadError(true)}
            >
              <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
                <FileText className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm font-medium">Inline preview not supported by this browser</p>
                <Button asChild size="sm" variant="outline">
                  <a href={signedUrl || previewUrl} target="_blank" rel="noreferrer">
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Open PDF
                  </a>
                </Button>
              </div>
            </iframe>
          </object>
        )}
      </div>
    </div>
  );
}
