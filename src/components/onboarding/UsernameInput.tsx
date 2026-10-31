'use client'

import { useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Check, Loader2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { sanitizeUsernameInput } from '@/lib/validations/username'
import { useUsernameAvailability } from '@/hooks/useUsernameAvailability'
import type { UsernameCheck } from '@/lib/onboarding/block-reason'
import { choiceChipClass } from '@/components/onboarding/ChipSelector'

interface UsernameInputProps {
    value: string
    onChange: (value: string) => void
    /** Reports what the check last said and for which name. */
    onCheck: (check: UsernameCheck) => void
    /** A full name to suggest handles from. Empty means none; suggestions only show while the field is empty. */
    suggestFor: string
    /** A refusal from the server when the step was saved (name taken in the meantime). */
    serverError?: string | null
}

export default function UsernameInput({ value, onChange, onCheck, suggestFor, serverError }: UsernameInputProps) {
    const [suggestions, setSuggestions] = useState<string[]>([])
    const { status, message, checkedValue } = useUsernameAvailability({ value })

    useEffect(() => {
        onCheck({ username: checkedValue, status })
    }, [onCheck, checkedValue, status])

    // Names the server has checked and found free. Asked for once, when the person leaves the name field.
    useEffect(() => {
        if (!suggestFor || value) {
            setSuggestions([])
            return
        }
        let cancelled = false
        void import('@/app/actions/onboarding')
            .then(({ getUsernameSuggestions }) => getUsernameSuggestions(suggestFor))
            .then((response) => {
                if (!cancelled) setSuggestions(response.suggestions)
            })
            .catch(() => {
                if (!cancelled) setSuggestions([])
            })
        return () => {
            cancelled = true
        }
    }, [suggestFor, value])

    const shownStatus = serverError ? 'invalid' : status
    const shownMessage = serverError || message

    return (
        <div className="onb-field">
            <label htmlFor="username" className="onb-field-label">
                Username <span className="onb-required" aria-hidden="true">*</span>
                <span className="sr-only"> (required)</span>
            </label>
            <p id="username-rules" className="onb-field-hint">3–20 characters: letters, numbers and underscores.</p>

            <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-[13px] text-muted-foreground" aria-hidden="true">@</span>
                <Input
                    id="username"
                    type="text"
                    value={value}
                    onChange={(event) => onChange(sanitizeUsernameInput(event.target.value))}
                    placeholder="yourname"
                    className={cn('onb-input pl-8 pr-10', shownStatus === 'valid' && 'border-chart-3', shownStatus === 'invalid' && 'onb-input--error')}
                    aria-invalid={shownStatus === 'invalid'}
                    aria-required="true"
                    aria-describedby="username-rules username-status"
                    maxLength={20}
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2" aria-hidden="true">
                    {shownStatus === 'checking' && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                    {shownStatus === 'valid' && <Check className="h-4 w-4 text-chart-3" />}
                    {shownStatus === 'invalid' && <X className="h-4 w-4 text-destructive" />}
                    {shownStatus === 'error' && <X className="h-4 w-4 text-chart-5" />}
                </div>
            </div>

            {/* Always mounted so a screen reader announces each change once. */}
            <p
                id="username-status"
                aria-live="polite"
                className={cn(
                    'onb-field-status min-h-[1.5em]',
                    shownStatus === 'valid' && 'text-chart-3',
                    (shownStatus === 'invalid' || shownStatus === 'error') && 'text-destructive',
                )}
            >
                {shownMessage}
            </p>

            {suggestions.length > 0 && (
                <div className="space-y-2">
                    <p className="onb-section-kicker" id="username-suggestions-label">Available names</p>
                    <div className="flex flex-wrap gap-2" role="group" aria-labelledby="username-suggestions-label">
                        {suggestions.map((suggestion) => (
                            <button
                                key={suggestion}
                                type="button"
                                onClick={() => onChange(suggestion)}
                                className={choiceChipClass(false)}
                            >
                                @{suggestion}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            <p className="font-mono text-[12px] text-muted-foreground">{value.length}/20 characters</p>
        </div>
    )
}
