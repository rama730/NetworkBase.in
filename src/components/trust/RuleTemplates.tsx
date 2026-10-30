'use client'

import { useState, useTransition } from 'react'
import { toast } from '@/lib/feedback'

import { saveRuleTemplateAction } from '@/app/actions/moderation-staff'
import { FIELD } from '@/components/trust/NewCaseDialog'
import { Button } from '@/components/ui/button'
import { RULE_MEANINGS, RULES, ruleLabel } from '@/lib/trust/rules'

const builtIn = (rule: number) => `Please read ${ruleLabel(rule)} in our community rules. Repeated breaks lead to limits on your account.`

/** Message templates per rule (S13): the decision panel starts from these, so the same rule gets the same wording. */
export function RuleTemplates({ templates }: { templates: Record<number, string> }) {
    const [values, setValues] = useState<Record<number, string>>(() => Object.fromEntries(Object.keys(RULES).map((r) => [r, templates[Number(r)] ?? ''])))
    const [saved, setSaved] = useState(templates)
    const [pending, start] = useTransition()
    const save = (rule: number) => start(async () => {
        const r = await saveRuleTemplateAction(rule, values[rule] ?? '')
        if (!r.success) return void toast(r.error)
        setSaved((prev) => ({ ...prev, [rule]: (values[rule] ?? '').trim() }))
        toast(values[rule]?.trim() ? `Template saved for §${rule}` : `§${rule} uses the built-in message again`)
    })
    return (
        <ul className="divide-y divide-border">
            {Object.keys(RULES).map(Number).map((rule) => {
                const dirty = (values[rule] ?? '').trim() !== (saved[rule] ?? '').trim()
                return (
                    <li key={rule} className="py-3">
                        <label className="block text-[13px] font-medium">{ruleLabel(rule)}
                            <span className="block text-[12px] font-normal text-muted-foreground">{RULE_MEANINGS[rule]}</span>
                            <textarea rows={2} maxLength={2000} value={values[rule] ?? ''} placeholder={builtIn(rule)} onChange={(e) => setValues((prev) => ({ ...prev, [rule]: e.target.value }))} className={`${FIELD} py-2`} />
                        </label>
                        {dirty ? <Button size="sm" variant="outline" className="mt-1" disabled={pending} onClick={() => save(rule)}>Save</Button> : null}
                    </li>
                )
            })}
        </ul>
    )
}
