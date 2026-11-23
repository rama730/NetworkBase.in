import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { PixelBeat } from "@/components/ui/PixelBeat"

const buttonVariants = cva(
  "inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md text-[13px] leading-[1.2] font-medium transition-[color,background-color,border-color,box-shadow,filter,opacity,transform] duration-[130ms] ease-[cubic-bezier(.2,.8,.3,1)] active:translate-y-px disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 focus-visible:brightness-[0.92] focus-visible:shadow-none! [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus:outline-none focus-visible:outline-none aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-[var(--primary-hover)]",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline:
          "border border-border bg-card shadow-xs hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost:
          "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-[var(--ui-control-height)] px-[var(--ui-control-px)] py-0 has-[>svg]:px-[calc(var(--ui-control-px)-0.125rem)]",
        sm:
          "h-[var(--ui-control-height-sm)] rounded-md gap-1.5 px-[var(--ui-control-px-sm)] py-0 has-[>svg]:px-[calc(var(--ui-control-px-sm)-0.125rem)]",
        lg: "h-[var(--ui-control-height-lg)] rounded-md px-[var(--ui-control-px-lg)] py-0 has-[>svg]:px-[calc(var(--ui-control-px-lg)-0.125rem)]",
        icon: "size-[var(--ui-control-height)]",
        "icon-sm": "size-[var(--ui-control-height-sm)]",
        "icon-lg": "size-[var(--ui-control-height-lg)]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

/**
 * `pending`: the action is running. The button keeps its width (the label stays, hidden, underneath), shows the pixel
 * beat and `pendingLabel` ("Saving"), and can't be pressed again. No spinner.
 */
function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  pending = false,
  pendingLabel,
  children,
  disabled,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
    pending?: boolean
    pendingLabel?: React.ReactNode
  }) {
  const Comp = asChild ? Slot : "button"
  const busy = pending && !asChild

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      data-pending={busy ? "" : undefined}
      aria-busy={busy || undefined}
      disabled={busy || disabled}
      className={cn(buttonVariants({ variant, size, className }), busy && "relative")}
      {...props}
    >
      {busy ? (
        <>
          <span className="nb-btn-hold" aria-hidden="true">{children}</span>
          <span className="nb-btn-busy"><PixelBeat />{pendingLabel ?? children}</span>
        </>
      ) : children}
    </Comp>
  )
}

export { Button, buttonVariants }
