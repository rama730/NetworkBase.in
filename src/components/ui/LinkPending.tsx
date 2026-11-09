"use client";

import { useLinkStatus } from "next/link";

/** Inside a <Link>: a thin bar along the card's top edge when the next page is slow (unified back R14). */
export function LinkPending() {
  const { pending } = useLinkStatus();
  return <span aria-hidden="true" className="nb-link-pending" data-pending={pending} />;
}
