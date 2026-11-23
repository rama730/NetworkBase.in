import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

// Organization design contract (docs/superpowers/plans/2026-11-05-org-design-consistency.md, Task 1).
// Every pattern here breaks the design specification; the message lists each file:line still doing it.

const root = process.cwd()
const orgDir = path.join(root, 'src/components/organizations')
const only = process.env.ORG_CONTRACT_FILES?.split(',').map((f) => f.trim()).filter(Boolean)
// Sprint redesign (2026-11-09): the sprint screens an organization uses follow the same contract.
const sprintFiles = ['src/components/workspaces/v2/sprints/CreateSprintModal.tsx', 'src/components/workspaces/tabs/sprint/SprintInsights.tsx',
    'src/components/workspaces/tabs/sprint/SprintLifecycleModals.tsx', 'src/components/workspaces/tabs/sprint/SprintHeader.tsx', 'src/components/workspaces/tabs/sprint/SprintLeftRail.tsx']
const files = [...fs.readdirSync(orgDir).filter((f) => f.endsWith('.tsx') && (!only || only.includes(f))).map((f) => path.join(orgDir, f)),
    ...sprintFiles.filter((f) => !only || only.includes(path.basename(f))).map((f) => path.join(root, f))]

/** Source without comments, line numbers kept. */
function code(file: string) {
    const blank = (m: string) => m.replace(/[^\n]/g, ' ')
    return fs.readFileSync(file, 'utf8')
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, blank)
        .replace(/\/\*[\s\S]*?\*\//g, blank)
        .replace(/^\s*\/\/.*$/gm, blank)
}

const lineOf = (src: string, index: number) => src.slice(0, index).split('\n').length
const rel = (file: string) => path.relative(root, file)

/** The whole opening tag at `start`, skipping `>` inside `{…}` (arrow functions). */
function tagAt(src: string, start: number) {
    let depth = 0
    for (let i = start; i < src.length; i++) {
        const c = src[i]
        if (c === '{') depth++
        else if (c === '}') depth--
        else if (c === '>' && depth === 0) return src.slice(start, i + 1)
    }
    return src.slice(start)
}

function hits(pattern: RegExp, filter?: (match: string) => boolean) {
    const out: string[] = []
    for (const file of files) {
        const src = code(file)
        for (const m of src.matchAll(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`))) {
            if (!filter || filter(m[0])) out.push(`${rel(file)}:${lineOf(src, m.index ?? 0)}  ${m[0].slice(0, 80)}`)
        }
    }
    return out
}

/** Opening tags of `tag` (optionally with `attr`) that lack `needed` in their attributes. */
function tagsWithout(tag: string, needed: string, attr?: RegExp) {
    const out: string[] = []
    for (const file of files) {
        const src = code(file)
        for (const m of src.matchAll(new RegExp(`<${tag}\\b`, 'g'))) {
            const whole = tagAt(src, m.index ?? 0)
            if (attr && !attr.test(whole)) continue
            if (!whole.includes(needed)) out.push(`${rel(file)}:${lineOf(src, m.index ?? 0)}  ${whole.replace(/\s+/g, ' ').slice(0, 80)}`)
        }
    }
    return out
}

const none = (list: string[], why: string) => assert.deepEqual(list, [], `${why}\n${list.join('\n')}`)

test('organization screens follow the design contract', async (t) => {
    await t.test('no hard-coded hex colours', () => none(hits(/#[0-9A-Fa-f]{6}\b/), '§06A: colours come from tokens'))
    await t.test('no Tailwind palette colours', () => none(hits(/\b(?:text|bg|border|ring|fill|stroke)-(?:red|amber|sky|emerald|violet|rose|slate|green|blue|yellow|orange|gray|zinc|neutral)-\d{2,3}\b/), '§03: status colours only'))
    await t.test('no type below 11px', () => none(hits(/text-\[(?:8|9|10)px\]/), '§04: the smallest size is 11px'))
    await t.test('radii come from the token classes', () => none(hits(/\brounded(?:-\[\d+px\])?(?=[\s"'`])|rounded-[lr](?=[\s"'`])/, (m) => m !== 'rounded-[999px]'), '§05: rounded-sm (3), rounded-md (5), rounded-lg (8), rounded-xl (12)'))
    await t.test('no see-through surfaces', () => none(hits(/\b(?:bg-(?:muted|secondary|primary|destructive|card|foreground)|border-(?:primary|destructive|border)|ring-primary)\/\d+/), '§03: sunken is bg-muted; status uses -soft tokens'))
    await t.test('no faded readable content', () => none(hits(/(?<![:\w-])opacity-(?:30|40|60|70|90)\b/), '§05: opacity is the disabled treatment only'))
    await t.test('no off-scale control heights', () => none(hits(/\bh-\[(?:26|30)px\]|\bmin-h-\[52px\]/), '§05: controls are 28, 34 or 42px'))
    await t.test('no round avatars', () => none(hits(/roundedClassName="rounded-full"/), '§05: avatars are square'))
    await t.test('selects use .nb-select', () => none(tagsWithout('select', 'nb-select'), '§10 Select: input-matched'))
    await t.test('textareas use .nb-textarea', () => none(tagsWithout('textarea', 'nb-textarea'), '§10 Textarea'))
    await t.test('checkboxes use .nb-check', () => none(tagsWithout('input', 'nb-check', /type="checkbox"/), '§10 Checkbox'))
    await t.test('radios use .nb-radio', () => none(tagsWithout('input', 'nb-radio', /type="radio"/), '§10 Radio'))
    await t.test('no generic spinners', () => none(hits(/Loader2|animate-spin/), '§06A: no generic spinner'))
    await t.test('no glyphs standing in for icons', () => none(hits(/[✓★→←↓📌]/), '§06: Lucide icons, not text glyphs'))
    await t.test('no text-only loading', () => none(hits(/Loading…<|Loading members…/), '§33: layout-matched skeleton'))
    await t.test('dates use the organization zone', () => none(hits(/toLocaleDateString\(/), '§04: formatInZone'))
    await t.test('archived and private are not draft-coloured', () => none(hits(/data-status="draft">(?:Archived|Private)|data-status="draft"\s*>\s*\{visibilityChip\}/), '§10: system-known status'))
    await t.test('uppercase only in the mono micro label', () => none(hits(/nb-ui-label[^"']*uppercase/), '§04: uppercase is mono only'))
    // The user's decision 2026-11-23 (controls round 2) replaced D-C's pill: tags are square like every other control.
    await t.test('.nb-tag is square', () => assert.match(fs.readFileSync(path.join(root, 'src/app/globals.css'), 'utf8'), /\.nb-tag \{[^}]*border-radius:3px/))
})

test('outside surfaces show organizations by the contract', async (t) => {
    const read = (p: string) => code(path.join(root, p))
    await t.test('org card: type is not a status badge, no ✓ glyph, no 2px square', () => {
        const card = read('src/components/workspaces/WorkspaceCard.tsx')
        assert.doesNotMatch(card, /nb-status[^"]*" data-status="active">\{orgTypeLabel\}/)
        assert.doesNotMatch(card, /✓/)
        assert.doesNotMatch(card, /rounded-\[2px\]/)
    })
    await t.test('Discover filter shows the organization without "@"', () => {
        assert.doesNotMatch(read('src/components/discover/DiscoverHeader.tsx'), />@\{query\.org\}</)
    })
    await t.test('header verified mark is an icon, not a typed ✓', () => {
        assert.doesNotMatch(read('src/components/workspaces/dashboard/WorkspaceDashboardClient.tsx'), /text-\[0\.6em\][^>]*>✓/)
    })
    await t.test('Follow has no spinner and names the organization', () => {
        const layout = read('src/components/workspaces/dashboard/WorkspaceLayout.tsx')
        assert.doesNotMatch(layout, /Loader2/)
        assert.doesNotMatch(layout, /Invite a member/)
    })
    await t.test('creating an organization never says "workspace" in Setup', () => {
        for (const file of ['Phase4Settings.tsx', 'Phase5Review.tsx']) {
            const step = read(`src/components/workspaces/create-wizard/phases/${file}`)
            assert.match(step, /const noun = \w+ \? 'organization' : 'workspace'/)
            assert.doesNotMatch(step, /title="Workspace (?:picture|links|files)"|Choose workspace visibility|'Untitled workspace'|label="Workspace (?:picture|links)"/)
        }
    })
})
