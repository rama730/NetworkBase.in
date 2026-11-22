'use client'

import { useEffect, type RefObject } from 'react'

/**
 * The profile tab bar floats once it reaches its spot at the top of the route's scroll area (`data-stuck`), and the
 * person's photo and name glide into it once the band's name has scrolled away (`data-me`). Shared by My profile and
 * Edit profile. CSS does the drawing; this only sets the two attributes.
 */
export function useStickyBar(ref: RefObject<HTMLElement | null>, nameSelector = '[data-pf-name]') {
    useEffect(() => {
        const bar = ref.current
        if (!bar) return
        const root = bar.closest<HTMLElement>('[data-scroll-root="route"]')
        const target: HTMLElement | Window = root ?? window
        let frame = 0
        const update = () => {
            frame = 0
            const edge = (root ? root.getBoundingClientRect().top : 0) + (parseFloat(getComputedStyle(bar).top) || 0)
            const scrolled = root ? root.scrollTop : window.scrollY
            bar.toggleAttribute('data-stuck', scrolled > 40 && bar.getBoundingClientRect().top <= edge + 0.5)
            const name = document.querySelector(nameSelector)
            bar.toggleAttribute('data-me', !!name && name.getBoundingClientRect().bottom < edge - 8)
        }
        const schedule = () => { if (!frame) frame = requestAnimationFrame(update) }
        update()
        target.addEventListener('scroll', schedule, { passive: true })
        window.addEventListener('resize', schedule)
        return () => {
            if (frame) cancelAnimationFrame(frame)
            target.removeEventListener('scroll', schedule)
            window.removeEventListener('resize', schedule)
        }
    }, [ref, nameSelector])
}
