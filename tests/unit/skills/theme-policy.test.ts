import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SkillIcon } from '../../../src/components/skills/SkillIcon'
import { resolveClientSkill, setSkillCatalog, type SkillCatalog } from '../../../src/lib/skills/client'
import { readFileSync } from 'node:fs'

setSkillCatalog(JSON.parse(readFileSync('public/skill-catalog.json', 'utf8')) as SkillCatalog)

function render(name: string, colorMode: 'brand' | 'current' = 'brand') {
    return renderToStaticMarkup(createElement(SkillIcon, {
        skill: resolveClientSkill(name),
        colorMode,
        decorative: false,
    }))
}

describe('skill icon theme policy', () => {
    it('renders reviewed monochrome pairs explicitly in both themes', () => {
        const anthropic = render('Anthropic API')

        assert.match(anthropic, /dark:hidden/)
        assert.match(anthropic, /hidden dark:block/)
        assert.match(anthropic, /background-color:#181818/)
        assert.match(anthropic, /background-color:#FFFFFF/i)
        assert.match(anthropic, /\/skill-icons\/v1\/logos-anthropic-icon\.svg/)
    })

    it('never adds theme variants to stable multicolor brand assets', () => {
        for (const name of ['SolidJS', 'MATLAB', 'PowerShell', 'Codex']) {
            const markup = render(name)
            assert.match(markup, /<img[^>]*src="\/skill-icons\/v1\/[^"]+"/, name)
            assert.doesNotMatch(markup, /dark:hidden|dark:block/, name)
        }
    })

    it('renders custom SVG gradients as a plain image', () => {
        const markup = render('Google Antigravity')

        assert.match(markup, /\/skill-icons\/v1\/curated-google-antigravity\.svg/)
        assert.doesNotMatch(markup, /dark:hidden|dark:block/)
    })

    it('uses an explicit inverse only for reviewed dark-colliding monochrome marks', () => {
        const github = render('GitHub')

        assert.match(github, /background-color:#181717/)
        assert.match(github, /background-color:#FFFFFF/i)
        assert.match(github, /hidden dark:block/)
        assert.match(github, /\/skill-icons\/v1\/github\.svg/)
    })

    it('switches to upstream light and dark assets when the source publishes a pair', () => {
        const next = render('Next.js')

        assert.match(next, /\/skill-icons\/v1\/skill-icons-nextjs-light\.svg/)
        assert.match(next, /\/skill-icons\/v1\/skill-icons-nextjs-dark\.svg/)
        assert.match(next, /dark:hidden/)
        assert.match(next, /hidden dark:block/)
    })

    it('uses current color without a brand theme pair when requested', () => {
        const anthropic = render('Anthropic API', 'current')

        assert.match(anthropic, /\/skill-icons\/v1\/logos-anthropic-icon\.svg/)
        assert.doesNotMatch(anthropic, /dark:hidden|dark:block/)
        assert.match(anthropic, /background-color:currentColor/)
    })

    it('omits generic glyphs and initials so the surrounding chip shows only the name', () => {
        for (const name of ['WebSockets', 'Data Science', 'Unlisted specialist skill']) {
            assert.equal(render(name), '', name)
            assert.equal(render(name, 'current'), '', name)
        }
    })

    it('omits missing icon keys without rendering an empty placeholder', () => {
        const skill = { ...resolveClientSkill('React'), iconKey: '' }
        assert.equal(renderToStaticMarkup(createElement(SkillIcon, { skill })), '')
    })
})
