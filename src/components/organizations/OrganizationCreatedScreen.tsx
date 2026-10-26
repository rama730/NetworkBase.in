'use client'

import { useState } from 'react'

import { Button } from '@/components/ui/button'

/** After creating an org (report §6): the join code large, Copy code, Copy invite message, then Go to organization. */
export function OrganizationCreatedScreen({ title, joinCode, onContinue }: { title: string; joinCode: string; onContinue: () => void }) {
    const [copied, setCopied] = useState<string | null>(null)
    const invite = `Join ${title} on NetworkBase with code ${joinCode}: ${typeof window === 'undefined' ? '' : `${window.location.origin}/join/${joinCode}`}`

    const copy = async (text: string, label: string) => {
        try {
            await navigator.clipboard.writeText(text)
            setCopied(label)
        } catch {
            setCopied('Copy failed. Select the text and copy it yourself.')
        }
    }

    return (
        <main className="flex h-full min-h-0 items-center justify-center bg-card px-4 py-12">
            <div className="w-full max-w-md space-y-6 text-center">
                <div className="space-y-1">
                    <h1 className="text-2xl font-semibold tracking-tight">{title} is ready</h1>
                    <p className="text-sm text-muted-foreground">People join with this code. You can copy or regenerate it later in Settings.</p>
                </div>
                <p className="select-all font-mono text-5xl font-semibold tracking-[0.25em] text-foreground" aria-label={`Join code ${joinCode.split('').join(' ')}`}>
                    {joinCode}
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                    <Button type="button" variant="outline" className="min-h-11" onClick={() => copy(joinCode, 'Code copied')}>Copy code</Button>
                    <Button type="button" variant="outline" className="min-h-11" onClick={() => copy(invite, 'Invite message copied')}>Copy invite message</Button>
                </div>
                <p role="status" aria-live="polite" className="min-h-5 text-sm text-muted-foreground">{copied}</p>
                <Button type="button" className="min-h-11 w-full" onClick={onContinue}>Go to organization</Button>
            </div>
        </main>
    )
}
