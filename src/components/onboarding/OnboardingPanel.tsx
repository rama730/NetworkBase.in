'use client'

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useTypedPath } from '@/components/auth/AuthPanel'
import { PixelIcon } from '@/components/auth/pixel'
import { PixelPerson } from '@/components/ui/PixelPerson'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { VISIBILITY_CHOICES } from '@/lib/onboarding/contracts'
import type { OnboardingData } from '@/lib/onboarding/form-data'
import { STEP_UI_CONFIG } from '@/lib/onboarding/step-ui-config'
import { EXPERIENCE_LEVEL_OPTIONS, ROLE_PREFERENCE_OPTIONS, WEEKLY_CAPACITY_OPTIONS } from '@/lib/profile/role-preferences'
import { cn } from '@/lib/utils'

export type CardData = Pick<
    OnboardingData,
    'fullName' | 'username' | 'avatarUrl' | 'headline' | 'experienceLevel' | 'hoursPerWeek' | 'location' | 'openTo' | 'skills' | 'visibility' | 'messagePrivacy'
>
type Trail = { replay(): void; refresh(): void; destroy(): void }

export const firstNameOf = (fullName: string) => fullName.trim().split(/\s+/)[0] ?? ''
const reducedMotion = () => typeof window !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** The person's face: their photo, or their pixel person. The colours come from the user id, as everywhere else. */
export function Face({ avatarUrl, identityKey, size, pop = false }: { avatarUrl: string; identityKey: string; size: number; pop?: boolean }) {
    return avatarUrl
        ? <img src={avatarUrl} alt="" className="size-full object-cover" />
        : <PixelPerson identityKey={identityKey} size={size} pop={pop} />
}

// ---- quiet live updates: text changes as you type; a part settles in (fade, 3px, in ink) only when it first mounts after
// the card is on screen, i.e. when it goes from empty to filled or back. Nothing flashes, nothing is coloured.
const LiveRef = createContext<{ current: boolean }>({ current: false })

function Settle({ as: Tag = 'span', className, children }: { as?: 'span' | 'p' | 'div'; className?: string; children: ReactNode }) {
    const live = useContext(LiveRef)
    const [settle] = useState(() => live.current)
    return <Tag className={cn(className, settle && 'nb-onb-settle')}>{children}</Tag>
}

const Ghost = ({ width }: { width: number }) => <span className="nb-onb-ghost" style={{ width }} />

/** Names that just left the list stay a moment longer, fading out, so a removed skill doesn't vanish mid-sentence. */
function useLeaving(list: string[]) {
    const [leaving, setLeaving] = useState<string[]>([])
    const previous = useRef(list)
    useEffect(() => {
        const removed = previous.current.filter((item) => !list.includes(item))
        previous.current = list
        if (removed.length === 0 || reducedMotion()) return
        setLeaving((current) => [...current, ...removed])
        const timer = setTimeout(() => setLeaving((current) => current.filter((item) => !removed.includes(item))), 160)
        return () => clearTimeout(timer)
    }, [list])
    return leaving.filter((item) => !list.includes(item))
}

const labelOf = (options: ReadonlyArray<{ value: string; label: string }>, value: string) => options.find((option) => option.value === value)?.label ?? ''

/** What people see in Discover, built as you type. Private shows the limited shell; the actions follow your privacy choices. */
export function OnboardingCard({ data, identityKey }: { data: CardData; identityKey: string }) {
    const live = useRef(false)
    useEffect(() => { live.current = true }, [])
    const skills = data.skills.slice(0, 6)
    const leaving = useLeaving(skills)
    const shell = data.visibility === 'private'
    const hours = WEEKLY_CAPACITY_OPTIONS.find((option) => option.value === data.hoursPerWeek)?.compactLabel ?? ''
    const openTo = data.openTo.map((value) => labelOf(ROLE_PREFERENCE_OPTIONS, value) || value).join(', ').toLowerCase()
    // Keyed by empty or filled: the part remounts (and settles in) only when that flips.
    const slot = (id: string, value: string, empty: ReactNode, className?: string, as?: 'span' | 'p') => (
        <Settle key={`${id}:${value ? 1 : 0}`} as={as} className={className}>{value || empty}</Settle>
    )

    return (
        <LiveRef.Provider value={live}>
            <Settle key={shell ? 'shell' : 'full'} as="div" className={cn('nb-onb-card', shell && 'nb-onb-card--shell')}>
                <div className="nb-onb-card-top">
                    <Settle key={data.avatarUrl || 'pixel'} className="nb-onb-card-face"><Face avatarUrl={data.avatarUrl} identityKey={identityKey} size={45} /></Settle>
                    <span className="nb-onb-card-who">
                        {slot('name', data.fullName.trim(), <Ghost width={140} />, 'nb-onb-card-name')}
                        {slot('handle', data.username ? `@${data.username}` : '', <Ghost width={80} />, 'nb-onb-card-handle')}
                    </span>
                    <Settle key={data.visibility} className="nb-onb-card-vis">{labelOf(VISIBILITY_CHOICES, data.visibility)}</Settle>
                </div>
                {shell ? (
                    <p className="nb-onb-card-line">Limited profile. Hidden from Discovery and people search.</p>
                ) : (
                    <>
                        {slot('headline', data.headline.trim(), <Ghost width={220} />, 'nb-onb-card-line', 'p')}
                        <div className="nb-onb-card-meta">
                            {slot('level', labelOf(EXPERIENCE_LEVEL_OPTIONS, data.experienceLevel), 'Level —')}
                            {slot('hours', hours, 'Time —')}
                            {slot('location', data.location.trim(), 'Location —')}
                            {openTo ? <Settle key="open">Open to {openTo}</Settle> : null}
                        </div>
                        <div className="nb-onb-card-tags">
                            {skills.length === 0 && leaving.length === 0
                                ? <Settle key="ghosts"><Ghost width={48} /> <Ghost width={64} /> <Ghost width={40} /></Settle>
                                : null}
                            {skills.map((skill) => <Settle key={skill} className="nb-onb-card-tag">{skill}</Settle>)}
                            {leaving.map((skill) => <span key={`gone:${skill}`} className="nb-onb-card-tag nb-onb-leave">{skill}</span>)}
                        </div>
                        <Settle key={`${data.visibility}:${data.messagePrivacy}`} as="div" className="nb-onb-card-act">
                            {data.visibility === 'connections' ? (
                                <span className="nb-onb-card-note"><PixelIcon name="lock" />Full profile opens for connections</span>
                            ) : (
                                <>
                                    <span className="nb-onb-cbtn nb-onb-cbtn--solid">Connect</span>
                                    {data.messagePrivacy === 'everyone'
                                        ? <span className="nb-onb-cbtn">Message</span>
                                        : <span className="nb-onb-cbtn nb-onb-cbtn--locked"><PixelIcon name="lock" />Message · connections only</span>}
                                </>
                            )}
                        </Settle>
                    </>
                )}
            </Settle>
        </LiveRef.Provider>
    )
}

function useDebounced<T>(value: T, ms: number) {
    const [shown, setShown] = useState(value)
    useEffect(() => {
        const timer = setTimeout(() => setShown(value), ms)
        return () => clearTimeout(timer)
    }, [value, ms])
    return shown
}

/**
 * The ink panel (wide screens only): the address types itself, your avatar sits on the grid, the serif headline greets you
 * (retyped once you pause, never per key) and your Discover card fills in. The grid engine loads only where the panel shows.
 */
export function OnboardingPanel({ data, identityKey, step, greeting }: { data: CardData; identityKey: string; step: number; greeting?: string | null }) {
    const ref = useRef<HTMLElement | null>(null)
    const face = useRef<HTMLSpanElement | null>(null)
    const trail = useRef<Trail | null>(null)
    const path = useTypedPath(data.username ? `u/${data.username}` : 'onboarding', 26)
    const first = useDebounced(firstNameOf(data.fullName), 450)
    const title = useTypedPath(greeting ?? STEP_UI_CONFIG[step - 1]!.panelTitle(first), 18)
    const photo = Boolean(data.avatarUrl)

    useEffect(() => {
        const wide = matchMedia('(min-width: 1024px)')
        let gone = false
        // Your avatar sits on the panel's grid lines, like the pixel words do (the engine sets the grid's offset).
        const snap = () => {
            const panel = ref.current, me = face.current
            if (!panel || !me) return
            me.style.transform = ''
            const style = getComputedStyle(panel)
            const gx = parseFloat(style.getPropertyValue('--gx')) || 0, gy = parseFloat(style.getPropertyValue('--gy')) || 0
            const outer = panel.getBoundingClientRect(), inner = me.getBoundingClientRect()
            const x = inner.left - outer.left - gx, y = inner.top - outer.top - gy
            me.style.transform = `translate(${Math.round(x / 16) * 16 - x}px, ${Math.round(y / 16) * 16 - y}px)`
        }
        const start = () => {
            if (trail.current || !wide.matches) return
            void import('@/lib/grid-trail').then(({ attachGridTrail }) => {
                if (gone || trail.current || !ref.current) return
                trail.current = attachGridTrail(ref.current, 'hero')
                requestAnimationFrame(snap)
                void document.fonts?.ready.then(() => { trail.current?.refresh(); snap() })
            })
        }
        start()
        const observer = new ResizeObserver(() => requestAnimationFrame(snap))
        if (ref.current) observer.observe(ref.current)
        wide.addEventListener('change', start)
        return () => { gone = true; observer.disconnect(); wide.removeEventListener('change', start); trail.current?.destroy(); trail.current = null }
    }, [])

    return (
        <aside ref={ref} className="nb-auth-panel nb-onb-panel" data-trail-script="nb init|nb whoami|nb next" aria-label="Your profile, as people will see it">
            <p className="nb-auth-path" aria-hidden="true"><span>networkbase /</span><b>{path}</b><span className="nb-auth-caret" /></p>
            <div className="nb-auth-panel-mid nb-onb-panel-mid">
                <div className="nb-onb-me" aria-hidden="true">
                    <span ref={face} key={data.avatarUrl || 'pixel'} className="nb-onb-me-face"><Face avatarUrl={data.avatarUrl} identityKey={identityKey} size={144} pop /></span>
                    <span className="nb-onb-me-cap">
                        <b>{photo ? 'Your photo' : 'Your pixel person'}</b>
                        <span>{photo ? 'Cropped square, shown everywhere' : 'Yours until you add a photo'}</span>
                    </span>
                </div>
                <p className="nb-auth-panel-title nb-onb-panel-title" aria-hidden="true">{title}</p>
                <div aria-hidden="true"><OnboardingCard data={data} identityKey={identityKey} /></div>
            </div>
            <div className="nb-auth-panel-foot">
                <span>{data.visibility === 'private' ? 'What others see' : 'Your card in Discover'}</span>
                <span>NetworkBase / Build together</span>
            </div>
        </aside>
    )
}

/** Phones and tablets: the card opens as a sheet from the top bar's Preview button. */
export function PreviewSheet({ open, onOpenChange, data, identityKey }: { open: boolean; onOpenChange: (open: boolean) => void; data: CardData; identityKey: string }) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent presentation="bottom-sheet" className="nb-onb-sheet">
                <DialogTitle className="nb-onb-sheet-title">{data.visibility === 'private' ? 'What others see' : 'Your card in Discover'}</DialogTitle>
                <OnboardingCard data={data} identityKey={identityKey} />
            </DialogContent>
        </Dialog>
    )
}
