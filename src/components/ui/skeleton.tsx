import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * A geometry-only content placeholder. Its shared neutral shimmer lives in globals.css so every loading surface
 * observes theme and motion settings. `kind`: `block` (default, any shape), `text` (a line at the cap height of the
 * text it stands for) or `tile` (an empty pixel tile where a person, workspace or organization picture will draw in).
 */
function Skeleton({ className, kind = "block", ...props }: React.ComponentProps<"div"> & { kind?: "block" | "text" | "tile" }) {
  return <div aria-hidden="true" className={cn("nb-skeleton", kind === "text" && "nb-skeleton-text", kind === "tile" && "nb-skeleton-tile", className)} {...props} />
}

export { Skeleton }
