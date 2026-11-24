'use client'

import { useState } from 'react'
import { Plus } from 'lucide-react'
import { SkillIcon } from '@/components/skills'
import { resolveClientSkill, useSkillCatalog } from '@/lib/skills/client'

const SHOWN = 12

/** "■ SKILLS · N" and the app's skill chips; twelve, then "+N more". The owner with none gets "Add skills". */
export function SkillsStrip({ skills, isOwner, onAdd }: { skills: string[]; isOwner: boolean; onAdd?: () => void }) {
    useSkillCatalog()
    const [all, setAll] = useState(false)
    if (!skills.length) {
        return isOwner && onAdd ? (
            <div className="nb-pf-skills">
                <span className="nb-pf-label is-sq">Skills</span>
                <button type="button" className="nb-pf-chip is-more" onClick={onAdd}><Plus className="size-3.5" aria-hidden="true" />Add skills</button>
            </div>
        ) : null
    }
    const shown = all ? skills : skills.slice(0, SHOWN)
    return (
        <div className="nb-pf-skills" aria-label="Skills">
            <span className="nb-pf-label is-sq">Skills · {skills.length}</span>
            {shown.map((name) => {
                const skill = resolveClientSkill(name)
                return <span key={skill.canonicalKey} className="nb-pf-chip"><SkillIcon skill={skill} size={16} />{skill.name}</span>
            })}
            {skills.length > SHOWN ? (
                <button type="button" className="nb-pf-chip is-more" aria-expanded={all} onClick={() => setAll((v) => !v)}>
                    {all ? 'Show fewer' : `+${skills.length - SHOWN} more`}
                </button>
            ) : null}
        </div>
    )
}
