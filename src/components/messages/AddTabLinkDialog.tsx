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
    const trimmedTitle = title.trim();
    let trimmedUrl = url.trim();

    if (!trimmedTitle) {
      setError("Please provide a tab title");
      return;
    }

    if (!trimmedUrl) {
      setError("Please provide a valid URL");
      return;
    }

    if (!trimmedUrl.startsWith("http://") && !trimmedUrl.startsWith("https://")) {
      trimmedUrl = `https://${trimmedUrl}`;
    }

    try {
      new URL(trimmedUrl);
    } catch {
      setError("Please enter a valid web address (e.g., https://example.com)");
      return;
    }

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
            Pin a doc, dashboard, design or repo as a tab. Everyone in the channel sees it.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="space-y-1.5">
            <label htmlFor="tab-title-input" className="text-[13px] font-medium text-foreground">
              Tab title
            </label>
            <input
              id="tab-title-input"
              type="text"
              placeholder="e.g. Figma Designs, GitHub Repo"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (error) setError(null);
              }}
              autoFocus
              className="w-full rounded-[5px] border border-input bg-card px-3 py-2 text-[13px] outline-none focus:border-ring focus:ring-1 focus:ring-ring"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="tab-url-input" className="text-[13px] font-medium text-foreground">
              URL
            </label>
            <input
              id="tab-url-input"
              type="text"
              placeholder="https://..."
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                if (error) setError(null);
              }}
              className="w-full rounded-[5px] border border-input bg-card px-3 py-2 text-[13px] font-mono outline-none focus:border-ring focus:ring-1 focus:ring-ring"
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
              Add tab
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
