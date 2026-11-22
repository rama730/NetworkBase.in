'use client'

import { ArrowRight, Check, Globe, Loader2, Lock, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ProfileEditSection } from '@/lib/profile/edit-route'

export type ProfileChange = { key: string; label: string; section: ProfileEditSection; field: string; summary: string }

const SECTION_LABEL: Record<ProfileEditSection, string> = { general: 'Details', experience: 'Contributions', skills: 'Skills', social: 'Links', opportunity: 'Collaboration' }
export const sectionLabel = (section: ProfileEditSection) => SECTION_LABEL[section]

/** "ONLY YOU": the private details' tag, and the card's legend. */
export function OnlyYou() {
    return <span className="nb-pf-only-tag"><Lock className="size-2.5" aria-hidden="true" />Only you</span>
}

/**
 * Edit profile's right card (spec: Changes card): what is unsaved, each with its own undo; Save (⌘S), Reset and
 * Cancel; that contributions save on their own; the live completeness checklist; who sees what.
 */
export function ChangesCard({
    changes,
    state,
    error,
    blockReason,
    savedLabel,
    onJump,
    onUndo,
    onSave,
    onReset,
    onCancel,
    extra,
    contributionDrafts = 0,
    onOpenDrafts,
    completion,
}: {
    changes: ProfileChange[]
    state: 'idle' | 'saving' | 'success' | 'error'
    error?: string | null
    /** Why Save is off: the name is empty, the username is taken, and so on. */
    blockReason?: string | null
    savedLabel: string
    onJump: (section: ProfileEditSection, field: string) => void
    onUndo: (key: string) => void
    onSave: () => void
    onReset: () => void
    onCancel: () => void
    /** Conflict choices and similar, under the state line. */
    extra?: React.ReactNode
    contributionDrafts?: number
    onOpenDrafts?: () => void
    completion: { score: number; missing: string[]; jump: (item: string) => void }
}) {
    const n = changes.length
    const saving = state === 'saving'
    const head = saving ? <p className="nb-pf-state" aria-live="polite"><Loader2 className="size-3.5 animate-spin" />Saving changes…</p>
        : error ? <p className="nb-pf-state is-bad" role="alert">{error}</p>
            : n ? <p className="nb-pf-state" aria-live="polite"><i className="nb-pf-dot" />{n} unsaved change{n > 1 ? 's' : ''}</p>
                : <p className={state === 'success' ? 'nb-pf-state is-ok nb-pf-pop' : 'nb-pf-state is-ok'}><Check className="size-3.5" />{savedLabel}</p>
    return (
        <div className="nb-pf-panel nb-pf-facts" data-pf-changes>
            <section className="nb-pf-fsec" aria-labelledby="pf-changes-h">
                <div className="nb-pf-label"><h2 id="pf-changes-h" className="nb-pf-h">Changes</h2></div>
                {head}
                {extra}
                {n ? (
                    <ul className="nb-pf-chg">
                        {changes.map((c) => (
                            <li key={c.key}>
                                <button type="button" className="nb-pf-go" onClick={() => onJump(c.section, c.field)}>
                                    <span className="t"><b>{c.label}</b><i>{c.summary}</i></span><span className="s">{sectionLabel(c.section)}</span>
                                </button>
                                <button type="button" className="nb-pf-ib" onClick={() => onUndo(c.key)} aria-label={`Undo ${c.label}`} title="Undo this change"><Undo2 className="size-3.5" /></button>
                            </li>
                        ))}
                    </ul>
                ) : null}
                <div className="nb-pf-cta">
                    <Button type="button" onClick={onSave} disabled={saving || !n || Boolean(blockReason)}>
                        {saving ? <Loader2 className="size-4 animate-spin" /> : null}{error ? 'Try again' : 'Save changes'}<kbd className="nb-pf-kbd" aria-hidden="true">⌘S</kbd>
                    </Button>
                    {blockReason && n ? <p className="nb-pf-help is-bad">{blockReason}</p> : null}
                    <div className="nb-pf-row2">
                        <Button type="button" variant="ghost" onClick={onReset} disabled={saving || !n}>Reset</Button>
                        <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>{n ? 'Cancel' : 'Done'}</Button>
                    </div>
                </div>
                <div className="nb-pf-csep">
                    <Globe className="size-3.5" aria-hidden="true" /><span>Contributions save on their own</span>
                    {contributionDrafts && onOpenDrafts ? <button type="button" className="nb-pf-link" onClick={onOpenDrafts}>{contributionDrafts} draft{contributionDrafts > 1 ? 's' : ''} not published</button> : null}
                </div>
            </section>
            <section className="nb-pf-fsec" aria-labelledby="pf-cmp-h">
                <div className="nb-pf-label"><h2 id="pf-cmp-h" className="nb-pf-h">Profile completeness</h2><span className="nb-pf-pct">{completion.score}%</span></div>
                <div className="nb-pf-cmp" aria-hidden="true">{Array.from({ length: 10 }, (_, i) => <i key={i} className={i < Math.round(completion.score / 10) ? 'on' : undefined} />)}</div>
                {completion.missing.length ? (
                    <ul className="nb-pf-todo">
                        {completion.missing.map((item) => (
                            <li key={item}><button type="button" onClick={() => completion.jump(item)}><span className="box" aria-hidden="true" />{item}<ArrowRight className="go size-3" aria-hidden="true" /></button></li>
                        ))}
                    </ul>
                ) : <p className="nb-pf-state is-ok"><Check className="size-3.5" />Your profile is complete</p>}
            </section>
            <section className="nb-pf-fsec" aria-labelledby="pf-who-h">
                <div className="nb-pf-label"><h2 id="pf-who-h" className="nb-pf-h">Who sees this</h2></div>
                <p className="nb-pf-fnote">Everything here shows on your profile, except what’s marked <OnlyYou /></p>
            </section>
        </div>
    )
}

/** The phone save bar: how many, which sections, Reset and Save. */
export function PhoneSaveBar({ changes, saving, onReset, onSave }: { changes: ProfileChange[]; saving: boolean; onReset: () => void; onSave: () => void }) {
    if (!changes.length && !saving) return null
    const sections = [...new Set(changes.map((c) => sectionLabel(c.section)))]
    return (
        <div className="nb-pf-bar" role="region" aria-label="Save">
            <span className="nb-pf-state"><i className="nb-pf-dot" />{saving ? 'Saving…' : `${changes.length} unsaved`}<small>{sections.join(', ')}</small></span>
            <Button type="button" variant="ghost" onClick={onReset} disabled={saving}>Reset</Button>
            <Button type="button" onClick={onSave} disabled={saving}>Save</Button>
        </div>
    )
}
