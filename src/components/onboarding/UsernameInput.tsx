'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { sanitizeUsernameInput } from '@/lib/validations/username'
import { useUsernameAvailability } from '@/hooks/useUsernameAvailability'
import type { UsernameCheck } from '@/lib/onboarding/block-reason'
import { choiceChipClass } from '@/components/onboarding/ChipSelector'
import { PixelIcon, PixelSpinner } from '@/components/auth/pixel'

interface UsernameInputProps {
    value: string
    onChange: (value: string) => void
    /** Reports what the check last said and for which name. */
    onCheck: (check: UsernameCheck) => void
    /** A full name to suggest handles from. Empty means none. */
    suggestFor: string
    /** A refusal from the server when the step was saved (name taken in the meantime). */
    serverError?: string | null
}

/** Names the server has checked and found free, for a full name (or the typed handle). */
function useSuggestions(seed: string, wanted: boolean) {
    const [suggestions, setSuggestions] = useState<string[]>([])
    useEffect(() => {
        if (!seed || !wanted) {
            setSuggestions([])
            return
        }
        let cancelled = false
        void import('@/app/actions/onboarding')
            .then(({ getUsernameSuggestions }) => getUsernameSuggestions(seed))
            .then((response) => { if (!cancelled) setSuggestions(response.suggestions) })
            .catch(() => { if (!cancelled) setSuggestions([]) })
        return () => { cancelled = true }
    }, [seed, wanted])
    return suggestions
}

/**
 * The username, inside your future address: `networkbase.in/u/` + the name, one frame (the frame shows focus, the box
 * inside draws nothing, so no line between them). The check speaks in pixel marks; a taken name offers free ones to click.
 */
export default function UsernameInput({ value, onChange, onCheck, suggestFor, serverError }: UsernameInputProps) {
    const { status, message, checkedValue } = useUsernameAvailability({ value })

    useEffect(() => {
        onCheck({ username: checkedValue, status })
    }, [onCheck, checkedValue, status])

    const shownStatus = serverError ? 'invalid' : status
    const shownMessage = serverError || message
    const taken = shownStatus === 'invalid' && /taken|reserved/i.test(shownMessage)
    // While the field is empty: names from the full name. Once a name is taken: free ones close to it.
    const emptySuggestions = useSuggestions(suggestFor, !value)
    const takenSuggestions = useSuggestions(suggestFor || value, taken).filter((name) => name !== value).slice(0, 3)

    return (
        <div className="onb-field">
            <label htmlFor="username" className="onb-field-label">
                Username <span className="onb-required" aria-hidden="true">*</span>
                <span className="sr-only"> (required)</span>
            </label>
            <p id="username-rules" className="onb-field-hint">3–20 characters: letters, numbers and underscores.</p>

            <div className="nb-onb-prefix" data-state={shownStatus === 'invalid' ? 'invalid' : undefined}>
                <span aria-hidden="true">networkbase.in/u/</span>
                <input
                    id="username"
                    type="text"
                    value={value}
                    onChange={(event) => onChange(sanitizeUsernameInput(event.target.value))}
                    placeholder="yourname"
                    aria-invalid={shownStatus === 'invalid'}
                    aria-required="true"
                    aria-describedby="username-rules username-status"
                    maxLength={20}
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                />
            </div>

            {/* Always mounted so a screen reader announces each change once. */}
            <div id="username-status" aria-live="polite" className="nb-onb-ustatus" data-tone={shownStatus}>
                {shownStatus === 'checking' ? <><PixelSpinner />Checking networkbase.in/u/{value}</> : null}
                {shownStatus === 'valid' ? <><PixelIcon name="check" />networkbase.in/u/{value} is yours</> : null}
                {shownStatus === 'invalid' || shownStatus === 'error' ? <><PixelIcon name="cross" />{shownMessage}</> : null}
                {taken && takenSuggestions.length > 0 ? (
                    <span className="nb-onb-sugg">
                        Try
                        {takenSuggestions.map((name) => (
                            <button key={name} type="button" onClick={() => onChange(name)} aria-label={`Use ${name}`}>{name}</button>
                        ))}
                    </span>
                ) : null}
            </div>

            {emptySuggestions.length > 0 && !value ? (
                <div className="space-y-2">
                    <p className="onb-section-kicker" id="username-suggestions-label">Available names</p>
                    <div className="flex flex-wrap gap-2" role="group" aria-labelledby="username-suggestions-label">
                        {emptySuggestions.map((suggestion) => (
                            <button key={suggestion} type="button" onClick={() => onChange(suggestion)} className={cn(choiceChipClass(false), 'font-mono')}>
                                {suggestion}
                            </button>
                        ))}
                    </div>
                </div>
            ) : null}

            <p className="font-mono text-[12px] text-muted-foreground">{value.length}/20 characters</p>
        </div>
    )
}
