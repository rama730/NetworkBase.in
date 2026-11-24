'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, Copy } from '@/components/ui/icons'
import { COPY_FAILED, copyText } from '@/lib/clipboard'
import type { AuthPanelContent, PanelOutcome } from '@/components/auth/auth-panels'

const INSTALL = 'npm i -g @networkbase/cli && nb login'
type Trail = { replay(): void; refresh(): void; destroy(): void }

/** Types a new path in: erases back to what the old and new share, then types the rest. Instant under reduced motion. */
export function useTypedPath(path: string, stepMs = 28) {
    const [shown, setShown] = useState(path)
    const shownRef = useRef(path)
    useEffect(() => {
        const from = shownRef.current
        if (from === path) return
        const set = (text: string) => { shownRef.current = text; setShown(text) }
        if (matchMedia('(prefers-reduced-motion: reduce)').matches) return set(path)
        let keep = 0
        while (keep < from.length && from[keep] === path[keep]) keep++
        let text = from, erasing = true
        const timer = setInterval(() => {
            if (erasing && text.length > keep) text = text.slice(0, -1)
            else if ((erasing = false, text.length < path.length)) text = path.slice(0, text.length + 1)
            else return clearInterval(timer)
            set(text)
        }, stepMs)
        return () => { clearInterval(timer); set(path) }
    }, [path, stepMs])
    return shown
}

function LoginChip() {
    const [label, setLabel] = useState<'idle' | 'copied' | 'failed'>('idle')
    useEffect(() => {
        if (label === 'idle') return
        const timer = setTimeout(() => setLabel('idle'), 2000)
        return () => clearTimeout(timer)
    }, [label])
    return (
        <div className="nb-auth-chip">
            <code><span>$</span> nb login</code>
            <button
                type="button"
                className="nb-auth-chip-copy"
                title={label === 'copied' ? `Copied: ${INSTALL}` : label === 'failed' ? COPY_FAILED : `Copy: ${INSTALL}`}
                aria-label={label === 'copied' ? 'Copied the install and sign-in command' : 'Copy the install and sign-in command'}
                onClick={() => void copyText(INSTALL).then(() => setLabel('copied'), () => setLabel('failed'))}
            >
                {label === 'copied' ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
            </button>
        </div>
    )
}

/**
 * The ink panel (wide screens only): the typed path, a pixel word whose orange full stop flies in, the serif headline and,
 * on sign in, the `$ nb login` chip. The grid engine loads only where the panel shows, so phones never download it.
 */
export function AuthPanel({ panel, outcome, route, extra }: { panel: AuthPanelContent; outcome?: PanelOutcome; route?: string; extra?: ReactNode }) {
    const ref = useRef<HTMLElement | null>(null)
    const trail = useRef<Trail | null>(null)
    const word = outcome?.word ?? panel.word
    const path = useTypedPath(route ?? panel.route)

    useEffect(() => {
        const wide = matchMedia('(min-width: 1024px)')
        let gone = false
        const start = () => {
            if (trail.current || !wide.matches) return
            void import('@/lib/grid-trail').then(({ attachGridTrail }) => {
                if (gone || trail.current || !ref.current) return
                trail.current = attachGridTrail(ref.current, 'hero')
                void document.fonts?.ready.then(() => trail.current?.refresh())
            })
        }
        start()
        wide.addEventListener('change', start)
        return () => { gone = true; wide.removeEventListener('change', start); trail.current?.destroy(); trail.current = null }
    }, [])
    // A new word (another screen, or a finished one) is drawn again, and its full stop flies in again.
    const lastWord = useRef(word)
    useEffect(() => {
        if (lastWord.current === word) return
        lastWord.current = word
        trail.current?.replay()
    }, [word])

    return (
        <aside ref={ref} className="nb-auth-panel" data-pixel-word={word} data-trail-script={panel.script.join('|')} aria-label="About NetworkBase">
            <p className="nb-auth-path" aria-hidden="true"><span>networkbase /</span><b>{path}</b><span className="nb-auth-caret" /></p>
            <div className="nb-auth-panel-mid">
                <div className="nb-auth-word-slot" data-pixel-slot="" aria-hidden="true" />
                <p className="nb-auth-panel-title">{outcome?.title ?? panel.title}</p>
                {extra}
            </div>
            <div className="nb-auth-panel-foot">
                <span>NetworkBase / Build together</span>
                {panel.chip ? <LoginChip /> : null}
            </div>
        </aside>
    )
}

/** The terminal's own screen, mirrored in the panel so people can compare the code at a glance. */
export function TerminalMirror({ code, done = false, email }: { code: string; done?: boolean; email?: string | null }) {
    return (
        <div className="nb-auth-term">
            <div className="nb-auth-term-bar" aria-hidden="true"><i /><i /><i /></div>
            <pre>
                <span className="nb-auth-term-prompt">$</span> <span className="nb-auth-term-you">nb login --device</span>{'\n'}
                Open networkbase.in/device{'\n'}
                and enter {done ? code : <mark>{code}</mark>}{'\n'}
                {done ? `✓ Signed in${email ? ` as ${email}` : ''}` : 'Waiting for approval…'}
            </pre>
        </div>
    )
}
