'use client'

import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import { useStickyBar } from './useStickyBar'
import { TabMarker } from '@/components/ui/TabMarker'
import { padCount } from '@/lib/ui/tab-marker'

export type ProfileTabBarTab<K extends string> = { key: K; label: string; count?: number; dirty?: boolean }

/**
 * One tab bar for My profile and Edit profile: attached under the band, then floating with rounded corners. When it
 * floats past the band's name, it carries the person and the page's main action.
 */
export function ProfileTabBar<K extends string>({
    tabs,
    value,
    onChange,
    onIntent,
    identity,
    action,
    label,
    idPrefix,
}: {
    tabs: ProfileTabBarTab<K>[]
    value: K
    onChange: (next: K) => void
    onIntent?: (next: K) => void
    identity: { name: string; avatar: ReactNode }
    action?: ReactNode
    label: string
    idPrefix: string
}) {
    const ref = useRef<HTMLDivElement>(null)
    useStickyBar(ref)
    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
        event.preventDefault()
        const focused = tabs.findIndex((t) => (event.target as HTMLElement).id === `${idPrefix}-tab-${t.key}`)
        const i = focused >= 0 ? focused : tabs.findIndex((t) => t.key === value)
        const next = tabs[(i + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]!
        onChange(next.key)
        requestAnimationFrame(() => document.getElementById(`${idPrefix}-tab-${next.key}`)?.focus())
    }
    return (
        <div ref={ref} className="nb-pf-tabwrap" data-pf-tabbar>
            <div className="nb-pf-tabbar">
                <div className="nb-pf-tb">
                    <span className="nb-pf-tb-me" aria-hidden="true">
                        <span className="nb-pf-pic">{identity.avatar}</span>
                        <b>{identity.name}</b>
                    </span>
                    <div className="nb-pf-tabs" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
                        {tabs.map((tab) => (
                            <button
                                key={tab.key}
                                id={`${idPrefix}-tab-${tab.key}`}
                                role="tab"
                                type="button"
                                className="nb-pf-tab"
                                aria-selected={tab.key === value}
                                aria-controls={`${idPrefix}-panel-${tab.key}`}
                                tabIndex={tab.key === value ? 0 : -1}
                                onClick={() => onChange(tab.key)}
                                onPointerEnter={() => onIntent?.(tab.key)}
                                onFocus={() => onIntent?.(tab.key)}
                            >
                                {tab.label}
                                {tab.count != null ? <span className="n"><span aria-hidden="true">{padCount(tab.count)}</span><span className="sr-only">{tab.count}</span></span> : null}
                                {tab.dirty ? <i className="dot" title="Unsaved changes" aria-label="Unsaved changes" /> : null}
                            </button>
                        ))}
                        <TabMarker />
                    </div>
                    {action ? <span className="nb-pf-tb-act">{action}</span> : null}
                </div>
            </div>
        </div>
    )
}
