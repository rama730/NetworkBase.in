'use client'

import { useEffect, useRef, useState } from 'react'

export const SKELETON_DELAY_MS = 300
export const SKELETON_MIN_MS = 400

/**
 * When a skeleton shows for a load that takes `answerMs`: never for a quick answer, otherwise from `delay` and for at
 * least `minVisible` (so it never flickers). Pure, so the rule is testable.
 */
export function delayedFlagTimeline(answerMs: number, { delay = SKELETON_DELAY_MS, minVisible = SKELETON_MIN_MS } = {}) {
    if (answerMs <= delay && delay > 0) return { shows: false, showAt: null, hideAt: answerMs }
    return { shows: true, showAt: delay, hideAt: Math.max(answerMs, delay + minVisible) }
}

/**
 * `loading` → whether to draw the skeleton now: false for the first 300 ms (a quick answer goes straight to content),
 * then true until loading ends, but never for less than 400 ms once shown.
 */
export function useDelayedFlag(loading: boolean, { delay = SKELETON_DELAY_MS, minVisible = SKELETON_MIN_MS } = {}) {
    const [shown, setShown] = useState(false)
    const shownAt = useRef(0)
    useEffect(() => {
        if (loading && !shown) {
            const timer = setTimeout(() => { shownAt.current = Date.now(); setShown(true) }, delay)
            return () => clearTimeout(timer)
        }
        if (!loading && shown) {
            const left = Math.max(0, minVisible - (Date.now() - shownAt.current))
            const timer = setTimeout(() => setShown(false), left)
            return () => clearTimeout(timer)
        }
        return undefined
    }, [loading, shown, delay, minVisible])
    return shown
}

/** True once `loading` has lasted `ms` (the quiet "still loading" line after 3 s). */
export function useSlowFlag(loading: boolean, ms = 3000) {
    const [slow, setSlow] = useState(false)
    useEffect(() => {
        if (!loading) { setSlow(false); return undefined }
        const timer = setTimeout(() => setSlow(true), ms)
        return () => clearTimeout(timer)
    }, [loading, ms])
    return slow
}
