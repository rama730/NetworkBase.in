'use client'

import { useState, useTransition } from 'react'
import { toast } from '@/lib/feedback'

import { saveTemplateAction } from '@/app/actions/moderation-staff'
import { APPEAL_REPLIES } from '@/components/trust/AppealsClient'
import { FIELD } from '@/components/trust/NewCaseDialog'
import { Button } from '@/components/ui/button'
import { RULE_MEANINGS, RULES, ruleLabel } from '@/lib/trust/rules'

const builtIn = (rule: number) => `Please read ${ruleLabel(rule)} in our community rules. Repeated breaks lead to limits on your account.`
const ITEMS: Array<{ key: string; title: string; hint: string; placeholder: string }> = [
    ...Object.keys(RULES).map(Number).map((rule) => ({ key: `rule:${rule}`, title: ruleLabel(rule), hint: RULE_MEANINGS[rule] ?? '', placeholder: builtIn(rule) })),
    ...(['upheld', 'reduced', 'reversed'] as const).map((o) => ({ key: `appeal:${o}`, title: `Appeal ${o}`, hint: 'The reply the person gets with this outcome.', placeholder: APPEAL_REPLIES[o] })),
]

/** Saved messages (S13, R10): the decision panel and the appeal form start from these, so the same case gets the same wording. */
export function RuleTemplates({ templates }: { templates: Partial<Record<string, string>> }) {
    const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(ITEMS.map((i) => [i.key, templates[i.key] ?? ''])))
    const [saved, setSaved] = useState<Partial<Record<string, string>>>(templates)
    const [pending, start] = useTransition()
    const save = (item: (typeof ITEMS)[number]) => start(async () => {
        const text = values[item.key] ?? ''
        const r = await saveTemplateAction(item.key, text)
        if (!r.success) return void toast(r.error)
        setSaved((prev) => ({ ...prev, [item.key]: text.trim() }))
        toast(text.trim() ? `Saved · ${item.title}` : `${item.title} uses the built-in text again`)
    })
    return (
        <ul className="divide-y divide-border">
            {ITEMS.map((item) => {
                const dirty = (values[item.key] ?? '').trim() !== (saved[item.key] ?? '').trim()
                return (
                    <li key={item.key} className="py-3">
                        <label className="block text-[13px] font-medium">{item.title}
                            <span className="block text-[12px] font-normal text-muted-foreground">{item.hint}</span>
                            <textarea rows={2} maxLength={4000} value={values[item.key] ?? ''} placeholder={item.placeholder} onChange={(e) => setValues((prev) => ({ ...prev, [item.key]: e.target.value }))} className={`${FIELD} py-2`} />
                        </label>
                        {dirty ? <Button size="sm" variant="outline" className="mt-1" disabled={pending} onClick={() => save(item)}>Save</Button> : null}
                    </li>
                )
            })}
        </ul>
    )
}
