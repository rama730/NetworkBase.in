"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import type { WorkspaceNode } from "@/lib/db/schema";
import { resolvePreviewType, type UniversalPreviewType } from "../utils/fileKind";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { logger } from "@/lib/logger";

const ImageViewerDriver = dynamic(
  () => import("./drivers/ImageViewerDriver").then((m) => m.ImageViewerDriver),
  { ssr: false, loading: () => <PreviewSkeleton /> },
);

const PdfViewerDriver = dynamic(
  () => import("./drivers/PdfViewerDriver").then((m) => m.PdfViewerDriver),
  { ssr: false, loading: () => <PreviewSkeleton /> },
);

const DocxViewerDriver = dynamic(
  () => import("./drivers/DocxViewerDriver").then((m) => m.DocxViewerDriver),
  { ssr: false, loading: () => <PreviewSkeleton /> },
);

const SheetViewerDriver = dynamic(
  () => import("./drivers/SheetViewerDriver").then((m) => m.SheetViewerDriver),
  { ssr: false, loading: () => <PreviewSkeleton /> },
);

const MediaViewerDriver = dynamic(
  () => import("./drivers/MediaViewerDriver").then((m) => m.MediaViewerDriver),
  { ssr: false, loading: () => <PreviewSkeleton /> },
);

const ArchiveViewerDriver = dynamic(
  () => import("./drivers/ArchiveViewerDriver").then((m) => m.ArchiveViewerDriver),
  { ssr: false, loading: () => <PreviewSkeleton /> },
);

const PresentationViewerDriver = dynamic(
  () => import("./drivers/PresentationViewerDriver").then((m) => m.PresentationViewerDriver),
  { ssr: false, loading: () => <PreviewSkeleton /> },
);

const BinaryInspectorDriver = dynamic(
  () => import("./drivers/BinaryInspectorDriver").then((m) => m.BinaryInspectorDriver),
  { ssr: false, loading: () => <PreviewSkeleton /> },
);

interface UniversalPreviewEngineProps {
  node: WorkspaceNode;
  signedUrl: string | null;
  signedUrlError?: string | null;
  projectId: string;
  onRetry?: () => void;
}

interface DriverErrorBoundaryProps {
  children: React.ReactNode;
  onRetry?: () => void;
  fileName: string;
}

interface DriverErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class DriverErrorBoundary extends React.Component<DriverErrorBoundaryProps, DriverErrorBoundaryState> {
  constructor(props: DriverErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): DriverErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    logger.error("Preview driver crashed", {
      error: error.message,
      componentStack: errorInfo.componentStack,
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <AlertTriangle className="h-8 w-8 text-amber-500" />
          <p className="text-sm font-semibold text-foreground">Preview encountered an error</p>
          <p className="max-w-md text-xs text-muted-foreground">{this.state.error?.message || "An unexpected error occurred while rendering the preview."}</p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              this.setState({ hasError: false, error: null });
              this.props.onRetry?.();
            }}
            className="mt-2"
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Reload preview
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function UniversalPreviewEngine({
  node,
  signedUrl,
  signedUrlError,
  projectId,
  onRetry,
}: UniversalPreviewEngineProps): React.JSX.Element {
  const previewType = React.useMemo<UniversalPreviewType>(
    () => resolvePreviewType(node),
    [node],
  );

  React.useEffect(() => {
    logger.metric("preview.opened", {
      previewType,
      nodeId: node.id,
      projectId,
    });
  }, [previewType, node.id, projectId]);

  React.useEffect(() => {
    if (signedUrlError) {
      logger.error("Preview signed URL failed to resolve", {
        nodeId: node.id,
        projectId,
        error: signedUrlError,
      });
    }
  }, [signedUrlError, node.id, projectId]);

  if (signedUrlError) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <AlertTriangle className="h-8 w-8 text-amber-500" />
        <p className="text-sm font-semibold text-foreground">Couldn’t prepare file preview</p>
        <p className="max-w-md text-xs text-muted-foreground">{signedUrlError}</p>
        {onRetry && (
          <Button size="sm" variant="outline" onClick={onRetry} className="mt-2">
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Retry preview
          </Button>
        )}
      </div>
    );
  }

  // If PDF, we can render via server preview route when projectId is present or when signedUrl resolves
  if (previewType === "pdf") {
    return (
      <DriverErrorBoundary fileName={node.name} onRetry={onRetry}>
        <PdfViewerDriver node={node} signedUrl={signedUrl} projectId={projectId} />
      </DriverErrorBoundary>
    );
  }

  if (!signedUrl) {
    return <PreviewSkeleton />;
  }

  const renderDriverContent = () => {
    switch (previewType) {
      case "image":
        return <ImageViewerDriver node={node} signedUrl={signedUrl} />;

      case "video":
        return <MediaViewerDriver node={node} signedUrl={signedUrl} type="video" />;

      case "audio":
        return <MediaViewerDriver node={node} signedUrl={signedUrl} type="audio" />;

      case "docx":
      case "doc_legacy":
      case "rtf":
      case "odt":
        return <DocxViewerDriver node={node} signedUrl={signedUrl} />;

      case "sheet":
        return <SheetViewerDriver node={node} signedUrl={signedUrl} />;

      case "presentation":
        return <PresentationViewerDriver node={node} signedUrl={signedUrl} />;

      case "archive":
        return <ArchiveViewerDriver node={node} signedUrl={signedUrl} />;

      case "binary":
      default:
        return <BinaryInspectorDriver node={node} signedUrl={signedUrl} />;
    }
  };

  return (
    <DriverErrorBoundary fileName={node.name} onRetry={onRetry}>
      {renderDriverContent()}
    </DriverErrorBoundary>
  );
}

function PreviewSkeleton(): React.JSX.Element {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading preview"
      className="flex flex-1 flex-col gap-3 p-6"
    >
      <Skeleton className="h-4 w-32 rounded-[3px]" />
      <Skeleton className="h-4 w-5/6 rounded-[3px]" />
      <Skeleton className="h-4 w-4/6 rounded-[3px]" />
      <Skeleton className="h-4 w-2/3 rounded-[3px]" />
    </div>
  );
}
