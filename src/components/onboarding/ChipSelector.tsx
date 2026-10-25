'use client'

import { useState } from 'react'
import { Check, ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ChipOption {
  value: string
  label: string
}

interface ChipSelectorProps {
  options: ChipOption[]
  selected: Set<string>
  onToggle: (value: string) => void
  /** Names the group for assistive tech: the id of the label that describes it. */
  labelledBy: string
  maxVisible?: number
  /** Show the "N selected" line. Off where the page already shows a count; screen readers still get it. */
  showCount?: boolean
}

export default function ChipSelector({ options, selected, onToggle, labelledBy, maxVisible = 12, showCount = true }: ChipSelectorProps) {
  const [expanded, setExpanded] = useState(false)

  const shouldCollapse = options.length > maxVisible
  const visibleOptions = shouldCollapse && !expanded ? options.slice(0, maxVisible) : options
  const hiddenCount = options.length - maxVisible

  return (
    <div className="flex flex-col gap-2">
      <div role="group" aria-labelledby={labelledBy} className="flex flex-wrap gap-2">
        {visibleOptions.map((option) => {
          const isSelected = selected.has(option.value)
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={isSelected}
              onClick={() => onToggle(option.value)}
              className={cn(
                'onb-focusable inline-flex min-h-11 select-none items-center rounded-full border px-4 py-2 text-[13px] font-medium leading-none',
                'transition-[background-color,border-color,color] duration-[130ms] ease-in-out',
                isSelected
                  ? 'border-foreground bg-foreground text-background'
                  : 'border-border bg-card text-foreground hover:border-foreground/40 hover:bg-muted',
              )}
            >
              {isSelected ? <Check className="mr-1.5 h-3 w-3 shrink-0" strokeWidth={2.5} aria-hidden="true" /> : null}
              {option.label}
            </button>
          )
        })}
      </div>

      {shouldCollapse ? (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          className="onb-focusable inline-flex min-h-11 items-center gap-1 self-start rounded text-[13px] text-muted-foreground transition-colors duration-[130ms] hover:text-foreground"
        >
          {expanded ? (
            <>
              <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
              Show less
            </>
          ) : (
            <>
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
              Show more ({hiddenCount} more)
            </>
          )}
        </button>
      ) : null}

      {/* Always mounted, so a change is announced. */}
      <p className={showCount ? "onb-field-hint" : "sr-only"} role="status" aria-live="polite">
        {selected.size > 0 ? `${selected.size} selected` : ''}
      </p>
    </div>
  )
}
