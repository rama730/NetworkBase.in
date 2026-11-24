"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "@/components/ui/icons";

import { Button } from "@/components/ui/button";
import { toast } from "@/lib/feedback";
import { COPY_FAILED, copyText } from "@/lib/clipboard";

/** Copy with one behaviour everywhere: the icon turns into a tick and the label says "Copied" for 1.5 seconds; a failure says what to do. */
export function CopyButton({ text, label = "Copy", size = "sm", variant = "outline", className }: { text: string; label?: string; size?: "sm" | "default"; variant?: "outline" | "ghost"; className?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1_500);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <Button type="button" size={size} variant={variant} className={className} aria-live="polite"
      onClick={() => void copyText(text).then(() => setCopied(true), () => toast.error(COPY_FAILED))}>
      {copied ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
      {copied ? "Copied" : label}
    </Button>
  );
}
