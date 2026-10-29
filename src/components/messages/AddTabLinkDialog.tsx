"use client";

import { normalizeSafeExternalUrl } from "@/lib/messaging/safe-links";
import { useState } from "react";
import { Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAddTab: (title: string, url: string) => void;
};

export function AddTabLinkDialog({ open, onOpenChange, onAddTab }: Props) {
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmedUrl = normalizeSafeExternalUrl(url);
    if (!trimmedUrl) {
      setError("Enter a public web address, like https://example.com");
      return;
    }
    const host = new URL(trimmedUrl).hostname.replace(/^www\./, "");
    // No name typed: the site's name is a fine default.
    const trimmedTitle = title.trim() || host;

    onAddTab(trimmedTitle, trimmedUrl);
    setTitle("");
    setUrl("");
    setError(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="grid size-8 place-items-center rounded-md bg-muted text-muted-foreground">
              <Link2 size={16} />
            </div>
            <DialogTitle>Add a link</DialogTitle>
          </div>
          <DialogDescription>
            Keep a doc, dashboard, design or repo one click away. Everyone in the channel sees the link.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <label htmlFor="tab-url-input" className="text-[13px] font-medium text-foreground">
              Link
            </label>
            {/* inputMode url gives phones the URL keyboard; "example.com" is accepted (https:// is added). */}
            <Input
              id="tab-url-input"
              type="text"
              inputMode="url"
              autoComplete="url"
              placeholder="example.com"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                if (error) setError(null);
              }}
              autoFocus
              aria-invalid={Boolean(error) || undefined}
              aria-describedby={error ? "tab-link-error" : undefined}
              className="font-mono text-[13px]"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="tab-title-input" className="text-[13px] font-medium text-foreground">
              Link name <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <Input
              id="tab-title-input"
              type="text"
              placeholder="e.g. Figma designs, GitHub repo"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (error) setError(null);
              }}
              className="text-[13px]"
            />
          </div>

          {error ? <p id="tab-link-error" role="alert" className="text-[13px] text-destructive">{error}</p> : null}

          <DialogFooter paper>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit">Add link</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
