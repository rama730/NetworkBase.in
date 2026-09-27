import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * A geometry-only content placeholder. Its shared neutral shimmer lives in
 * globals.css so every loading surface observes theme and motion settings.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div aria-hidden="true" className={cn("nb-skeleton", className)} {...props} />
}

export { Skeleton }
