import Link from "next/link";

/** A bad conversation or project link: say so here, so the chat sidebar stays (not the site's 404). */
export default function MessagesNotFound() {
  return (
    <div className="grid h-full place-items-center bg-card p-6 text-center">
      <div className="max-w-sm space-y-2">
        <h1 className="text-[17px] font-semibold">This conversation isn&apos;t here</h1>
        <p className="text-[13px] text-muted-foreground">The link may be wrong, or it was deleted.</p>
        <Link href="/messages" className="inline-flex h-9 items-center rounded-[5px] border border-border px-3 text-[13px] font-medium hover:bg-muted pointer-coarse:h-11">Back to Messages</Link>
      </div>
    </div>
  );
}
