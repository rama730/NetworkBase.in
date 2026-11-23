"use client"

import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"

import { cn } from "@/lib/utils"
import { TabMarker } from "@/components/ui/TabMarker"

function Tabs({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
}

function TabsList({
  className,
  children,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        "nb-tabs-list text-muted-foreground flex min-h-10 w-full items-center gap-5 border-b border-border",
        className
      )}
      {...props}
    >
      {children}
      <TabMarker overlap />
    </TabsPrimitive.List>
  )
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "nb-tab inline-flex min-h-10 shrink-0 items-center justify-center gap-2 border-b-2 border-transparent px-1 py-2 text-[13px] leading-[1.2] font-medium whitespace-nowrap transition-colors duration-[130ms] ease-[cubic-bezier(.2,.8,.3,1)] text-muted-foreground data-[state=active]:border-primary data-[state=active]:text-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-4",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
