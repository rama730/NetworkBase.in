import Link from "next/link";

import { Button } from "@/components/ui/button";

/** A bad conversation or project link: say so here, so the chat sidebar stays (not the site's 404). */
export default function MessagesNotFound() {
  return (
    <div className="grid h-full place-items-center bg-card p-6 text-center">
      <div className="max-w-sm space-y-2">
        {/* Bad project and Browse links land here too: not only conversations. */}
        <h1 className="nb-card-title">This page isn’t here</h1>
        <p className="text-[13px] text-muted-foreground">The link may be wrong, or what it pointed to was deleted.</p>
        <Button asChild variant="outline" className="pointer-coarse:h-11"><Link href="/messages">Back to Messages</Link></Button>
      </div>
    </div>
  );
}
