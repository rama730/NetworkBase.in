'use client'

import { ThemeProvider as NextThemesProvider, useTheme as useNextTheme } from 'next-themes'
import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { isProtectedAppRoute } from '@/lib/routing/route-class'
import {
    APPEARANCE_STORAGE_KEYS,
    type AccentColor,
    type AppearanceSnapshot,
    type Density,
    DEFAULT_APPEARANCE_SNAPSHOT,
    type ResolvedTheme,
    type ThemeMode,
    areAppearanceSnapshotsEquivalent,
    chooseAppearanceSync,
    createAppearanceSnapshot,
    normalizeThemeMode,
    readLocalAppearanceSnapshot,
    writeAppearanceSnapshot,
    isReducedMotionEnabled,
    prefersReducedMotionFromSystem,
} from '@/lib/theme/appearance'
import {
    type AppearanceSyncState,
    readAppearanceSettings,
    writeAppearanceSettings,
} from '@/lib/theme/appearance-client'

const REMOTE_SYNC_DEBOUNCE_MS = 900

interface ThemeContextValue {
    theme: ThemeMode;
    resolvedTheme: ResolvedTheme;
    setThemeWithTransition: (theme: ThemeMode) => Promise<void>;
}

interface AppearanceContextValue {
    accentColor: AccentColor;
    setAccentColor: (color: AccentColor) => void;
    density: Density;
    setDensity: (density: Density) => void;
    reduceMotion: boolean;
    setReduceMotion: (reduce: boolean) => void;
    syncState: AppearanceSyncState;
    lastSyncedAt?: string;
    resetAppearance: () => Promise<void>;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined)
const AppearanceContext = createContext<AppearanceContextValue | undefined>(undefined)

function safeStorageGet(key: string): string | null {
    try {
        if (typeof window !== 'undefined' && 'localStorage' in window && window.localStorage) {
            return window.localStorage.getItem(key)
        }
    } catch {}
    return null
}

function safeStorageSet(key: string, value: string): void {
    try {
        if (typeof window !== 'undefined' && 'localStorage' in window && window.localStorage) {
            window.localStorage.setItem(key, value)
        }
    } catch {}
}

function persistLocalSnapshot(snapshot: AppearanceSnapshot) {
    try {
        writeAppearanceSnapshot(snapshot, safeStorageSet)
    } catch {}
}

function syncedMarker(userId: string, snapshot: AppearanceSnapshot) {
    return `${userId}:${snapshot.updatedAt}`
}

function readSyncedMarker() {
    return safeStorageGet(APPEARANCE_STORAGE_KEYS.synced)
}

function writeSyncedMarker(value: string) {
    safeStorageSet(APPEARANCE_STORAGE_KEYS.synced, value)
}

function ensureThemeColorMeta(content: string) {
    try {
        if (typeof document === 'undefined' || !document.head) return
        let meta = document.querySelector('meta[data-app-theme-color="true"]') as HTMLMetaElement | null
        if (!meta) {
            meta = document.createElement('meta')
            meta.name = 'theme-color'
            meta.setAttribute('data-app-theme-color', 'true')
            document.head.appendChild(meta)
        }
        if (meta.content !== content) meta.content = content
    } catch {}
}

function ThemeRuntimeProvider({ children }: { children: ReactNode }) {
    const { theme: rawTheme, resolvedTheme: rawResolvedTheme, setTheme: setNextTheme } = useNextTheme()
    const theme = normalizeThemeMode(rawTheme, DEFAULT_APPEARANCE_SNAPSHOT.theme)
    const resolvedTheme: ResolvedTheme = rawResolvedTheme === 'dark' ? 'dark' : 'light'

    const [accentColor, setAccentColorState] = useState<AccentColor>(DEFAULT_APPEARANCE_SNAPSHOT.accentColor)
    const [density, setDensityState] = useState<Density>(DEFAULT_APPEARANCE_SNAPSHOT.density)
    const [reduceMotion, setReduceMotionState] = useState<boolean>(DEFAULT_APPEARANCE_SNAPSHOT.reduceMotion)
    const [systemReduceMotion, setSystemReduceMotion] = useState(false)
    const [viewerId, setViewerId] = useState<string | null>(null)
    const [syncState, setSyncState] = useState<AppearanceSyncState>('idle')
    const [lastSyncedAt, setLastSyncedAt] = useState<string | undefined>(undefined)

    const pendingSyncRef = useRef<AppearanceSnapshot | null>(null)
    const lastSyncedSnapshotRef = useRef<AppearanceSnapshot | null>(null)
    const syncInFlightRef = useRef(false)
    const syncTimerRef = useRef<number | null>(null)

    const flushRemoteSync = useCallback(async () => {
        const snapshot = pendingSyncRef.current
        if (!viewerId || syncInFlightRef.current || !snapshot) return
        syncInFlightRef.current = true
        pendingSyncRef.current = null
        setSyncState('saving')
        try {
            const result = await writeAppearanceSettings(snapshot)
            const saved = result.snapshot ?? snapshot
            if (result.remoteSynced) writeSyncedMarker(syncedMarker(viewerId, saved))
            lastSyncedSnapshotRef.current = saved
            setLastSyncedAt(saved.updatedAt)
            setSyncState('saved')
        } catch {
            setSyncState('save_failed')
        } finally {
            syncInFlightRef.current = false
            if (pendingSyncRef.current) queueMicrotask(() => void flushRemoteSync())
        }
    }, [viewerId])

    const commitSnapshot = useCallback((patch: Partial<AppearanceSnapshot>) => {
        const snapshot = createAppearanceSnapshot({
            theme: patch.theme ?? theme,
            accentColor: patch.accentColor ?? accentColor,
            density: patch.density ?? density,
            reduceMotion: patch.reduceMotion ?? reduceMotion,
            updatedAt: new Date().toISOString(),
        })
        persistLocalSnapshot(snapshot)
        if (!viewerId) return
        if (lastSyncedSnapshotRef.current && areAppearanceSnapshotsEquivalent(lastSyncedSnapshotRef.current, snapshot)) {
            pendingSyncRef.current = null
            setSyncState('saved')
            return
        }
        pendingSyncRef.current = snapshot
        setSyncState('saving')
        if (syncTimerRef.current !== null) window.clearTimeout(syncTimerRef.current)
        syncTimerRef.current = window.setTimeout(() => void flushRemoteSync(), REMOTE_SYNC_DEBOUNCE_MS)
    }, [accentColor, density, flushRemoteSync, reduceMotion, theme, viewerId])

    const applySnapshot = useCallback((snapshot: AppearanceSnapshot) => {
        setAccentColorState(snapshot.accentColor)
        setDensityState(snapshot.density)
        setReduceMotionState(snapshot.reduceMotion)
        setNextTheme(snapshot.theme)
        persistLocalSnapshot(snapshot)
    }, [setNextTheme])

    const setThemeWithTransition = useCallback(async (nextThemeInput: ThemeMode) => {
        const nextTheme = normalizeThemeMode(nextThemeInput, theme)
        if (nextTheme === theme) return
        commitSnapshot({ theme: nextTheme })
        const root = document.documentElement
        const startViewTransition = (document as Document & { startViewTransition?: (callback: () => void) => { finished: Promise<void> } }).startViewTransition?.bind(document)
        if (!startViewTransition || isReducedMotionEnabled({ root, matchMedia: window.matchMedia?.bind(window) })) {
            setNextTheme(nextTheme)
            return
        }
        root.classList.add('theme-transition')
        try {
            await startViewTransition(() => setNextTheme(nextTheme)).finished
        } catch {
            setNextTheme(nextTheme)
        } finally {
            window.setTimeout(() => root.classList.remove('theme-transition'), 220)
        }
    }, [commitSnapshot, setNextTheme, theme])

    const setAccentColor = useCallback((next: AccentColor) => {
        if (next === accentColor) return
        setAccentColorState(next)
        commitSnapshot({ accentColor: next })
    }, [accentColor, commitSnapshot])

    const setDensity = useCallback((next: Density) => {
        if (next === density) return
        setDensityState(next)
        commitSnapshot({ density: next })
    }, [commitSnapshot, density])

    const setReduceMotion = useCallback((next: boolean) => {
        if (next === reduceMotion) return
        setReduceMotionState(next)
        commitSnapshot({ reduceMotion: next })
    }, [commitSnapshot, reduceMotion])

    const resetAppearance = useCallback(async () => {
        const snapshot = createAppearanceSnapshot(DEFAULT_APPEARANCE_SNAPSHOT)
        applySnapshot(snapshot)
        commitSnapshot(snapshot)
    }, [applySnapshot, commitSnapshot])

    const effectiveReduceMotion = reduceMotion || systemReduceMotion

    useEffect(() => {
        const root = document.documentElement
        root.style.colorScheme = resolvedTheme
        root.setAttribute('data-theme-mode', theme)
        root.setAttribute('data-accent', accentColor)
        root.setAttribute('data-density', density)
        if (effectiveReduceMotion) root.setAttribute('data-reduce-motion', 'true')
        else root.removeAttribute('data-reduce-motion')
        ensureThemeColorMeta('#141A1E')
    }, [accentColor, density, effectiveReduceMotion, resolvedTheme, theme])

    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined
        const media = window.matchMedia('(prefers-reduced-motion: reduce)')
        const update = () => setSystemReduceMotion(prefersReducedMotionFromSystem(window.matchMedia?.bind(window)))
        update()
        if (typeof media?.addEventListener === 'function') {
            media.addEventListener('change', update)
            return () => {
                media.removeEventListener('change', update)
            }
        }
        if (typeof (media as unknown as { addListener?: (fn: () => void) => void })?.addListener === 'function') {
            const legacyMedia = media as unknown as { addListener: (fn: () => void) => void; removeListener: (fn: () => void) => void }
            legacyMedia.addListener(update)
            return () => {
                legacyMedia.removeListener(update)
            }
        }
        return undefined
    }, [])

    useEffect(() => {
        let cancelled = false
        const localSnapshot = readLocalAppearanceSnapshot(safeStorageGet)
        applySnapshot(localSnapshot)

        const bootstrapRemote = () => {
            if (!isProtectedAppRoute(window.location.pathname)) return
            readAppearanceSettings().then((result) => {
                if (cancelled || !result.userId) return
                const alreadySynced = readSyncedMarker() === syncedMarker(result.userId, localSnapshot)
                lastSyncedSnapshotRef.current = alreadySynced ? localSnapshot : result.snapshot
                const decision = chooseAppearanceSync(localSnapshot, result.snapshot, alreadySynced)
                if (decision === 'pull' && result.snapshot) {
                    applySnapshot(result.snapshot)
                    setLastSyncedAt(result.snapshot.updatedAt)
                    setSyncState('saved')
                } else if (decision === 'push') {
                    pendingSyncRef.current = localSnapshot
                }
                setViewerId(result.userId)
            }).catch(() => {})
        }
        const idle = window.requestIdleCallback?.(bootstrapRemote, { timeout: 1200 }) ?? window.setTimeout(bootstrapRemote, 250)
        return () => {
            cancelled = true
            if (window.cancelIdleCallback) window.cancelIdleCallback(idle)
            else window.clearTimeout(idle)
            if (syncTimerRef.current !== null) window.clearTimeout(syncTimerRef.current)
        }
    }, [applySnapshot])

    useEffect(() => {
        if (viewerId && pendingSyncRef.current) void flushRemoteSync()
    }, [flushRemoteSync, viewerId])

    const themeValue = useMemo<ThemeContextValue>(() => ({ theme, resolvedTheme, setThemeWithTransition }), [resolvedTheme, setThemeWithTransition, theme])
    const appearanceValue = useMemo<AppearanceContextValue>(() => ({
        accentColor,
        setAccentColor,
        density,
        setDensity,
        reduceMotion,
        setReduceMotion,
        syncState,
        lastSyncedAt,
        resetAppearance,
    }), [accentColor, density, lastSyncedAt, reduceMotion, resetAppearance, setAccentColor, setDensity, setReduceMotion, syncState])

    return (
        <ThemeContext.Provider value={themeValue}>
            <AppearanceContext.Provider value={appearanceValue}>
                {children}
            </AppearanceContext.Provider>
        </ThemeContext.Provider>
    )
}

export function ThemeProvider({ children, nonce }: { children: ReactNode; nonce?: string }) {
    return (
        <NextThemesProvider attribute="class" defaultTheme="system" enableSystem nonce={nonce}>
            <ThemeRuntimeProvider>{children}</ThemeRuntimeProvider>
        </NextThemesProvider>
    )
}

export function useTheme() {
    const context = useContext(ThemeContext)
    if (!context) throw new Error('useTheme must be used within a ThemeProvider')
    return context
}

export function useAppearance() {
    const context = useContext(AppearanceContext)
    if (!context) throw new Error('useAppearance must be used within a ThemeProvider')
    return context
}

export type { ThemeMode, ResolvedTheme, AccentColor, Density }
export { APPEARANCE_STORAGE_KEYS, DEFAULT_APPEARANCE_SNAPSHOT }
