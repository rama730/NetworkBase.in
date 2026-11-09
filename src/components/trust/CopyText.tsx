'use client'

import { toast } from '@/lib/feedback'
import { copyOrSay } from '@/lib/clipboard';

export function CopyText({ text }: { text: string }) {
    return (
        <span>{text} <button type="button" className="underline underline-offset-4" onClick={() => { copyOrSay(text, () => toast('Copied')) }}>Copy</button></span>
    )
}
