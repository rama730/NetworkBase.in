import { memo, type CSSProperties } from 'react'
import { cn } from '@/lib/utils'
import { GENERATED_SKILL_ICON_THEME_ASSET_VARIANTS } from '@/lib/skills/generated-icon-theme-variants'
import { resolveSkillIconThemeVariant, SKILL_ICON_THEME_VARIANTS } from '@/lib/skills/icon-theme-policy'
import { hasSkillIcon } from '@/lib/skills/icon-policy'
import type { SkillSummary } from '@/lib/skills/types'

function iconUrl(iconKey: string): string {
    return `/skill-icons/v1/${/\.(?:svg|png|jpe?g|webp)$/i.test(iconKey) ? iconKey : `${iconKey}.svg`}`
}

function maskStyle(url: string, size: number, color: string): CSSProperties {
    const mask = `url(${url}) center / contain no-repeat`
    return { width: size, height: size, backgroundColor: color, mask, WebkitMask: mask }
}

export const SkillIcon = memo(function SkillIcon({
    skill,
    size = 16,
    className,
    colorMode = 'brand',
    decorative = true,
}: {
    skill: SkillSummary
    size?: number
    className?: string
    colorMode?: 'brand' | 'current'
    decorative?: boolean
}) {
    const labelProps = decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': skill.name }

    if (!hasSkillIcon(skill)) return null

    const iconKey = skill.iconKey!
    const assetVariant = colorMode === 'brand'
        ? GENERATED_SKILL_ICON_THEME_ASSET_VARIANTS[iconKey as keyof typeof GENERATED_SKILL_ICON_THEME_ASSET_VARIANTS]
        : undefined

    if (assetVariant) {
        return (
            <span {...labelProps} className={cn('relative inline-block shrink-0', className)} style={{ width: size, height: size }}>
                <img src={iconUrl(assetVariant.lightIconKey)} alt="" width={size} height={size} loading="lazy" decoding="async" className="absolute inset-0 dark:hidden" />
                <img src={iconUrl(assetVariant.darkIconKey)} alt="" width={size} height={size} loading="lazy" decoding="async" className="absolute inset-0 hidden dark:block" />
            </span>
        )
    }

    const themeVariant = colorMode === 'brand' ? resolveSkillIconThemeVariant(skill) : undefined
    if (themeVariant) {
        return (
            <span {...labelProps} className={cn('relative inline-block shrink-0', className)} style={{ width: size, height: size }}>
                <span className="absolute inset-0 dark:hidden" style={maskStyle(iconUrl(iconKey), size, themeVariant.lightColor)} />
                <span className="absolute inset-0 hidden dark:block" style={maskStyle(iconUrl(iconKey), size, themeVariant.darkColor)} />
            </span>
        )
    }

    if (skill.iconSource === 'simple-icons' || iconKey in SKILL_ICON_THEME_VARIANTS) {
        const color = colorMode === 'brand' && skill.brandColor ? skill.brandColor : 'currentColor'
        return <span {...labelProps} className={cn('inline-block shrink-0', className)} style={maskStyle(iconUrl(iconKey), size, color)} />
    }

    return (
        <img
            src={iconUrl(iconKey)}
            alt={decorative ? '' : skill.name}
            aria-hidden={decorative || undefined}
            width={size}
            height={size}
            loading="lazy"
            decoding="async"
            className={cn('inline-block shrink-0', className)}
        />
    )
})
