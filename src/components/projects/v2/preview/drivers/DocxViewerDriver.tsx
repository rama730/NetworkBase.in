"use client";

import * as React from "react";
import { FileText, Download, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ProjectNode } from "@/lib/db/schema";
import { formatBytes } from "../../files-tab/folder/format";

interface DocxViewerDriverProps {
  node: ProjectNode;
  signedUrl: string;
}

export function DocxViewerDriver({
  node,
  signedUrl,
}: DocxViewerDriverProps): React.JSX.Element {
  return (
    <div className="flex h-full w-full items-center justify-center bg-muted/10 p-6">
      <div className="flex max-w-md flex-col items-center rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
        {/* Document Icon */}
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-500/10 text-blue-600 ring-1 ring-blue-500/20 dark:bg-blue-500/20 dark:text-blue-400">
          <FileText className="h-8 w-8" />
        </div>

        {/* Title & Metadata */}
        <h3 className="max-w-sm truncate text-base font-semibold text-card-foreground" title={node.name}>
          {node.name}
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Word Document • {formatBytes(node.size)}
        </p>

        {/* Description */}
        <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
          Word documents can be viewed or edited with Microsoft Word, LibreOffice, or Google Docs. Download the file to view its complete formatting and contents.
        </p>

        {/* Action Buttons */}
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
          <Button asChild size="sm" className="h-9 px-4 text-xs font-medium">
            <a href={signedUrl} download={node.name}>
              <Download className="mr-1.5 h-3.5 w-3.5" />
              Download Document
            </a>
          </Button>

          <Button asChild variant="outline" size="sm" className="h-9 px-4 text-xs">
            <a href={signedUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
              Open in New Tab
            </a>
          </Button>
        </div>
      </div>
    </div>
  );
}
