"use client";

import Link from "next/link";
import { memo, useMemo, type ReactNode } from "react";
import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { CodeSnippetBlock } from "@/components/messages/CodeSnippetBlock";
import { PresenceGlyph } from "@/components/presence/PresenceGlyph";
import { normalizeSafeExternalUrl } from "@/lib/messaging/safe-links";
import { conversationHref } from "@/lib/messaging/routes";
import { splitTokens } from "@/lib/messaging/tokens";

type Props = {
  body: string;
  nameOf: (userId: string) => string | undefined;
  channelNameOf: (channelId: string) => string | undefined;
  meId: string | null;
  /** Inline after the last paragraph, e.g. "(edited)". */
  suffix?: ReactNode;
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

export const MessageBody = memo(function MessageBody({ body, nameOf, channelNameOf, meId, suffix }: Props) {
  const markdown = useMemo(() => tokensToMarkdown(body, nameOf, channelNameOf), [body, nameOf, channelNameOf]);
  const components = useMemo<Components>(() => ({
    a({ href, children }) {
      if (href?.startsWith("mention:")) {
        const self = href.slice(8) === meId;
        // Mention chip: the Node person glyph + name; mentions of you take the warning tint.
        return (
          <span className={`inline-flex items-baseline gap-0.5 rounded-[3px] px-0.5 font-medium ${self ? "bg-[var(--status-warning-soft)] text-[var(--status-warning)]" : "bg-accent text-primary"}`}>
            <PresenceGlyph kind="person" className="size-[0.85em] translate-y-[0.1em] self-center" strokeWidth={2.2} />
            {typeof children === "string" ? children.replace(/^@/, "") : Array.isArray(children) && typeof children[0] === "string" ? [children[0].replace(/^@/, ""), ...children.slice(1)] : children}
          </span>
        );
      }
      if (href?.startsWith("broadcast:")) return <span className="rounded-[3px] bg-[var(--status-warning-soft)] px-0.5 font-medium text-[var(--status-warning)]">{children}</span>;
      if (href?.startsWith("channel:")) return <Link href={conversationHref(href.slice(8))} className="font-medium text-primary hover:underline">{children}</Link>;
      // In-app message links (shared messages, "View message").
      if (href && /^\/messages\/[0-9a-f-]{36}(\?[a-z0-9=&]*)?$/i.test(href)) return <Link href={href} className="font-medium text-primary hover:underline">{children}</Link>;
      const safe = href ? normalizeSafeExternalUrl(href) : null;
      if (!safe) return <span>{children}</span>;
      return <a href={safe} target="_blank" rel="noopener noreferrer nofollow ugc" className="text-primary underline underline-offset-2">{children}</a>;
    },
    code({ className, children }) {
      const block = /language-/.test(className ?? "") || String(children).includes("\n");
      if (block) return <code className="font-mono text-[13px] pointer-coarse:text-[14px]">{children}</code>;
      return <code className="rounded-[3px] bg-muted px-1 py-0.5 font-mono text-[13px]">{children}</code>;
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
      return <pre className="my-1 max-w-full overflow-x-auto rounded-[5px] border border-border bg-muted p-3">{children}</pre>;
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
  }), [meId]);

  return (
    <div className={`text-[15px] leading-relaxed [overflow-wrap:anywhere] ${suffix ? "[&>p:nth-last-child(2)]:inline" : ""}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={urlTransform} components={components} skipHtml>
        {markdown}
      </ReactMarkdown>
      {suffix}
    </div>
  );
});

/** The first safe external link, for the link preview. */
export function firstLink(body: string) {
  const match = body.match(/https?:\/\/[^\s<>()]+/);
  return match ? normalizeSafeExternalUrl(match[0]) : null;
}
