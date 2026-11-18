/** Terminal and recovery codes as XXXX-XXXX, whatever was typed or pasted (spaces, case, an extra dash). */
export function formatGroupedCode(raw: string) {
    const chars = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
    return chars.length > 4 ? `${chars.slice(0, 4)}-${chars.slice(4)}` : chars
}

/** "1:00", "0:05": the resend wait in the mono countdown. */
export function formatCountdown(seconds: number) {
    const s = Math.max(0, Math.floor(seconds))
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
