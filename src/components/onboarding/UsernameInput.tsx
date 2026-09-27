'use client'

import { useEffect, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Check, Loader2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { sanitizeUsernameInput } from '@/lib/validations/username'
import { type UsernameAvailabilityStatus, useUsernameAvailability } from '@/hooks/useUsernameAvailability'

interface UsernameInputProps {
    value: string
    onChange: (value: string) => void
    fullName?: string
    disabled?: boolean
    /** Disable availability and suggestion requests for local-only previews. */
    allowRemoteChecks?: boolean
    onStatusChange?: (status: UsernameAvailabilityStatus) => void
}

// Generate simple suggestions from name
function generateSuggestions(fullName: string): string[] {
    if (!fullName || fullName.trim().length === 0) return []

    const name = fullName.toLowerCase().trim()
    const parts = name.split(/\s+/)
    const firstName = parts[0] || ''
    const lastName = parts[parts.length - 1] || ''

    const suggestions: string[] = []

    if (firstName.length >= 3) {
        suggestions.push(firstName.replace(/[^a-z0-9]/g, ''))
    }

    if (firstName && lastName && lastName !== firstName) {
        const combined = `${firstName}${lastName}`.replace(/[^a-z0-9]/g, '')
        if (combined.length >= 3) suggestions.push(combined.slice(0, 20))

        const underscored = `${firstName}_${lastName}`.replace(/[^a-z0-9_]/g, '')
        if (underscored.length >= 3) suggestions.push(underscored.slice(0, 20))
    }

    return suggestions.slice(0, 3)
}

export default function UsernameInput({ value, onChange, fullName, disabled, allowRemoteChecks = true, onStatusChange }: UsernameInputProps) {
    const [suggestions, setSuggestions] = useState<string[]>([])
    const [showSuggestions, setShowSuggestions] = useState(false)
    const suggestionsRequestIdRef = useRef(0)
    const { status, message } = useUsernameAvailability({ value, enabled: !disabled && allowRemoteChecks })

    useEffect(() => {
        onStatusChange?.(status)
    }, [onStatusChange, status])

    // Generate suggestions from name (backend conflict-aware + local fallback).
    useEffect(() => {
        if (!allowRemoteChecks || !fullName || value) {
            if (!fullName) {
                setSuggestions([])
                setShowSuggestions(false)
            }
            if (value) setShowSuggestions(false)
            return
        }

        const sourceName = fullName
        const fallback = generateSuggestions(sourceName)
        const requestId = suggestionsRequestIdRef.current + 1
        suggestionsRequestIdRef.current = requestId
        let cancelled = false

        async function loadSuggestions() {
            try {
                const { getUsernameSuggestions } = await import('@/app/actions/onboarding')
                const response = await getUsernameSuggestions(sourceName)
                if (cancelled || requestId !== suggestionsRequestIdRef.current) return
                const merged = Array.from(
                    new Set([...(response.suggestions || []), ...fallback].filter((item): item is string => typeof item === 'string'))
                ).slice(0, 5)
                setSuggestions(merged)
                setShowSuggestions(merged.length > 0)
            } catch {
                if (cancelled || requestId !== suggestionsRequestIdRef.current) return
                setSuggestions(fallback)
                setShowSuggestions(fallback.length > 0)
            }
        }

        void loadSuggestions()

        return () => {
            cancelled = true
        }
    }, [allowRemoteChecks, fullName, value])

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newValue = sanitizeUsernameInput(e.target.value)
        onChange(newValue)
        setShowSuggestions(false)
    }

    const selectSuggestion = (suggestion: string) => {
        onChange(suggestion)
        setShowSuggestions(false)
    }

    return (
        <div className="onb-field">
            <label htmlFor="username" className="onb-field-label">
                Username <span className="onb-required">*</span>
            </label>
            <p id="username-rules" className="onb-field-hint">3–20 characters. Use letters, numbers, underscores, or hyphens.</p>

            <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-[13px] text-muted-foreground">
                    @
                </span>
                <Input
                    id="username"
                    type="text"
                    value={value}
                    onChange={handleInputChange}
                    disabled={disabled}
                    placeholder="yourname"
                    className={cn(
                        "onb-input pl-8 pr-10",
                        status === 'valid' && 'border-chart-3',
                        status === 'invalid' && 'onb-input--error'
                    )}
                    aria-invalid={status === 'invalid'}
                    aria-describedby={message ? 'username-status' : 'username-rules'}
                    maxLength={20}
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    {status === 'checking' && <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />}
                    {status === 'valid' && <Check className="w-4 h-4 text-chart-3" />}
                    {status === 'invalid' && <X className="w-4 h-4 text-destructive" />}
                    {status === 'error' && <X className="w-4 h-4 text-chart-5" />}
                </div>
            </div>

            {/* Status Message */}
            {message && (
                <p id="username-status" className={cn(
                    "onb-field-status",
                    status === 'checking' && 'text-muted-foreground',
                    status === 'valid' && 'text-chart-3',
                    status === 'invalid' && 'text-destructive',
                    status === 'error' && 'text-destructive'
                )} role={status === 'invalid' || status === 'error' ? 'alert' : 'status'} aria-live="polite">
                    {message}
                </p>
            )}

            {/* Suggestions */}
            {showSuggestions && suggestions.length > 0 && (
                <div className="space-y-2">
                    <p className="onb-section-kicker">Available suggestions</p>
                    <div className="flex flex-wrap gap-2">
                        {suggestions.map((suggestion) => (
                            <button
                                key={suggestion}
                                type="button"
                                onClick={() => selectSuggestion(suggestion)}
                                className="onb-focusable min-h-[44px] rounded-full border border-border bg-card px-3 py-1.5 text-[13px] text-foreground transition-colors hover:border-foreground/40 hover:bg-muted sm:min-h-0"
                            >
                                @{suggestion}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Character count */}
            <p className="font-mono text-[12px] text-muted-foreground">
                {value.length}/20 characters
            </p>
        </div>
    )
}
