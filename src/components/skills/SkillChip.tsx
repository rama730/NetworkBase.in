'use client'

import { X } from '@/components/ui/icons'
import { cn } from '@/lib/utils'
import { resolveClientSkill, useSkillCatalog } from '@/lib/skills/client'
import type { SkillSummary } from '@/lib/skills/types'
import { SkillIcon } from './SkillIcon'

function skillSummary(input: SkillSummary | string) {
    return typeof input === 'string' ? resolveClientSkill(input) : input
}

export function SkillChip({
    skill: input,
    size = 'md',
    variant = 'default',
    onRemove,
    selected = false,
    className,
}: {
    skill: SkillSummary | string
    size?: 'sm' | 'md' | 'lg'
    variant?: 'default' | 'subtle' | 'required' | 'preferred'
    onRemove?: () => void
    selected?: boolean
    className?: string
}) {
    useSkillCatalog();
    const skill = skillSummary(input)
    const name = skill.name
    const iconSize = size === 'sm' ? 14 : size === 'lg' ? 18 : 16

    return (
        <span
            className={cn(
                'inline-flex min-w-0 max-w-full items-center rounded-sm border font-medium transition-colors',
                size === 'sm' && 'gap-1.5 px-2 py-1 text-xs',
                size === 'md' && 'gap-1.5 px-2 py-1 text-xs',
                size === 'lg' && 'gap-2.5 px-3 py-2 text-sm',
                variant === 'default' && 'border-border bg-card text-foreground',
                variant === 'subtle' && 'border-transparent bg-muted text-foreground',
                variant === 'required' && 'border-primary/30 bg-primary/10 text-primary',
                variant === 'preferred' && 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
                selected && 'border-primary ring-2 ring-primary/20',
                className,
            )}
            data-skill-key={skill.canonicalKey}
            title={skill.status === 'deprecated' ? `${skill.name} is deprecated` : undefined}
        >
            <SkillIcon skill={skill} size={iconSize} />
            <span className="truncate">{name}</span>
            {onRemove ? (
                <button
                    type="button"
                    onClick={onRemove}
                    className="nb-touch-target -mr-1 inline-flex min-h-6 min-w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-destructive focus-visible:bg-muted focus-visible:text-destructive focus-visible:outline-none"
                    aria-label={`Remove ${name}`}
                >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
            ) : null}
        </span>
    )
}
