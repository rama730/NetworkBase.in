'use client'

import { toast } from 'sonner'

export function CopyText({ text }: { text: string }) {
    return (
        <span>{text} <button type="button" className="underline underline-offset-4" onClick={() => { void navigator.clipboard.writeText(text); toast('Copied') }}>Copy</button></span>
    )
}
