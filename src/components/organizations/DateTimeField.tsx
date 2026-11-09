'use client'

import { useEffect, useMemo, useState } from 'react'

import { inputClassName, QuickChips, selectClassName, SelectWrap } from '@/components/workspaces/v2/tasks/form-parts'
import { cn } from '@/lib/utils'
import { addDaysToDay, DEFAULT_DUE_TIME, describeLocal, nextWeekday, timeLabel, TIME_OPTIONS, todayInZone, zoneName } from '@/lib/organizations/zoned-time'

// Assignment form redesign (2026-11-09): one date-and-time field for every organization form. Pick a day and the
// time is already there; the line under it says what was picked, how far away, and in which zone.

export type DatePreset = { label: string; day: string; time?: string }

export function DateTimeField({ id, value, onChange, timeZone, defaultTime = DEFAULT_DUE_TIME, presets = [], presetsLabel = 'Quick dates', summary = 'Due', min, disabled = false, hasError = false, className, ...aria }: {
    id?: string
    /** "YYYY-MM-DDTHH:MM" in the organization's zone, or "" for none. */
    value: string
    onChange: (local: string) => void
    timeZone: string | null | undefined
    defaultTime?: string
    presets?: DatePreset[]
    presetsLabel?: string
    /** The summary line's first word: "Due Sat 14 Nov, 11:59 PM · in 5 days". */
    summary?: string
    min?: string
    disabled?: boolean
    hasError?: boolean
    className?: string
    'aria-invalid'?: boolean
    'aria-describedby'?: string
    'aria-label'?: string
}) {
    const day = value.slice(0, 10)
    const [pickedTime, setPickedTime] = useState(value.slice(11, 16) || defaultTime)
    // The organization's due time arrives after the form opens; an empty field takes it.
    useEffect(() => { if (!value) setPickedTime(defaultTime) }, [defaultTime])
    const time = value.slice(11, 16) || pickedTime
    const times = TIME_OPTIONS.includes(time) ? TIME_OPTIONS : [...TIME_OPTIONS, time].sort()
    const viewerZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, [])
    const said = value ? describeLocal(value, timeZone, viewerZone) : null
    const label = aria['aria-label'] ?? summary
    return (
        <div className={cn('space-y-1.5', className)}>
            <div className="grid grid-cols-[minmax(0,1fr)_8.5rem] gap-2">
                <input id={id} type="date" value={day} min={min} disabled={disabled} aria-label={`${label}, date`}
                    aria-invalid={aria['aria-invalid']} aria-describedby={aria['aria-describedby']}
                    onChange={(e) => onChange(e.target.value ? `${e.target.value}T${time}` : '')}
                    className={cn('nb-touch-target h-[34px] font-mono', inputClassName(hasError))} />
                <SelectWrap>
                    <select value={time} disabled={disabled} aria-label={`${label}, time`} className={cn('nb-select nb-touch-target', selectClassName())}
                        onChange={(e) => { setPickedTime(e.target.value); if (day) onChange(`${day}T${e.target.value}`) }}>
                        {times.map((t) => <option key={t} value={t}>{timeLabel(t)}</option>)}
                    </select>
                </SelectWrap>
            </div>
            {presets.length && !disabled ? (
                <QuickChips label={presetsLabel} items={presets.map((p) => {
                    const at = `${p.day}T${p.time ?? time}`
                    return { label: p.label, active: value === at, disabled: Boolean(min && p.day < min), onClick: () => { if (p.time) setPickedTime(p.time); onChange(at) } }
                })} />
            ) : null}
            {said ? (
                <p className="text-xs text-muted-foreground" aria-live="polite">
                    {summary} {said.text} · {said.relative}{timeZone ? ` · ${zoneName(timeZone)}` : ''}{said.yourTime ? ` · ${said.yourTime} your time` : ''}
                </p>
            ) : null}
        </div>
    )
}

/** Tomorrow, 1 week, 2 weeks: the Task tab's quick dates, counted in the organization's zone. */
export function duePresets(timeZone: string | null | undefined): DatePreset[] {
    const today = todayInZone(timeZone)
    return [{ label: 'Tomorrow', day: addDaysToDay(today, 1) }, { label: '1 week', day: addDaysToDay(today, 7) }, { label: '2 weeks', day: addDaysToDay(today, 14) }]
}

/** "+1 day", "+3 days", "+1 week" from a day (an extension, a fix-by date, late work). */
export function afterPresets(fromDay: string, time?: string): DatePreset[] {
    return ([['+1 day', 1], ['+3 days', 3], ['+1 week', 7]] as const).map(([label, days]) => ({ label, day: addDaysToDay(fromDay, days), time }))
}

/** When to publish: tomorrow morning or next Monday morning. */
export function publishPresets(timeZone: string | null | undefined): DatePreset[] {
    const today = todayInZone(timeZone)
    return [{ label: 'Tomorrow 8 AM', day: addDaysToDay(today, 1), time: '08:00' }, { label: 'Monday 8 AM', day: nextWeekday(today, 1), time: '08:00' }]
}
