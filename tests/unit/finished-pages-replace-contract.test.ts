// A5: after a finished or deleted screen, back must not return to it, so these exits replace history.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sites: Array<[file: string, exits: string[]]> = [
    ['src/components/workspaces/tabs/WorkspaceSettingsTab.tsx', ['router.replace(result.data.redirectTo || "/workspaces")']],
    ['src/components/organizations/OrgSettingsSections.tsx', ['router.replace(afterLeaveHref)']],
    ['src/components/settings/AccountDeletionSettings.tsx', ['router.replace("/login")']],
    ['src/components/settings/AccountDeletionWizard.tsx', ['router.replace(`/login?redirect=']],
    ['src/components/auth/LoginForm.tsx', ['router.replace(redirectPath)', 'window.location.replace(redirectPath)']],
    ['src/components/auth/SignupForm.tsx', ['router.replace(redirectPath)']],
    ['src/components/onboarding/WelcomeFlightOverlay.tsx', ['router.replace(flight.continuePath)', 'window.location.replace(flight.continuePath)']],
    ['src/app/(site)/(onboarding)/onboarding/page.tsx', ['window.location.replace(continuePath)']],
    ['src/components/organizations/JoinOrgButton.tsx', ['router.replace(orgHref)']],
]

for (const [file, exits] of sites) {
    test(`${file} leaves the finished screen out of history`, () => {
        const src = readFileSync(file, 'utf8')
        for (const exit of exits) assert.ok(src.includes(exit), `missing ${exit}`)
        const pushed = exits.map((e) => e.replace('router.replace(', 'router.push(').replace('location.replace(', 'location.assign('))
        for (const p of pushed) assert.ok(!src.includes(p), `still uses ${p}`)
    })
}

test('SignupForm has no push to redirectPath left', () => {
    const src = readFileSync('src/components/auth/SignupForm.tsx', 'utf8')
    assert.equal(src.match(/router\.replace\(redirectPath\)/g)?.length, 3)
})
