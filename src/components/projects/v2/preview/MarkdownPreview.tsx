"use client";

import React, { useMemo, useState, useEffect, Suspense, useCallback } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import { cn } from "@/lib/utils";

const LazyReactMarkdown = dynamic(
  () => import("react-markdown"),
  { ssr: false }
);

interface MarkdownPreviewProps {
  content: string;
  className?: string;
  projectId?: string;
}

const CONTROL_CHARS_REGEX = /[\u0000-\u001F\u007F]/g;
const SAFE_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);
const SAFE_IMAGE_PROTOCOLS = new Set(["http:", "https:"]);

function sanitizeMarkdownUrl(raw: string, allowRelative: boolean, isImage: boolean): string {
  const value = raw.replace(CONTROL_CHARS_REGEX, "").trim();
  if (!value) return "";
  if (value.startsWith("#")) return allowRelative ? value : "";

  if (!/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(value)) {
    if (!allowRelative) return "";
    if (value.startsWith("//")) return "";
    return value;
  }

  try {
    const parsed = new URL(value);
    const allowedProtocols = isImage ? SAFE_IMAGE_PROTOCOLS : SAFE_LINK_PROTOCOLS;
    return allowedProtocols.has(parsed.protocol) ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function safeMarkdownUrlTransform(url: string, key: string): string {
  const isImage = key === "src";
  return sanitizeMarkdownUrl(url, true, isImage);
}

function MarkdownImage({
  src,
  alt = "",
  title,
  projectId,
  allowRemoteImages,
  onAllowRemoteImages,
}: React.ImgHTMLAttributes<HTMLImageElement> & {
  projectId?: string;
  allowRemoteImages: boolean;
  onAllowRemoteImages: () => void;
}) {
  const [resolvedSrc, setResolvedSrc] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const rawSrc = typeof src === "string" ? src : "";
  const isRemote = /^https?:\/\//i.test(rawSrc);

  useEffect(() => {
    let cancelled = false;
    if (!rawSrc) return;

    if (isRemote) {
      if (allowRemoteImages) {
        setResolvedSrc(rawSrc);
      } else {
        setResolvedSrc(null);
      }
      return;
    }

    // Relative image: resolve via findNodeByPathAny
    if (projectId && !rawSrc.startsWith("data:")) {
      const pathParts = rawSrc.replace(/^\.?\//, "").split("/").filter(Boolean);
      import("@/app/actions/files/nodes")
        .then(({ findNodeByPathAny }) => findNodeByPathAny(projectId, pathParts))
        .then((node) => {
          if (cancelled) return;
          if (node && node.s3Key) {
            setResolvedSrc(`/api/v1/projects/${projectId}/files/${node.id}/preview`);
            return;
          }
          setResolvedSrc(rawSrc);
        })
        .catch(() => {
          if (!cancelled) setResolvedSrc(rawSrc);
        });
    } else {
      setResolvedSrc(rawSrc);
    }

    return () => {
      cancelled = true;
    };
  }, [rawSrc, isRemote, allowRemoteImages, projectId]);

  if (isRemote && !allowRemoteImages) {
    return (
      <div className="my-4 flex items-center gap-2 rounded-[5px] border border-border bg-muted/50 p-2.5 text-xs text-muted-foreground">
        <span>Remote image blocked for privacy</span>
        <button
          type="button"
          onClick={onAllowRemoteImages}
          className="rounded-[3px] border border-border bg-card px-2 py-0.5 text-foreground hover:bg-muted font-medium transition-colors"
        >
          Load remote images
        </button>
      </div>
    );
  }

  if (!resolvedSrc || loadError) {
    return (
      <span className="my-2 inline-block rounded-[3px] border border-border bg-muted/30 px-2 py-1 text-xs text-muted-foreground">
        {alt || "Image"}
      </span>
    );
  }

  return (
    <Image
      src={resolvedSrc}
      alt={alt || ""}
      title={typeof title === "string" ? title : undefined}
      width={1200}
      height={800}
      unoptimized
      onError={() => setLoadError(true)}
      className="max-w-full h-auto rounded-[5px] my-4"
      style={{ height: "auto" }}
    />
  );
}

export default function MarkdownPreview({ content, className, projectId }: MarkdownPreviewProps) {
  const [allowRemoteImages, setAllowRemoteImages] = useState(false);
  const handleAllowRemoteImages = useCallback(() => setAllowRemoteImages(true), []);

  const remarkPlugins = useMemo(() => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const gfm = require("remark-gfm");
      return [gfm.default || gfm];
    } catch {
      return [];
    }
  }, []);

  const components = useMemo(() => ({
    h1: ({ ...props }: React.HTMLAttributes<HTMLHeadingElement>) => <h1 className="text-2xl font-semibold mb-4 border-b border-border pb-2 text-foreground" {...props} />,
    h2: ({ ...props }: React.HTMLAttributes<HTMLHeadingElement>) => <h2 className="text-xl font-semibold mt-6 mb-3 text-foreground" {...props} />,
    h3: ({ ...props }: React.HTMLAttributes<HTMLHeadingElement>) => <h3 className="text-lg font-medium mt-4 mb-2 text-foreground" {...props} />,
    p: ({ ...props }: React.HTMLAttributes<HTMLParagraphElement>) => <p className="mb-4 leading-relaxed" {...props} />,
    ul: ({ ...props }: React.HTMLAttributes<HTMLUListElement>) => <ul className="list-disc list-inside mb-4 pl-4" {...props} />,
    ol: ({ ...props }: React.HTMLAttributes<HTMLOListElement>) => <ol className="list-decimal list-inside mb-4 pl-4" {...props} />,
    li: ({ ...props }: React.HTMLAttributes<HTMLLIElement>) => <li className="mb-1" {...props} />,
    blockquote: ({ ...props }: React.HTMLAttributes<HTMLQuoteElement>) => <blockquote className="border-l-4 border-border pl-4 py-1 my-4 italic text-muted-foreground" {...props} />,
    a: ({ href, rel, target, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => {
      const safeHref = typeof href === "string" ? sanitizeMarkdownUrl(href, true, false) : "";
      if (!safeHref) return <span className="text-muted-foreground">{props.children}</span>;
      const isExternal = /^https?:\/\//i.test(safeHref);
      return (
        <a
          href={safeHref}
          rel={isExternal ? "noopener noreferrer" : rel}
          target={isExternal ? "_blank" : target}
          className="text-primary hover:underline font-medium"
          {...props}
        />
      );
    },
    code: ({ className: codeClassName, children, ...props }: React.HTMLAttributes<HTMLElement>) => {
      const match = /language-(\w+)/.exec(codeClassName || "");
      const isInline = !match;
      if (isInline) {
        return <code className="bg-muted px-1 py-0.5 rounded-[3px] text-sm font-mono text-foreground" {...props}>{children}</code>;
      }
      return (
        <div className="bg-muted rounded-[5px] p-3 my-4 overflow-x-auto">
          <code className={cn("text-sm font-mono block", codeClassName)} {...props}>
            {children}
          </code>
        </div>
      );
    },
    table: ({ ...props }: React.TableHTMLAttributes<HTMLTableElement>) => <div className="overflow-x-auto my-4"><table className="w-full text-left border-collapse" {...props} /></div>,
    th: ({ ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) => <th className="border-b border-border font-semibold p-2 text-foreground" {...props} />,
    td: ({ ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) => <td className="border-b border-border p-2 text-foreground" {...props} />,
    hr: ({ ...props }: React.HTMLAttributes<HTMLHRElement>) => <hr className="my-6 border-border" {...props} />,
    img: (props: React.ImgHTMLAttributes<HTMLImageElement>) => (
      <MarkdownImage
        {...props}
        projectId={projectId}
        allowRemoteImages={allowRemoteImages}
        onAllowRemoteImages={handleAllowRemoteImages}
      />
    ),
  }), [projectId, allowRemoteImages, handleAllowRemoteImages]);

  return (
    <div className={cn("markdown-body overflow-auto h-full p-4 bg-card text-foreground", className)}>
      <Suspense fallback={<div className="text-sm text-muted-foreground">Loading preview...</div>}>
        <LazyReactMarkdown
          remarkPlugins={remarkPlugins}
          skipHtml
          urlTransform={safeMarkdownUrlTransform}
          components={components as unknown as Record<string, React.FC>}
        >
          {content}
        </LazyReactMarkdown>
      </Suspense>
    </div>
  );
}
