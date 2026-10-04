"use client";

import { useState } from "react";
import { Link2 } from "lucide-react";
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
    let trimmedUrl = url.trim();

    if (!trimmedUrl) {
      setError("Add the bookmark's link");
      return;
    }

    if (!trimmedUrl.startsWith("http://") && !trimmedUrl.startsWith("https://")) {
      trimmedUrl = `https://${trimmedUrl}`;
    }

    let host = "";
    try {
      host = new URL(trimmedUrl).hostname.replace(/^www\./, "");
    } catch {
      setError("Enter a web address, like https://example.com");
      return;
    }
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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="grid size-8 place-items-center rounded-[5px] bg-muted text-muted-foreground">
              <Link2 size={16} />
            </div>
            <DialogTitle>Add a bookmark</DialogTitle>
          </div>
          <DialogDescription>
            Keep a doc, dashboard, design or repo one click away. Everyone in the channel sees the bookmark.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="space-y-1.5">
            <label htmlFor="tab-url-input" className="text-[13px] font-medium text-foreground">
              Link
            </label>
            {/* inputMode url gives phones the URL keyboard; "example.com" is accepted (https:// is added). */}
            <input
              id="tab-url-input"
              type="text"
              inputMode="url"
              autoComplete="url"
              placeholder="https://..."
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                if (error) setError(null);
              }}
              autoFocus
              className="w-full rounded-[5px] border border-input bg-card px-3 py-2 text-[13px] font-mono outline-none focus:border-ring focus:ring-1 focus:ring-ring"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="tab-title-input" className="text-[13px] font-medium text-foreground">
              Bookmark name <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <input
              id="tab-title-input"
              type="text"
              placeholder="e.g. Figma designs, GitHub repo"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (error) setError(null);
              }}
              className="w-full rounded-[5px] border border-input bg-card px-3 py-2 text-[13px] outline-none focus:border-ring focus:ring-1 focus:ring-ring"
            />
          </div>

          {error ? <p role="alert" className="text-[12px] text-destructive">{error}</p> : null}

          <DialogFooter className="pt-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-[5px] border border-border px-3 py-1.5 text-[13px] font-medium hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-[5px] bg-primary px-3.5 py-1.5 text-[13px] font-medium text-primary-foreground hover:opacity-90"
            >
              Add bookmark
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
