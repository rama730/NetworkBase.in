import { expect, test } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { scopedName } from './_helpers/fixtures'
import { attachPageMonitoring } from './_helpers/monitoring'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const canManageFixtures = Boolean(supabaseUrl && serviceRoleKey)

function getOnboardingPassword(): string {
    const password = process.env.E2E_ONBOARDING_PASSWORD || process.env.E2E_USER_PASSWORD
    if (!password) {
        throw new Error('E2E_ONBOARDING_PASSWORD (or E2E_USER_PASSWORD) is required for onboarding smoke tests.')
    }
    return password
}

function attachOnboardingMonitoring(page: import('@playwright/test').Page) {
    return attachPageMonitoring(page, {
        allowedConsolePatterns: [
            /Unable to save onboarding draft: Error: An unexpected response was received from the server\./i,
        ],
        allowedPageErrorPatterns: [
            /An unexpected response was received from the server\./i,
        ],
    })
}

async function fillIdentity(page: import('@playwright/test').Page, fullName: string, username: string) {
    await page.getByLabel(/Full name/).fill(fullName)
    await page.locator('#username').fill(username)
    await expect(page.getByText('Username is available')).toBeVisible({ timeout: 15000 })
}

async function addSkill(page: import('@playwright/test').Page, skill: string) {
    await page.getByRole('combobox').fill(skill)
    await page.keyboard.press('Enter')
    await expect(page.getByText(/1 of 25 skills selected/)).toBeVisible()
}

/** After the finish screen: the button, then the legal acceptance the fixture user has not seen yet. */
async function continueFromFinishScreen(page: import('@playwright/test').Page, expectedPath: string) {
    await page.getByRole('button', { name: /^(Go to Discover|Continue)/ }).click()
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 45000 }).not.toBe('/onboarding')
    if (new URL(page.url()).pathname === '/legal/accept') {
        await page.getByRole('checkbox').check()
        await page.getByRole('button', { name: 'Agree and continue' }).click()
    }
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 45000 }).toBe(expectedPath)
}

const FIXTURE_EMAILS = {
    happy: process.env.E2E_ONBOARDING_HAPPY_EMAIL || 'codex.onboarding.happy@example.com',
    legacy: process.env.E2E_ONBOARDING_LEGACY_EMAIL || 'codex.onboarding.legacy@example.com',
    reserved: process.env.E2E_ONBOARDING_RESERVED_EMAIL || 'codex.onboarding.reserved@example.com',
    collision: process.env.E2E_ONBOARDING_COLLISION_EMAIL || 'codex.onboarding.collision@example.com',
    rateLimit: process.env.E2E_ONBOARDING_RATELIMIT_EMAIL || 'codex.onboarding.ratelimit@example.com',
    idempotent: process.env.E2E_ONBOARDING_IDEMPOTENT_EMAIL || 'codex.onboarding.idempotent@example.com',
    resume: process.env.E2E_ONBOARDING_RESUME_EMAIL || 'codex.onboarding.resume@example.com',
    next: process.env.E2E_ONBOARDING_NEXT_EMAIL || 'codex.onboarding.next@example.com',
    lateTaken: process.env.E2E_ONBOARDING_LATE_TAKEN_EMAIL || 'codex.onboarding.latetaken@example.com',
}

const EXISTING_USERNAME = process.env.E2E_ONBOARDING_COLLISION_TARGET || 'e2e_6ff73371'

function adminClient() {
    return createClient(supabaseUrl, serviceRoleKey, {
        auth: {
            autoRefreshToken: false,
            persistSession: false,
        },
    })
}

async function ensureOnboardingFixture(email: string) {
    if (!canManageFixtures) return
    const onboardingPassword = getOnboardingPassword()
    const admin = adminClient()

    const usersResponse = await admin.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
    })
    const existing = usersResponse.data.users.find((item) => item.email?.toLowerCase() === email.toLowerCase())

    let userId = existing?.id || null
    if (!userId) {
        const created = await admin.auth.admin.createUser({
            email,
            password: onboardingPassword,
            email_confirm: true,
            app_metadata: {
                onboarding_complete: false,
                onboarding_version: 3,
            },
            user_metadata: {
                full_name: 'Onboarding Fixture User',
                onboarded: false,
                username: null,
            },
        })
        if (created.error) {
            throw new Error(`Unable to create onboarding fixture user for ${email}: ${created.error.message}`)
        }
        if (!created.data.user?.id) {
            throw new Error(`Unable to create onboarding fixture user for ${email}`)
        }
        userId = created.data.user.id
    } else {
        const updated = await admin.auth.admin.updateUserById(userId, {
            email,
            password: onboardingPassword,
            app_metadata: {
                onboarding_complete: false,
                onboarding_version: 3,
            },
            user_metadata: {
                full_name: 'Onboarding Fixture User',
                onboarded: false,
                username: null,
            },
        })
        if (updated.error) {
            throw new Error(`Unable to update onboarding fixture user for ${email}: ${updated.error.message}`)
        }
    }

    const { error: upsertError } = await admin
        .from('profiles')
        .upsert({
            id: userId,
            email,
            username: null,
            full_name: 'Onboarding Fixture User',
            onboarding_status: 'not_started',
            onboarding_completed_at: null,
            onboarding_version: 3,
            updated_at: new Date().toISOString(),
        })
    if (upsertError) {
        throw new Error(`Failed to upsert profile fixture for ${email}: ${upsertError.message}`)
    }

    const { error: deleteDraftError } = await admin
        .from('onboarding_drafts')
        .delete()
        .eq('user_id', userId)
    if (deleteDraftError) {
        throw new Error(`Failed to clear onboarding draft fixture for ${email}: ${deleteDraftError.message}`)
    }
}

async function login(page: import('@playwright/test').Page, email: string) {
    const onboardingPassword = getOnboardingPassword()
    for (let attempt = 0; attempt < 3; attempt += 1) {
        await page.goto('/login')
        let pathname = new URL(page.url()).pathname
        if (pathname === '/onboarding') return
        if (pathname !== '/login') {
            await page.goto('/login')
            pathname = new URL(page.url()).pathname
            if (pathname === '/onboarding') return
        }

        await expect(page.getByLabel('Email')).toBeVisible({ timeout: 10000 })
        await page.getByLabel('Email').fill(email)
        await page.getByLabel('Password').fill(onboardingPassword)
        await page.getByRole('button', { name: 'Sign in' }).click()

        try {
            await expect
                .poll(() => new URL(page.url()).pathname, { timeout: 20000 })
                .not.toBe('/login')

            const pathname = new URL(page.url()).pathname
            if (pathname !== '/onboarding') {
                await page.goto('/onboarding')
            }
            await expect
                .poll(() => new URL(page.url()).pathname, { timeout: 10000 })
                .toBe('/onboarding')
            return
        } catch (error) {
            if (attempt === 2) throw error
        }
    }
}

test.describe('Onboarding smoke', () => {
    test.skip(!canManageFixtures, 'Supabase service role is required for onboarding fixture setup')

    test('happy path completes onboarding, lands on Discover, and keeps a finished account out of onboarding', async ({ browser }) => {
        const email = FIXTURE_EMAILS.happy
        await ensureOnboardingFixture(email)

        const context = await browser.newContext()
        const page = await context.newPage()
        const monitor = attachOnboardingMonitoring(page)

        await login(page, email)

        const username = scopedName('onb').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 20)
        await page.getByLabel(/Full name/).fill('Onboarding Happy User')
        await page.locator('#username').fill(username)
        await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled()
        await expect(page.getByText('Username is available')).toBeVisible({ timeout: 15000 })
        await expect(page.getByRole('button', { name: 'Continue' })).toBeEnabled()
        await page.getByLabel(/Full name/).press('Enter') // Enter in a field presses Continue
        await expect(page.getByRole('heading', { name: 'Tell us about yourself' })).toBeVisible()

        // Step 2 is one page: every group is here at once.
        await page.getByLabel('Experience level').selectOption({ label: 'Mid-level' })
        await page.getByLabel('Weekly capacity').selectOption({ label: '10–20 hours per week' })
        await page.getByRole('button', { name: 'Freelance' }).click()
        await page.getByLabel('GitHub').fill('github.com/onboarding-happy')
        await page.getByText('Male', { exact: true }).click()
        await page.getByLabel('Pronouns').fill('he/him')
        await page.getByRole('button', { name: 'Continue' }).click()

        await addSkill(page, 'React')
        await page.getByRole('button', { name: 'Continue' }).click()
        await page.getByText('Everyone', { exact: true }).click()
        await page.getByRole('button', { name: 'Finish setup' }).click()
        await expect(page.getByRole('heading', { name: /Welcome to NetworkBase/ })).toBeVisible({ timeout: 45000 })
        await continueFromFinishScreen(page, '/discover')

        const saved = await adminClient().from('profiles')
            .select('username, full_name, onboarding_status, avatar_url').eq('email', email).single()
        expect(saved.error).toBeNull()
        expect(saved.data?.username).toBe(username)
        expect(saved.data?.full_name).toBe('Onboarding Happy User')
        expect(saved.data?.onboarding_status).toBe('completed')
        const avatar = page.getByRole('button', { name: 'User menu' }).locator('[data-slot="user-avatar"]')
        await expect(avatar).toBeVisible()
        await expect(avatar).toHaveAttribute('title', 'Onboarding Happy User')
        // An uploaded/provider image or the existing initials fallback must survive navigation.
        await expect(avatar.locator('img, [data-avatar-tone]')).toBeVisible()

        // A finished account never sees onboarding again.
        await page.goto('/onboarding')
        await expect.poll(() => new URL(page.url()).pathname, { timeout: 15000 }).toBe('/discover')

        await monitor.assertNoViolations()
        monitor.detach()
        await context.close()
    })

    test('finishing returns the person to the page they were heading to', async ({ browser }) => {
        const email = FIXTURE_EMAILS.next
        await ensureOnboardingFixture(email)

        const context = await browser.newContext()
        const page = await context.newPage()
        const monitor = attachOnboardingMonitoring(page)
        await login(page, email)

        await page.goto('/onboarding?next=/my-profile')
        const username = scopedName('next').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 20)
        await fillIdentity(page, 'Next Path User', username)
        await page.getByRole('button', { name: 'Continue' }).click()
        await page.getByRole('button', { name: 'Skip for now' }).click()
        await addSkill(page, 'React')
        await page.getByRole('button', { name: 'Continue' }).click()
        await page.getByRole('button', { name: 'Finish setup' }).click()
        await continueFromFinishScreen(page, '/my-profile')

        await monitor.assertNoViolations()
        monitor.detach()
        await context.close()
    })

    test('a username taken between step 1 and Finish sends the person back to fix it, and they can finish', async ({ browser }) => {
        const email = FIXTURE_EMAILS.lateTaken
        await ensureOnboardingFixture(email)
        const admin = adminClient()
        const owner = await admin.from('username_aliases').select('user_id').eq('username', EXISTING_USERNAME).maybeSingle()
        test.skip(!owner.data?.user_id, 'needs an existing account that owns E2E_ONBOARDING_COLLISION_TARGET')

        const context = await browser.newContext()
        const page = await context.newPage()
        const monitor = attachOnboardingMonitoring(page)
        await login(page, email)

        const username = scopedName('late').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 20)
        await fillIdentity(page, 'Late Taken User', username)
        await page.getByRole('button', { name: 'Continue' }).click()
        await page.getByRole('button', { name: 'Skip for now' }).click()
        await addSkill(page, 'React')
        await page.getByRole('button', { name: 'Continue' }).click()

        // Someone else claims the name while this person is on the review.
        await admin.from('username_aliases').insert({ username, user_id: owner.data!.user_id, is_primary: false })
        try {
            await page.getByRole('button', { name: 'Finish setup' }).click()
            await expect(page.getByText(/already taken|unavailable/i)).toBeVisible({ timeout: 20000 })
            await expect(page.getByRole('heading', { name: "Let's set up your profile" })).toBeVisible()

            const replacement = scopedName('late2').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 20)
            await fillIdentity(page, 'Late Taken User', replacement)
            await page.getByRole('button', { name: 'Back to review' }).click()
            await page.getByRole('button', { name: 'Finish setup' }).click()
            await expect(page.getByRole('heading', { name: /Welcome to NetworkBase/ })).toBeVisible({ timeout: 45000 })
        } finally {
            await admin.from('username_aliases').delete().eq('username', username)
        }

        await monitor.assertNoViolations()
        monitor.detach()
        await context.close()
    })

    test('an old unscoped draft key is never read into the form', async ({ browser }) => {
        const email = FIXTURE_EMAILS.legacy
        await ensureOnboardingFixture(email)

        const context = await browser.newContext()
        const page = await context.newPage()
        const monitor = attachOnboardingMonitoring(page)

        await login(page, email)
        await page.evaluate(() => {
            localStorage.setItem('onboarding:draft:v1', JSON.stringify({
                step: 2,
                data: { fullName: 'Legacy Draft User', pronouns: 'they/them' },
                updatedAt: Date.now(),
            }))
        })
        await page.reload()

        await expect(page.getByRole('heading', { name: "Let's set up your profile" })).toBeVisible()
        await expect(page.getByLabel(/Full name/)).not.toHaveValue('Legacy Draft User')

        await monitor.assertNoViolations()
        monitor.detach()
        await context.close()
    })

    test('reload resumes the next server-committed step', async ({ browser }) => {
        const email = FIXTURE_EMAILS.resume
        await ensureOnboardingFixture(email)

        const context = await browser.newContext()
        const page = await context.newPage()
        const monitor = attachOnboardingMonitoring(page)
        await login(page, email)

        const username = scopedName('resume').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 20)
        await fillIdentity(page, 'Resume Contract User', username)
        await page.getByRole('button', { name: 'Continue' }).click()
        await expect(page.getByRole('heading', { name: 'Tell us about yourself' })).toBeVisible()

        await page.reload()

        await expect(page.getByRole('heading', { name: 'Tell us about yourself' })).toBeVisible()
        const rail = page.getByRole('list', { name: 'Setup steps' })
        await expect(rail.getByRole('listitem').first()).toContainText('completed')
        await expect(rail.locator('[aria-current="step"]')).toContainText('Details')

        await monitor.assertNoViolations()
        monitor.detach()
        await context.close()
    })

    test('reserved username is blocked in onboarding', async ({ browser }) => {
        const email = FIXTURE_EMAILS.reserved
        await ensureOnboardingFixture(email)

        const context = await browser.newContext()
        const page = await context.newPage()
        const monitor = attachOnboardingMonitoring(page)

        await login(page, email)
        await page.getByLabel(/Full name/).fill('Reserved Username User')
        await page.locator('#username').fill('admin')
        await expect(page.getByText('This username is reserved')).toBeVisible({ timeout: 15000 })
        await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled()

        await monitor.assertNoViolations()
        monitor.detach()
        await context.close()
    })

    test('collision username shows taken message', async ({ browser }) => {
        const email = FIXTURE_EMAILS.collision
        await ensureOnboardingFixture(email)

        const context = await browser.newContext()
        const page = await context.newPage()
        const monitor = attachOnboardingMonitoring(page)

        await login(page, email)
        await page.getByLabel(/Full name/).fill('Collision Username User')
        await page.locator('#username').fill(EXISTING_USERNAME)
        await expect(page.getByText(/already taken/i)).toBeVisible({ timeout: 15000 })

        await monitor.assertNoViolations()
        monitor.detach()
        await context.close()
    })

    test('username check endpoint enforces rate limit', async ({ browser }) => {
        const email = FIXTURE_EMAILS.rateLimit
        await ensureOnboardingFixture(email)

        const context = await browser.newContext()
        const page = await context.newPage()
        const monitor = attachOnboardingMonitoring(page)
        await login(page, email)

        let rateLimited = false
        const configuredLimit = Number(process.env.ONBOARDING_USERNAME_CHECK_LIMIT || '30')
        const maxAttempts = Math.min(1000, Math.max(configuredLimit * 4, 120))

        for (let index = 0; index < maxAttempts; index += 1) {
            const username = `rluser${index.toString().padStart(2, '0')}`
            const response = await context.request.get(
                `/api/v1/onboarding/username-check?username=${encodeURIComponent(username)}`,
                {
                    headers: {
                        'user-agent': 'playwright-rate-limit-test',
                    },
                }
            )
            let payload: { code?: string } = {}
            const contentType = response.headers()['content-type'] || ''
            if (contentType.includes('application/json')) {
                try {
                    payload = (await response.json()) as { code?: string }
                } catch {
                    payload = {}
                }
            }
            if (response.status() === 429 || payload.code === 'RATE_LIMITED') {
                rateLimited = true
                break
            }
        }

        expect(rateLimited, `Expected rate limit within ${maxAttempts} requests`).toBe(true)
        await monitor.assertNoViolations()
        monitor.detach()
        await context.close()
    })

    test('double-clicking Finish creates the profile once', async ({ browser }) => {
        const email = FIXTURE_EMAILS.idempotent
        await ensureOnboardingFixture(email)

        const context = await browser.newContext()
        const page = await context.newPage()
        const monitor = attachOnboardingMonitoring(page)

        await login(page, email)
        const username = scopedName('idem').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 20)
        await fillIdentity(page, 'Idempotent User', username)
        await page.getByRole('button', { name: 'Continue' }).click()
        await page.getByRole('button', { name: 'Skip for now' }).click()
        await addSkill(page, 'React')
        await page.getByRole('button', { name: 'Continue' }).click()

        await page.getByRole('button', { name: 'Finish setup' }).dblclick()
        await expect(page.getByRole('heading', { name: /Welcome to NetworkBase/ })).toBeVisible({ timeout: 45000 })
        await continueFromFinishScreen(page, '/discover')

        const saved = await adminClient().from('profiles').select('id, username').eq('email', email).single()
        expect(saved.data?.username).toBe(username)
        const welcome = await adminClient().from('email_outbox').select('id').eq('user_id', saved.data!.id)
        expect(welcome.data?.length ?? 0).toBeLessThanOrEqual(1)

        await monitor.assertNoViolations()
        monitor.detach()
        await context.close()
    })
})
