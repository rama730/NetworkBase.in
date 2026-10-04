"use client";

import { useState } from "react";
import { ExternalLink, Globe, Link2, Copy, Check } from "lucide-react";
import { toast } from "sonner";
import { copyWithToast } from "@/lib/clipboard";
type Props = {
  tab: { title: string; url?: string | null };
};

export function ChannelLinkView({ tab }: Props) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (!tab.url) return;
    void copyWithToast(tab.url, "Link copied to clipboard").then((ok) => {
      if (!ok) return;
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-background">
      <header className="flex h-11 flex-none items-center justify-between border-b border-border bg-card/60 px-4">
        <div className="flex items-center gap-2 min-w-0">
          <Globe size={16} className="text-muted-foreground flex-none" />
          <span className="truncate text-[13px] font-medium text-foreground">{tab.title}</span>
          {tab.url ? (
            <span className="hidden truncate font-mono text-[12px] text-muted-foreground sm:inline max-w-sm">
              {tab.url}
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          {tab.url ? (
            <>
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex h-7 items-center gap-1.5 rounded-[5px] border border-border px-2 text-[12px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {copied ? <Check size={12} className="text-primary" /> : <Copy size={12} />}
                <span>{copied ? "Copied" : "Copy"}</span>
              </button>
              <a
                href={tab.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-7 items-center gap-1.5 rounded-[5px] bg-primary px-2.5 text-[12px] font-medium text-primary-foreground hover:opacity-90"
              >
                <span>Open in new tab</span>
                <ExternalLink size={12} />
              </a>
            </>
          ) : null}
        </div>
      </header>

      <div className="relative flex-1 bg-muted/20">
        {tab.url ? (
          <iframe
            src={tab.url}
            title={tab.title}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            className="size-full border-none"
          />
        ) : (
          <div className="grid h-full place-items-center p-6 text-center text-muted-foreground">
            <div className="max-w-sm space-y-2">
              <Link2 size={24} className="mx-auto text-muted-foreground" />
              <p className="text-[14px]">No URL specified for this link tab.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
