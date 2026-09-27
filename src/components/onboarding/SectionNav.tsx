"use client"

import { cn } from "@/lib/utils"

export interface SectionNavItem {
  id: string
  label: string
}

export interface SectionNavProps {
  sections: SectionNavItem[]
  activeSection: string
  completedSections: Set<string>
  onSectionChange: (sectionId: string) => void
}

/**
 * Horizontal section navigation for switching within step two. It follows the
 * application's underlined-tab treatment with automatic activation and native
 * tab keyboard navigation. Each selected section exposes one labelled panel.
 *
 * Visual states:
 * - Active: primary underline and foreground text
 * - Completed: 4px primary dot before label
 * - Inactive: transparent background, muted-foreground text
 */
export function SectionNav({
  sections,
  activeSection,
  completedSections,
  onSectionChange,
}: SectionNavProps) {
  const navId = 'onb-details'

  const moveFocus = (currentIndex: number, direction: 1 | -1 | 'first' | 'last') => {
    const nextIndex = direction === 'first'
      ? 0
      : direction === 'last'
        ? sections.length - 1
        : (currentIndex + direction + sections.length) % sections.length
    const nextSection = sections[nextIndex]
    if (!nextSection) return
    onSectionChange(nextSection.id)
    window.requestAnimationFrame(() => {
      document.getElementById(`${navId}-${nextSection.id}`)?.focus()
    })
  }

  return (
    <div role="tablist" aria-label="Profile details sections" className="onb-tab-list -mx-1 flex overflow-x-auto px-1">
      {sections.map((section, index) => {
        const isActive = section.id === activeSection
        const isCompleted = completedSections.has(section.id) && !isActive

        return (
          <button
            key={section.id}
            id={`${navId}-${section.id}`}
            type="button"
            onClick={() => onSectionChange(section.id)}
            role="tab"
            aria-selected={isActive}
            aria-controls={`${navId}-${section.id}-panel`}
            tabIndex={isActive ? 0 : -1}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                event.preventDefault()
                moveFocus(index, 1)
              } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                event.preventDefault()
                moveFocus(index, -1)
              } else if (event.key === 'Home') {
                event.preventDefault()
                moveFocus(index, 'first')
              } else if (event.key === 'End') {
                event.preventDefault()
                moveFocus(index, 'last')
              }
            }}
            data-active={isActive}
            className={cn(
              "onb-tab onb-focusable inline-flex shrink-0 items-center gap-1.5 px-3.5 py-2 text-[13px] font-medium transition-[border-color,color] duration-[130ms]",
              "min-h-[44px] sm:min-h-[34px]",
              isActive && "font-medium",
              !isActive && "hover:text-foreground"
            )}
          >
            {isCompleted && (
              <span
                className="inline-block h-1 w-1 rounded-full bg-primary"
                aria-hidden="true"
              />
            )}
            {section.label}
          </button>
        )
      })}
    </div>
  )
}
