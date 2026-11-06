"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { toast } from "@/lib/feedback";

/** Copy with one behaviour everywhere: the label says "Copied" for 2 seconds; a failure says what to do. */
export function CopyButton({ text, label = "Copy", size = "sm", variant = "outline", className }: { text: string; label?: string; size?: "sm" | "default"; variant?: "outline" | "ghost"; className?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2_000);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <Button type="button" size={size} variant={variant} className={className} aria-live="polite"
      onClick={() => void navigator.clipboard.writeText(text).then(() => setCopied(true), () => toast.error("Couldn’t copy. Select it and copy it yourself."))}>
      {copied ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
      {copied ? "Copied" : label}
    </Button>
  );
}
