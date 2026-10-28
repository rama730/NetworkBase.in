"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { XIcon } from "lucide-react"

import { cn } from "@/lib/utils"

// The last two elements that took focus, so a dialog can tell what had focus before its own fields did.
let currentFocus: HTMLElement | null = null
let previousFocus: HTMLElement | null = null
if (typeof document !== "undefined") {
  document.addEventListener("focusin", (event) => {
    const target = event.target
    if (target instanceof HTMLElement && target !== currentFocus) {
      previousFocus = currentFocus
      currentFocus = target
    }
  }, true)
}

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-[rgba(13,17,20,0.44)] duration-[180ms] ease-[cubic-bezier(.2,.8,.3,1)] motion-reduce:animate-none",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  overlayClassName,
  presentation = "center",
  onEscapeKeyDown,
  onOpenAutoFocus,
  onCloseAutoFocus,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
  overlayClassName?: string
  presentation?: "center" | "right-drawer" | "bottom-sheet"
}) {
  // Radix returns focus only to a Trigger. Dialogs opened from state have none, so focus would fall to <body>:
  // remember what had focus when this one opened and give it back on close (unless the caller handled it).
  const returnFocusTo = React.useRef<HTMLElement | null>(null)
  const contentRef = React.useRef<HTMLDivElement | null>(null)
  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay className={overlayClassName} />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        data-presentation={presentation}
        aria-describedby={undefined}
        ref={(node) => {
          contentRef.current = node
          // Radix skips its own mount event when a field inside already took focus (autoFocus), so read it here:
          // then what came before that field is what to return to.
          // Only once per opening: this callback runs again on every render while the dialog is open.
          if (!node || returnFocusTo.current) return
          const insideNow = currentFocus && node.contains(currentFocus)
          returnFocusTo.current = insideNow ? previousFocus : currentFocus
        }}
        onOpenAutoFocus={onOpenAutoFocus}
        onCloseAutoFocus={(event) => {
          onCloseAutoFocus?.(event)
          const previous = returnFocusTo.current
          returnFocusTo.current = null
          if (event.defaultPrevented || !previous || previous === document.body || !previous.isConnected) return
          event.preventDefault()
          previous.focus()
        }}
        // Escape in an open combobox (a skill or people search) closes its list, not the whole dialog.
        onEscapeKeyDown={(event) => {
          const active = document.activeElement
          if (active?.getAttribute("role") === "combobox" && active.getAttribute("aria-expanded") === "true") event.preventDefault()
          onEscapeKeyDown?.(event)
        }}
        className={cn(
          "bg-card fixed z-[51] border shadow-lg outline-none",
          presentation === "bottom-sheet"
            ? "inset-x-0 bottom-0 flex max-h-[85dvh] w-full flex-col gap-0 rounded-t-xl rounded-b-none border-x-0 border-b-0 p-0 pb-[env(safe-area-inset-bottom)] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:slide-in-from-bottom-full data-[state=closed]:slide-out-to-bottom-full duration-[180ms] ease-[cubic-bezier(.2,.8,.3,1)] motion-reduce:animate-none"
            : presentation === "right-drawer"
            ? "inset-y-0 right-0 flex h-dvh w-full max-w-none flex-col gap-4 rounded-none border-y-0 border-r-0 border-l p-6 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-right-full data-[state=closed]:slide-out-to-right-full duration-[180ms] ease-[cubic-bezier(.2,.8,.3,1)] motion-reduce:animate-none"
            : "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 top-[50%] left-[50%] grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-xl p-6 duration-[180ms] ease-[cubic-bezier(.2,.8,.3,1)] sm:max-w-[460px]",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            className="absolute top-3 right-3 inline-flex size-[var(--ui-control-height)] items-center justify-center rounded-md text-muted-foreground transition-[color,background-color,opacity,box-shadow] duration-[130ms] hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:text-foreground focus-visible:outline-none disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2 text-center sm:text-left", className)}
      {...props}
    />
  )
}

/**
 * `paper`: the spec's footer (white body, paper footer): full width under the 24px-padded body,
 * a top border and the paper fill. Use it as the dialog's last child.
 */
function DialogFooter({ className, paper = false, ...props }: React.ComponentProps<"div"> & { paper?: boolean }) {
  return (
    <div
      data-slot="dialog-footer"
      data-paper={paper || undefined}
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        paper && "-mx-6 -mb-6 mt-2 rounded-b-xl border-t border-border bg-muted px-6 py-4",
        className
      )}
      {...props}
    />
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-[17px] leading-[1.28] font-semibold tracking-[-0.01em]", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-muted-foreground text-[13px] leading-[1.5]", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
