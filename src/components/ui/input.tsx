import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "file:text-foreground placeholder:text-muted-foreground dark:bg-input/30 border-input h-[var(--ui-control-height)] w-full min-w-0 rounded-md border bg-card px-[var(--ui-control-px)] py-0 text-[15px] leading-[1.5] shadow-none transition-[color,border-color,box-shadow] duration-[130ms] ease-[cubic-bezier(.2,.8,.3,1)] outline-none file:inline-flex file:h-[calc(var(--ui-control-height)-0.5rem)] file:border-0 file:bg-transparent file:text-[13px] file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "outline-none focus:outline-none focus-visible:bg-muted/20 focus-visible:outline-none",
        "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
        className
      )}
      {...props}
    />
  )
}

export { Input }
