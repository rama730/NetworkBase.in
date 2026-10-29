"use client";

/**
 * ContributionStoryView
 *
 * Public-facing and owner-preview renderer for structured project contribution stories.
 * Renders verified role stages, demonstrated skills (with authentic SkillChip/SkillIcon
 * brand assets), rich Markdown summaries with safe mention tokens, and media galleries.
 *
 * Adheres strictly to Ponytail design tokens: standard drafting radii (rounded-[4px],
 * rounded-[6px]), zero rounded-full controls, and sanitized external URLs.
 */

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ChevronDown,
  ChevronUp,
  ArrowLeft,
  ArrowRight,
  Globe,
  Github,
  Pin,
  ShieldCheck,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { SkillChip } from "@/components/skills/SkillChip";
import { isSafeHttpUrl } from "@/lib/security/urls";
import { cn } from "@/lib/utils";
import {
  contributionPreviewLayout,
  contributionPreviewText,
  restoreContributionPreviewPosition,
} from "@/lib/profile/contribution-preview";
import type { ProfileCollaborationContribution } from "@/lib/profile/collaboration";
import {
  storyFromContribution,
  storyPeriod,
  sortedStoryPositions,
  STORY_REFERENCE_PATTERN,
  reconcileStoryCurrentStatus,
  type ContributionStory,
  type ResolvedStoryReference,
} from "@/lib/profile/contribution-story";

export function ContributionIdentityLinks({
  links,
  className,
}: {
  links: ContributionStory["links"];
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-1 text-muted-foreground",
        className,
      )}
    >
      {links
        .filter((link) => isSafeHttpUrl(link.url))
        .filter(
          (link, index, array) =>
            array.findIndex((other) => other.url === link.url) === index,
        )
        .map((link, index) => {
          const host = new URL(link.url).hostname.replace(/^www\./i, "");
          const github = host === "github.com" || host === "gist.github.com";
          const label = github
            ? "GitHub repository"
            : link.label.trim() || "Website";
          return (
            <a
              key={link.id + ":" + index}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Open ${label}: ${link.url} (opens in a new tab)`}
              title={`${label} · ${link.url}`}
              className="nb-touch-target inline-flex size-7 shrink-0 items-center justify-center rounded-[4px] hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {github ? (
                <Github aria-hidden="true" className="size-4" />
              ) : (
                <Globe aria-hidden="true" className="size-4" />
              )}
            </a>
          );
        })}
    </div>
  );
}
export function ContributionMarkdown({
  summary,
  references = [],
}: {
  summary: string;
  references?: ResolvedStoryReference[];
}) {
  let index = 0;
  const refs: ResolvedStoryReference[] = [];
  const markdown = summary.replace(
    new RegExp(STORY_REFERENCE_PATTERN),
    (_m, kind, id) => {
      const ref = references.find((r) => r.kind === kind && r.id === id) ?? {
        kind,
        id,
        label: `Unavailable ${kind}`,
        href: null,
        available: false,
      };
      refs.push(ref);
      return `[${ref.label.replace(/[\[\]\\*_`<>]/g, "")}](${`#contribution-reference-${index++}`})`;
    },
  );
  return (
    <div className="nb-contribution-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          img: () => null,
          a: ({ href, children }) => {
            const match = /^#contribution-reference-(\d+)$/.exec(href ?? "");
            if (match) {
              const ref = refs[Number(match[1])];
              return ref?.available && ref.href ? (
                <a
                  href={ref.href}
                  className="font-semibold text-primary no-underline hover:underline cursor-pointer"
                >
                  {ref.label}
                </a>
              ) : (
                <span
                  className={
                    ref?.available ? "font-medium" : "text-muted-foreground"
                  }
                >
                  {ref?.label ?? children}
                </span>
              );
            }
            if (!href || !isSafeHttpUrl(href)) return <span>{children}</span>;
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline"
              >
                {children}
              </a>
            );
          },
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
export function ContributionImageDescription({
  image,
}: {
  image: ContributionStory["images"][number];
}) {
  return (
    <>
      {image.caption.trim() && (
        <p className="nb-compact font-medium whitespace-pre-wrap">
          {image.caption}
        </p>
      )}
      {image.alt.trim() && image.alt.trim() !== image.caption.trim() && (
        <p className="nb-compact whitespace-pre-wrap text-muted-foreground">
          {image.alt}
        </p>
      )}
    </>
  );
}
export function ContributionStoryView({
  contribution,
  story: override,
  refs,
  expandedByDefault = false,
  onProjectIntent,
}: {
  contribution: ProfileCollaborationContribution;
  story?: ContributionStory;
  refs?: ResolvedStoryReference[];
  expandedByDefault?: boolean;
  onProjectIntent?: (href: string) => void;
}) {
  const story = reconcileStoryCurrentStatus(
    override ??
      contribution.presentation ??
      storyFromContribution({ ...contribution, draftStory: null }),
  );
  const [expanded, setExpanded] = useState(expandedByDefault),
    [imageIndex, setImageIndex] = useState<number | null>(null);
  const reveal = useRef<HTMLButtonElement>(null);
  const [openedByReader, setOpenedByReader] = useState(false);
  const article = useRef<HTMLElement>(null);
  const summaryBody = useRef<HTMLDivElement>(null);
  const detailsBody = useRef<HTMLDivElement>(null);
  const images = [...story.images].sort(
    (a, b) => Number(b.id === story.coverId) - Number(a.id === story.coverId),
  );
  const positions = sortedStoryPositions(story.positions);
  const singlePositionDescription =
    positions.length === 1 &&
    positions[0]!.description.trim() !== story.summary.trim()
      ? positions[0]!.description.trim()
      : "";
  const projectLinks = [
    ...(contribution.projectIdentityLinks ?? []),
    ...story.links,
  ].filter((link) => isSafeHttpUrl(link.url));
  const hasSummary = Boolean(story.summary.trim() || singlePositionDescription);
  const hasDetails =
    images.length > 0 || positions.length > 1 || story.skills.length > 0;
  const [preview, setPreview] = useState(() => ({
    ...contributionPreviewLayout({
      summaryHeight: 0,
      lineHeight: 23.25,
      detailsHeight: images.length ? 176 : 0,
      hasMedia: images.length > 0,
    }),
    summaryText: "",
    detailsText: "",
    measured: false,
  }));
  const hasExtra =
    preview.measured && (preview.summaryClipped || preview.detailsClipped);
  const summaryClipped =
    !expanded && preview.measured && preview.summaryClipped;
  const detailsClipped =
    !expanded && preview.measured && preview.detailsClipped;
  // Keep the reader's collapse control after a wider viewport makes everything fit.
  const showReveal = hasExtra || (expanded && openedByReader);
  const publicRefs = refs ?? contribution.resolvedReferences ?? [];
  useLayoutEffect(() => {
    const element = article.current;
    if (!element) return;
    const measure = () => {
      // content-visibility can defer offscreen stories; observe again once laid out.
      if (!element.getBoundingClientRect().width) return;
      const summary = summaryBody.current;
      const details = detailsBody.current;
      const markdown = summary?.querySelector<HTMLElement>(
        ".nb-contribution-markdown",
      );
      const lineHeight =
        parseFloat(
          getComputedStyle(markdown ?? summary ?? element).lineHeight,
        ) || 23.25;
      const layout = contributionPreviewLayout({
        summaryHeight: summary?.scrollHeight ?? 0,
        lineHeight,
        detailsHeight: details?.scrollHeight ?? 0,
        hasMedia: images.length > 0,
      });
      const next = {
        ...layout,
        measured: true,
        summaryText: layout.summaryClipped
          ? contributionPreviewText(summary, layout.summaryLimit - lineHeight)
          : "",
        detailsText: layout.detailsClipped
          ? contributionPreviewText(details, layout.detailsLimit - 32)
          : "",
      };
      setPreview((previous) =>
        JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (summaryBody.current) observer.observe(summaryBody.current);
    if (detailsBody.current) observer.observe(detailsBody.current);
    window.addEventListener("resize", measure);
    element.addEventListener("contentvisibilityautostatechange", measure);
    document.fonts?.addEventListener("loadingdone", measure);
    // Font metrics and image loading can change wrapping after the first measurement.
    let disposed = false;
    void document.fonts?.ready.then(() => {
      if (!disposed) measure();
    });
    return () => {
      disposed = true;
      observer.disconnect();
      window.removeEventListener("resize", measure);
      element.removeEventListener("contentvisibilityautostatechange", measure);
      document.fonts?.removeEventListener("loadingdone", measure);
    };
  }, [story, images.length, refs, contribution.resolvedReferences]);
  const mediaKey = images
    .map((image) => `${image.id}:${image.assetId}`)
    .join("|");
  useEffect(() => {
    setImageIndex(null);
  }, [mediaKey]);
  const gallery = (
    <div className="grid grid-cols-2 gap-3 max-[420px]:grid-cols-1">
      {images.map((image, index) => (
        <figure key={image.id} className="min-w-0">
          <button
            type="button"
            className="block w-full overflow-hidden rounded-[6px] border border-border bg-muted/30"
            aria-label={`Open image ${index + 1}: ${image.alt}`}
            onClick={() => setImageIndex(index)}
          >
            <img
              src={`/api/v1/contribution-images/${image.assetId}`}
              alt={image.alt}
              loading="lazy"
              className="h-44 w-full object-contain"
            />
          </button>
          {(image.caption.trim() || image.alt.trim()) && (
            <figcaption className="mt-2 space-y-1">
              <ContributionImageDescription image={image} />
            </figcaption>
          )}
        </figure>
      ))}
    </div>
  );
  return (
    <article
      ref={article}
      tabIndex={-1}
      className="nb-contribution-story min-w-0 py-5"
    >
      <header className="nb-story-heading mb-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4">
        <div className="nb-story-identity flex min-w-0 flex-nowrap items-baseline gap-2">
          <h3 className="nb-card-title flex min-w-0 items-center gap-2">
            {contribution.projectHref &&
            (contribution.projectHref.startsWith("/") ||
              isSafeHttpUrl(contribution.projectHref)) ? (
              <a
                href={contribution.projectHref}
                {...(contribution.projectHref.startsWith("http")
                  ? { target: "_blank", rel: "noopener noreferrer" }
                  : {})}
                onMouseEnter={() =>
                  onProjectIntent?.(contribution.projectHref!)
                }
                onFocus={() => onProjectIntent?.(contribution.projectHref!)}
                title={contribution.projectTitle}
                className="min-w-0 truncate rounded-[4px] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {contribution.projectTitle}
              </a>
            ) : (
              <span className="truncate" title={story.title}>
                {story.title}
              </span>
            )}
            {contribution.featured && (
              <Pin
                aria-label="Feature on profile / Featured"
                className="size-3.5 text-primary"
              />
            )}
          </h3>
          {positions[0]?.title && (
            <p
              title={positions[0].title}
              className="nb-story-headline-role nb-body min-w-0 truncate border-l border-border pl-2 font-semibold"
            >
              {positions[0].title}
            </p>
          )}
        </div>
        <div className="nb-story-metadata flex min-w-0 items-center justify-end gap-2">
          {projectLinks.length > 0 && (
            <ContributionIdentityLinks
              className="nb-story-identity-links min-w-0 max-w-28 flex-nowrap justify-end overflow-x-auto"
              links={projectLinks}
            />
          )}
          {storyPeriod(story) && (
            <p className="nb-story-date nb-meta shrink-0 whitespace-nowrap text-right tabular-nums text-muted-foreground">
              {storyPeriod(story)}
            </p>
          )}
        </div>
      </header>
      <div
        id={`contribution-story-${contribution.id}`}
        className={`nb-story-reveal ${expanded ? "is-expanded" : ""}`}
      >
        {hasSummary && (
          <>
            <div
              className="nb-story-preview-block"
              data-clipped={summaryClipped || undefined}
              style={{
                maxHeight:
                  expanded || !preview.measured
                    ? undefined
                    : preview.summaryLimit,
              }}
              inert={summaryClipped || undefined}
              aria-hidden={summaryClipped || undefined}
            >
              <div ref={summaryBody} className="flow-root">
                <ContributionMarkdown
                  summary={story.summary}
                  references={publicRefs}
                />
                {singlePositionDescription && (
                  <p className="nb-compact mt-3 whitespace-pre-wrap text-muted-foreground">
                    {singlePositionDescription}
                  </p>
                )}
              </div>
            </div>
            {summaryClipped && preview.summaryText && (
              <p className="sr-only">{preview.summaryText}…</p>
            )}
          </>
        )}
        {hasDetails && (
          <>
            <div
              className={cn("nb-story-preview-block", hasSummary && "mt-3")}
              data-clipped={detailsClipped || undefined}
              style={{
                maxHeight:
                  expanded || !preview.measured
                    ? undefined
                    : preview.detailsLimit,
              }}
              inert={detailsClipped || undefined}
              aria-hidden={detailsClipped || undefined}
            >
              <div ref={detailsBody} className="flow-root">
                {images.length > 0 && gallery}
                {positions.length > 1 && (
                  <section
                    className={images.length ? "mt-4" : undefined}
                    aria-label="Role history"
                  >
                    <h4 className="nb-body mb-1 font-semibold text-balance">
                      Role history
                    </h4>
                    <div className="divide-y divide-border">
                      {positions.map((p) => (
                        <div key={p.id} className="py-2.5">
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <h5 className="nb-body min-w-0 break-words font-semibold text-balance flex items-center gap-1.5">
                              {p.title}
                              {p.recordedStageId && (
                                <span
                                  title="Verified role"
                                  className="inline-flex items-center text-blue-500"
                                >
                                  <ShieldCheck
                                    className="size-3.5"
                                    aria-label="Verified role"
                                  />
                                </span>
                              )}
                            </h5>
                            <span className="nb-meta tabular-nums text-muted-foreground">
                              {storyPeriod(p)}
                            </span>
                          </div>
                          {p.description && (
                            <p className="nb-compact mt-1 text-muted-foreground whitespace-pre-wrap">
                              {p.description}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </section>
                )}
                {story.skills.length > 0 && (
                  <div
                    className={cn(
                      "flex flex-wrap gap-1.5",
                      (images.length > 0 || positions.length > 1) && "mt-3",
                    )}
                    aria-label="Skills used"
                  >
                    {Array.from(new Set(story.skills)).map((s) => (
                      <SkillChip key={s} skill={s} size="sm" />
                    ))}
                  </div>
                )}
              </div>
            </div>
            {detailsClipped && preview.detailsText && (
              <p className="sr-only">{preview.detailsText}…</p>
            )}
          </>
        )}
      </div>
      {showReveal && (
        <button
          type="button"
          ref={reveal}
          aria-expanded={expanded}
          aria-controls={`contribution-story-${contribution.id}`}
          className="nb-touch-target mt-2 inline-flex items-center gap-1 nb-ui-label text-primary"
          onClick={() => {
            if (!expanded) setOpenedByReader(true);
            setExpanded((v) => !v);
            if (expanded)
              requestAnimationFrame(() =>
                restoreContributionPreviewPosition(
                  article.current,
                  reveal.current,
                ),
              );
          }}
        >
          {expanded ? "Show less" : "Read contribution"}
          {expanded ? (
            <ChevronUp className="size-3.5" />
          ) : (
            <ChevronDown className="size-3.5" />
          )}
        </button>
      )}
      <Dialog
        open={imageIndex !== null}
        onOpenChange={(open) => {
          if (!open) setImageIndex(null);
        }}
      >
        <DialogContent
          className="flex max-h-[90dvh] w-[calc(100%-32px)] max-w-5xl flex-col overflow-hidden p-4"
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") {
              e.preventDefault();
              setImageIndex((i) => Math.max(0, (i ?? 0) - 1));
            }
            if (e.key === "ArrowRight") {
              e.preventDefault();
              setImageIndex((i) => Math.min(images.length - 1, (i ?? 0) + 1));
            }
          }}
        >
          <DialogTitle>Work examples · {story.title}</DialogTitle>
          {imageIndex !== null && images[imageIndex] && (
            <>
              <div className="flex shrink-0 items-center justify-between gap-2 pr-8">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={imageIndex === 0}
                  onClick={() =>
                    setImageIndex((i) => Math.max(0, (i ?? 0) - 1))
                  }
                >
                  <ArrowLeft className="size-4" />
                  Previous
                </Button>
                <span aria-live="polite" className="nb-meta">
                  {imageIndex + 1} of {images.length}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={imageIndex === images.length - 1}
                  onClick={() =>
                    setImageIndex((i) =>
                      Math.min(images.length - 1, (i ?? 0) + 1),
                    )
                  }
                >
                  Next
                  <ArrowRight className="size-4" />
                </Button>
              </div>
              <div className="min-h-0 overflow-auto">
                <img
                  src={`/api/v1/contribution-images/${images[imageIndex]!.assetId}`}
                  alt={images[imageIndex]!.alt}
                  className="mx-auto max-h-[65dvh] max-w-full object-contain"
                />
                <div className="mt-3 space-y-1">
                  <ContributionImageDescription image={images[imageIndex]!} />
                </div>
                {images[imageIndex]!.positionId && (
                  <p className="nb-meta mt-1 text-muted-foreground">
                    {
                      positions.find(
                        (p) => p.id === images[imageIndex]!.positionId,
                      )?.title
                    }
                  </p>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </article>
  );
}
