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
  variant: 'single' | 'multi'
  size?: 'sm' | 'md'
  colorVariant?: 'primary' | 'secondary'
  maxVisible?: number
  expandLabel?: string
}

export default function ChipSelector({
  options,
  selected,
  onToggle,
  variant,
  size = 'md',
  colorVariant: _colorVariant = 'primary',
  maxVisible = 12,
  expandLabel = 'Show more',
}: ChipSelectorProps) {
  const [expanded, setExpanded] = useState(false)

  const shouldCollapse = options.length > maxVisible
  const visibleOptions = shouldCollapse && !expanded
    ? options.slice(0, maxVisible)
    : options

  const hiddenCount = options.length - maxVisible

  const handleToggle = (value: string) => {
    if (variant === 'single') {
      // In single mode, toggling the already-selected value deselects it
      onToggle(value)
    } else {
      onToggle(value)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div role="group" className="flex flex-wrap gap-2">
        {visibleOptions.map((option) => {
          const isSelected = selected.has(option.value)

          return (
            <button
              key={option.value}
              type="button"
              role="button"
              aria-pressed={isSelected}
              onClick={() => handleToggle(option.value)}
              className={cn(
                'onb-focusable inline-flex items-center rounded-full border transition-[background-color,border-color,color] duration-[130ms] ease-in-out',
                'text-[13px] font-medium leading-none select-none',
                'min-h-[44px] sm:min-h-0',
                // Size variants
                size === 'sm' && 'px-[14px] py-[6px]',
                size === 'md' && 'px-4 py-2',
                // Unselected state
                !isSelected && [
                  'bg-card border-border text-foreground',
                  'hover:bg-muted hover:border-foreground/40',
                ],
                isSelected && 'border-foreground bg-foreground text-background',
              )}
            >
              {isSelected && (
                <Check
                  className={cn(
                    'w-3 h-3 mr-1.5 shrink-0',
                    'text-background',
                  )}
                  strokeWidth={2.5}
                />
              )}
              {option.label}
            </button>
          )
        })}
      </div>

      {/* Show more / Show less toggle */}
      {shouldCollapse && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="onb-focusable inline-flex min-h-[44px] self-start items-center gap-1 rounded text-[13px] text-muted-foreground transition-colors duration-[130ms] hover:text-foreground sm:min-h-0"
        >
          {expanded ? (
            <>
              <ChevronUp className="w-3.5 h-3.5" />
              Show less
            </>
          ) : (
            <>
              <ChevronDown className="w-3.5 h-3.5" />
              {expandLabel} ({hiddenCount} more)
            </>
          )}
        </button>
      )}

      {/* Selection counter */}
      {selected.size > 0 && (
        <p className="onb-field-hint" aria-live="polite">
          {selected.size} selected
        </p>
      )}
    </div>
  )
}
