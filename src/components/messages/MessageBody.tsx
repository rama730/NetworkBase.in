"use client";

import Link from "next/link";
import { memo, useMemo, type ReactNode } from "react";
import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { CodeSnippetBlock } from "@/components/messages/CodeSnippetBlock";
import { PresenceGlyph } from "@/components/presence/PresenceGlyph";
import { firstExternalMarkdownLink } from "@/lib/messaging/markdown-links";
import { normalizeSafeExternalUrl, sameOriginPath } from "@/lib/messaging/safe-links";
import { conversationHref } from "@/lib/messaging/routes";
import { splitTokens } from "@/lib/messaging/tokens";
import { parseShareResource } from '@/lib/sharing/presentation';

type Props = {
  body: string;
  nameOf: (userId: string) => string | undefined;
  channelNameOf: (channelId: string) => string | undefined;
  meId: string | null;
  /** Inline after the last paragraph, e.g. "(edited)". */
  suffix?: ReactNode;
  /** Wraps an @mention chip (the timeline adds the person's hover card). */
  wrapMention?: (userId: string, chip: ReactNode) => ReactNode;
};

const escapeLabel = (text: string) => text.replace(/[[\]\\]/g, "\\$&");

/** Tokens become links with private schemes so markdown can span them; the `a` renderer turns them into chips. */
export function tokensToMarkdown(body: string, nameOf: Props["nameOf"], channelNameOf: Props["channelNameOf"]) {
  return splitTokens(body)
    .map((segment) => {
      if (segment.type === "text") return segment.value;
      if (segment.type === "user") return `[@${escapeLabel(nameOf(segment.id) ?? "someone")}](mention:${segment.id})`;
      if (segment.type === "channel") return `[#${escapeLabel(channelNameOf(segment.id) ?? "channel")}](channel:${segment.id})`;
      return `[@${segment.value}](broadcast:${segment.value})`;
    })
    .join("");
}

function urlTransform(url: string) {
  if (/^(mention|channel|broadcast):/.test(url)) return url;
  return defaultUrlTransform(url);
}

/**
 * A link into Messages ("View message", or a pasted "Copy link" with the full address): its path,
 * to open in place. Other links (relative or not) aren't treated as in-app.
 */
function inAppPath(href: string) {
  const path = sameOriginPath(href, typeof window === "undefined" ? "https://networkbase.in" : window.location.origin);
  const resource = parseShareResource(href);
  if (resource) return new URL(resource.url).pathname;
  return path && /^\/messages(\/|\?|$)/.test(path) ? path : null;
}

export const MessageBody = memo(function MessageBody({ body, nameOf, channelNameOf, meId, suffix, wrapMention }: Props) {
  const markdown = useMemo(() => tokensToMarkdown(body, nameOf, channelNameOf), [body, nameOf, channelNameOf]);
  const components = useMemo<Components>(() => ({
    a({ href, children }) {
      if (href?.startsWith("mention:")) {
        const id = href.slice(8);
        const self = id === meId;
        // Mention chip: the Node person glyph + name (accent, never a status colour); you are in bold.
        const chip = (
          <span className={`inline-flex items-baseline gap-0.5 rounded-sm bg-accent px-0.5 text-primary ${self ? "font-semibold" : "font-medium"} ${wrapMention ? "cursor-pointer" : ""}`}>
            <PresenceGlyph kind="person" className="size-[0.85em] translate-y-[0.1em] self-center" />
            {typeof children === "string" ? children.replace(/^@/, "") : Array.isArray(children) && typeof children[0] === "string" ? [children[0].replace(/^@/, ""), ...children.slice(1)] : children}
          </span>
        );
        return wrapMention ? wrapMention(id, chip) : chip;
      }
      if (href?.startsWith("broadcast:")) return <span className="rounded-sm bg-accent px-0.5 font-semibold text-primary">{children}</span>;
      if (href?.startsWith("channel:")) return <Link href={conversationHref(href.slice(8))} className="font-medium text-primary hover:underline">{children}</Link>;
      // Links into this app (shared messages, a pasted "Copy link") open in place, not in a new tab.
      const path = href ? inAppPath(href) : null;
      if (path) return <Link href={path} className="font-medium text-primary hover:underline">{children}</Link>;
      const safe = href ? normalizeSafeExternalUrl(href) : null;
      if (!safe) return <span>{children}</span>;
      return <a href={safe} target="_blank" rel="noopener noreferrer nofollow ugc" className="text-primary underline underline-offset-2">{children}</a>;
    },
    code({ className, children }) {
      const block = /language-/.test(className ?? "") || String(children).includes("\n");
      if (block) return <code className="font-mono text-[13px]">{children}</code>;
      return <code className="rounded-sm bg-muted px-1 py-0.5 font-mono text-[13px]">{children}</code>;
    },
    pre({ children }) {
      if (children && typeof children === "object" && "props" in children) {
        const codeProps = (children as { props?: { className?: string; children?: unknown } }).props;
        if (codeProps) {
          const lang = codeProps.className || "";
          const codeString = String(codeProps.children || "");
          return <CodeSnippetBlock language={lang} code={codeString} />;
        }
      }
      return <pre className="my-1 max-w-full overflow-x-auto rounded-md border border-border bg-muted p-3">{children}</pre>;
    },
    blockquote({ children }) {
      return <blockquote className="my-1 border-l-2 border-border pl-3 text-muted-foreground">{children}</blockquote>;
    },
    ul({ children }) {
      return <ul className="my-1 list-disc pl-5">{children}</ul>;
    },
    ol({ children }) {
      return <ol className="my-1 list-decimal pl-5">{children}</ol>;
    },
    p({ children }) {
      return <p className="whitespace-pre-wrap">{children}</p>;
    },
    img({ alt }) {
      return <span>{alt}</span>;
    },
  }), [meId, wrapMention]);

  return (
    <div className={`text-[15px] leading-relaxed [overflow-wrap:anywhere] ${suffix ? "[&>p:nth-last-child(2)]:inline" : ""}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={urlTransform} components={components} skipHtml>
        {markdown}
      </ReactMarkdown>
      {suffix}
    </div>
  );
});

/** First safe previewable link; message links are excluded and first-party resources use authorized cards. */
export function firstLink(body: string) {
  return firstExternalMarkdownLink(body, typeof window === "undefined" ? "https://networkbase.in" : window.location.origin);
}
