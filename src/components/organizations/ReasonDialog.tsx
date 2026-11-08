'use client'

import { useState } from 'react'

import { ConfirmDialog } from '@/components/ui/ConfirmDialog'

// The shared dialog in place of window.prompt (report §32.3, decision 75). A refused save keeps the text (§32.6).

export function ReasonDialog({ open, onOpenChange, title, label, confirmLabel, required = false, variant = 'default', onConfirm }: {
    open: boolean
    onOpenChange: (open: boolean) => void
    title: string
    label: string
    confirmLabel: string
    required?: boolean
    variant?: 'default' | 'destructive'
    /** Throw to keep the dialog open with the message; the text stays. */
    onConfirm: (reason: string) => void | Promise<void>
}) {
    const [text, setText] = useState('')
    return (
        <ConfirmDialog open={open} onOpenChange={(next) => { if (!next) setText(''); onOpenChange(next) }} title={title} confirmLabel={confirmLabel} variant={variant}
            onConfirm={async () => {
                if (required && !text.trim()) throw new Error('Write a reason first.')
                await onConfirm(text.trim())
                setText('')
            }}>
            <label className="block space-y-1 px-6 text-sm">
                <span className="font-medium">{label}</span>
                <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={500}
                    className="nb-textarea w-full" />
            </label>
        </ConfirmDialog>
    )
}
