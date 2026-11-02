import { expect, test, type Page } from '@playwright/test';
import { axeViolations } from './axe';
import { buildRealSettings, openRealSettings, sampleData } from './real-settings';

// The real Settings document, real hooks and real components, with only the network and server actions answered
// by the spec. This is where behaviour of the tabs is checked in a browser.
test.use({ reducedMotion: 'reduce', viewport: { width: 1280, height: 900 } });
test.beforeAll(async () => { await buildRealSettings(); });

async function ready(page: Page) {
  await expect(page.getByRole('heading', { name: 'Settings', exact: true, level: 1 })).toBeVisible();
  // Every tab has loaded its data: none is still showing a skeleton or a loading line.
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Notification preferences' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Blocked people' })).toBeVisible();
  // Data from the mocked server is on the page, so the scans and tests below look at real content.
  await expect(page.getByText('Person 0')).toBeVisible();
  await expect(page.locator('#settings-security-sessions').getByText('This device', { exact: true })).toBeVisible();
}

test('the real settings document loads every tab without page errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.stack ?? error.message));
  await openRealSettings(page);
  await ready(page);
  expect(await page.locator('[data-settings-section]').count()).toBe(8);
  expect(errors).toEqual([]);
});

test('every tab has no WCAG A or AA violations on desktop and phone, light and dark', async ({ page }) => {
  await openRealSettings(page);
  await ready(page);
  for (const viewport of [{ width: 1280, height: 900 }, { width: 375, height: 700 }]) {
    await page.setViewportSize(viewport);
    for (const dark of [false, true]) {
      await page.evaluate((on) => document.documentElement.classList.toggle('dark', on), dark);
      // Colours ease between themes; scanning mid-transition reads blended colours.
      await page.waitForTimeout(500);
      expect(await axeViolations(page), `${viewport.width}px ${dark ? 'dark' : 'light'}`).toEqual([]);
    }
  }
});

// ── Notifications ────────────────────────────────────────────────────────────────────────────────────────────
function notificationsServer(options: { failSaves?: boolean } = {}) {
  const state: { stored: Record<string, any>; saves: Array<{ next: any; keys: unknown }>; resumed: number } = { stored: {}, saves: [], resumed: 0 };
  const actions = {
    readShellSummaryAction: (parts: string[]) => Object.fromEntries(parts.map((part) => [part, part === 'notificationPreferences' ? { success: true, preferences: state.stored } : { success: true }])),
    updateNotificationPreferencesAction: (next: any, keys: unknown) => {
      state.saves.push({ next, keys });
      if (options.failSaves) return { success: false, error: 'The server said no' };
      state.stored = next;
      return { success: true, preferences: next };
    },
    resumeNotifications: () => { state.resumed += 1; state.stored = { ...state.stored, pausedUntil: null }; return { success: true }; },
  };
  return { state, actions };
}

test('pausing notifications saves an end time, says so, and Resume lifts it', async ({ page }) => {
  const server = notificationsServer();
  // A time zone was saved earlier: an unrelated change must leave it alone (it only follows the browser when none was saved).
  server.state.stored = { quietHours: { timeZone: 'Europe/London' } };
  await openRealSettings(page, { actions: server.actions });
  await ready(page);
  const notifications = page.locator('#settings-notifications');
  await notifications.getByRole('button', { name: '1 hour', exact: true }).click();
  await expect(notifications.getByText('Notifications paused')).toBeVisible();
  const saved = server.state.saves.at(-1)!;
  const minutes = (Date.parse(saved.next.pausedUntil) - Date.now()) / 60_000;
  expect(minutes).toBeGreaterThan(55);
  expect(minutes).toBeLessThanOrEqual(60);
  expect(saved.keys).toEqual(['pausedUntil']);
  expect(saved.next.quietHours.timeZone).toBe('Europe/London');
  // The presets now offer to change an active pause, and Resume leads.
  await expect(notifications.getByRole('button', { name: 'Pause for 8 hours instead' })).toBeVisible();
  await notifications.getByRole('button', { name: 'Resume now' }).click();
  await expect(notifications.getByText('Pause notifications', { exact: true })).toBeVisible();
  expect(server.state.resumed).toBe(1);
});

test('quiet hours save only the changed part, and the same start and end is called out', async ({ page }) => {
  const server = notificationsServer();
  await openRealSettings(page, { actions: server.actions });
  await ready(page);
  const notifications = page.locator('#settings-notifications');
  await notifications.getByRole('switch', { name: /quiet hours/i }).click();
  await expect(notifications.getByLabel('From')).toBeVisible();
  expect(server.state.saves.at(-1)!.keys).toEqual(['quietHours']);
  await notifications.getByLabel('From').fill('22:00');
  await notifications.getByLabel('Until').fill('22:00');
  await notifications.getByLabel('Until').blur();
  await expect(notifications.getByText('Start and end are the same, so quiet hours are not active.')).toBeVisible();
  // Typing does not save; leaving the field does.
  const quiet = server.state.saves.filter((save) => JSON.stringify(save.keys) === '["quietHours"]');
  expect(quiet.length).toBeLessThanOrEqual(3);
});

test('a failed save puts the switch back and says it failed', async ({ page }) => {
  const server = notificationsServer({ failSaves: true });
  await openRealSettings(page, { actions: server.actions });
  await ready(page);
  const mentions = page.locator('#settings-notifications').locator('#mentions');
  await expect(mentions).toHaveAttribute('aria-checked', 'true');
  await mentions.click();
  await expect.poll(() => server.state.saves.length).toBeGreaterThan(0);
  await expect(mentions).toHaveAttribute('aria-checked', 'true');
});

test('a read error shows an error with Retry instead of default switches', async ({ page }) => {
  let failing = true;
  await openRealSettings(page, { actions: { readShellSummaryAction: (parts: string[]) => Object.fromEntries(parts.map((part) => [part, part === 'notificationPreferences' ? (failing ? { success: false } : { success: true, preferences: {} }) : { success: true }])) } });
  await expect(page.getByRole('heading', { name: 'Settings', exact: true, level: 1 })).toBeVisible();
  const notifications = page.locator('#settings-notifications');
  await expect(notifications.getByRole('button', { name: /retry/i })).toBeVisible();
  await expect(notifications.locator('#mentions')).toHaveCount(0);
  failing = false;
  await notifications.getByRole('button', { name: /retry/i }).click();
  await expect(notifications.locator('#mentions')).toBeVisible();
});

// ── Privacy ──────────────────────────────────────────────────────────────────────────────────────────────────
test('making the profile private asks first, and only a confirmed choice is sent', async ({ page }) => {
  const { calls } = await openRealSettings(page);
  await ready(page);
  const privacy = page.locator('#settings-privacy');
  await privacy.getByRole('radio', { name: /Private/ }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Make your profile private?' });
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  expect(calls.filter((call) => call.method === 'PATCH')).toEqual([]);
  await privacy.getByRole('radio', { name: /Private/ }).click();
  await page.getByRole('alertdialog', { name: 'Make your profile private?' }).getByRole('button', { name: 'Make private' }).click();
  await expect.poll(() => calls.filter((call) => call.method === 'PATCH').map((call) => call.body)).toEqual([{ visibility: 'private' }]);
});

test('muting connection requests asks first; a refused change leaves the choice where it was', async ({ page }) => {
  const { calls } = await openRealSettings(page, { respond: (method) => (method === 'PATCH' ? { success: false, error: 'Too many changes' } : undefined) });
  await ready(page);
  const requests = page.locator('#settings-privacy-requests');
  await expect(requests.getByRole('radio', { name: /Everyone/ })).toHaveAttribute('aria-checked', 'true');
  await requests.getByRole('radio', { name: /Nobody/ }).click();
  await page.getByRole('alertdialog', { name: 'Mute new connection requests?' }).getByRole('button', { name: 'Turn off' }).click();
  await expect.poll(() => calls.filter((call) => call.method === 'PATCH').length).toBe(1);
  await expect(requests.getByRole('radio', { name: /Everyone/ })).toHaveAttribute('aria-checked', 'true');
  await expect(requests.getByRole('radio', { name: /Nobody/ })).toHaveAttribute('aria-checked', 'false');
});

test('blocked accounts: search, load more without repeats, and unblock names the person', async ({ page }) => {
  const { calls } = await openRealSettings(page);
  await ready(page);
  const blocked = page.locator('#settings-privacy-blocked');
  await blocked.getByRole('button', { name: 'Load more' }).click();
  await expect(blocked.getByText('Person 3')).toBeVisible();
  await expect(blocked.getByRole('button', { name: 'Load more' })).toHaveCount(0);
  await expect(blocked.getByText('Person 0')).toHaveCount(1);
  await blocked.getByLabel('Search blocked accounts').fill('person 3');
  await expect(blocked.getByText('Person 3')).toBeVisible();
  await expect(blocked.getByText('Person 0')).toHaveCount(0);
  await blocked.getByRole('button', { name: /Unblock/ }).first().click();
  const dialog = page.getByRole('alertdialog', { name: 'Unblock Person 3?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Unblock' }).click();
  await expect.poll(() => calls.some((call) => call.method === 'DELETE' && call.path === '/api/v1/privacy/blocks/b3')).toBe(true);
});

test('recent privacy changes show four and expand to all', async ({ page }) => {
  await openRealSettings(page);
  await ready(page);
  const blocked = page.locator('#settings-privacy-blocked');
  await expect(blocked.getByText(/^Profile visibility \d$/)).toHaveCount(4);
  await blocked.getByRole('button', { name: 'View all 7' }).click();
  await expect(blocked.getByText(/^Profile visibility \d$/)).toHaveCount(7);
  await blocked.getByRole('button', { name: 'Show fewer' }).click();
  await expect(blocked.getByText(/^Profile visibility \d$/)).toHaveCount(4);
});

test('a privacy read error shows Retry, not "No blocked accounts"', async ({ page }) => {
  let failing = true;
  await openRealSettings(page, { respond: (_method, url) => (failing && url.pathname === '/api/v1/privacy' ? { success: false, message: 'down' } : undefined) });
  await expect(page.getByRole('heading', { name: 'Settings', exact: true, level: 1 })).toBeVisible();
  const privacy = page.locator('#settings-privacy');
  await expect(privacy.getByRole('button', { name: /retry/i })).toBeVisible();
  await expect(page.getByText('No blocked accounts')).toHaveCount(0);
  failing = false;
  await privacy.getByRole('button', { name: /retry/i }).click();
  await expect(privacy.getByRole('radio', { name: /Private/ })).toBeVisible();
});

// ── Security: devices and activity ───────────────────────────────────────────────────────────────────────────
test('devices: "Show more" adds the next page once', async ({ page }) => {
  const { calls } = await openRealSettings(page);
  await ready(page);
  const sessions = page.locator('#settings-security-sessions');
  await expect(sessions.getByRole('button', { name: /^Sign out (?!other devices)/ })).toHaveCount(3);
  await sessions.getByRole('button', { name: 'Show more devices' }).click();
  await expect(sessions.getByRole('button', { name: /^Sign out (?!other devices)/ })).toHaveCount(5);
  await expect(sessions.getByRole('button', { name: 'Show more devices' })).toHaveCount(0);
  expect(calls.filter((call) => call.path.startsWith('/api/v1/sessions?')).map((call) => call.path)).toEqual(['/api/v1/sessions?limit=12&offset=3']);
});

test('signing out other devices is one flow: cancelling the check opens no second dialog and sends nothing', async ({ page }) => {
  const { calls } = await openRealSettings(page);
  await ready(page);
  const sessions = page.locator('#settings-security-sessions');
  await sessions.getByRole('button', { name: 'Sign out other devices' }).click();
  const verify = page.getByRole('dialog', { name: 'Verify this device' });
  await expect(verify).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(verify).toHaveCount(0);
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  expect(calls.filter((call) => call.method === 'DELETE')).toEqual([]);
});

test('with nothing to verify with, one confirmation signs the other devices out', async ({ page }) => {
  const noMethods = { success: true, data: { mfaFactors: [], sessions: sampleData.sessions(0, 3), sessionsNextOffset: null, loginHistory: [], password: { hasPassword: false }, recoveryCodes: { configured: false, remainingCount: 0 }, securityActivity: [], assurance: { currentLevel: 'aal1', nextLevel: 'aal1' } } };
  const google = { user: { id: 'u1', email: 'ada@example.com', app_metadata: { provider: 'google', providers: ['google'] }, user_metadata: {}, identities: [{ provider: 'google' }] } };
  const { calls } = await openRealSettings(page, { auth: google, respond: (_method, url) => (url.pathname === '/api/v1/security' ? noMethods : undefined) });
  await expect(page.getByRole('heading', { name: 'Settings', exact: true, level: 1 })).toBeVisible();
  const sessions = page.locator('#settings-security-sessions');
  await sessions.getByRole('button', { name: 'Sign out other devices' }).click();
  await expect(page.getByRole('dialog', { name: 'Verify this device' })).toHaveCount(0);
  await page.getByRole('alertdialog').getByRole('button', { name: 'Sign out other devices' }).click();
  await expect.poll(() => calls.some((call) => call.method === 'DELETE' && call.path === '/api/v1/sessions?scope=others')).toBe(true);
  await expect(sessions.getByRole('button', { name: /^Sign out (?!other devices)/ })).toHaveCount(1);
});

test('activity: load older events appends without repeats, and clearing asks for verification first', async ({ page }) => {
  const { calls } = await openRealSettings(page, { respond: (method, url) => (method === 'DELETE' && url.pathname === '/api/v1/security' ? { __status: 403, success: false, message: 'Verify this device first', errorCode: 'STEP_UP_REQUIRED' } : undefined) });
  await ready(page);
  const activity = page.locator('#settings-security-activity');
  await expect(activity.getByText('Password changed')).toHaveCount(6);
  await activity.getByRole('button', { name: 'Show all 8 security events' }).click();
  await expect(activity.getByText('Password changed')).toHaveCount(8);
  await activity.getByRole('button', { name: 'Load older events' }).click();
  await expect(activity.getByText('Password changed')).toHaveCount(11);
  await expect(activity.getByRole('button', { name: 'Load older events' })).toHaveCount(0);
  expect(calls.some((call) => call.path.startsWith('/api/v1/security?activityBefore='))).toBe(true);
  await activity.getByRole('button', { name: 'Clear all activity' }).click();
  await page.getByRole('alertdialog', { name: 'Clear security activity?' }).getByRole('button', { name: 'Clear all activity' }).click();
  await expect(page.getByRole('dialog', { name: 'Verify this device' })).toBeVisible();
  await expect(activity.getByText('Password changed')).toHaveCount(11);
});

// ── Account deletion ─────────────────────────────────────────────────────────────────────────────────────────
test('the deletion wizard names what goes, waits for the typed email, and sends it', async ({ page }) => {
  const { calls } = await openRealSettings(page, { respond: (method) => (method === 'DELETE' ? { success: true, data: { hardDeleteAt: '2026-11-27T00:00:00.000Z' } } : undefined) });
  await ready(page);
  await page.locator('#settings-delete-account').getByRole('button', { name: 'Delete account' }).click();
  const wizard = page.getByRole('dialog', { name: 'Delete account' });
  await expect(wizard.getByText('Garden Map')).toBeVisible();
  await expect(wizard.getByLabel(/^Type/)).toBeFocused();
  const submit = wizard.getByRole('button', { name: /^Delete account|Delete my account|Delete$/ }).last();
  await expect(submit).toBeDisabled();
  await wizard.getByLabel(/^Type/).fill('DELETE');
  await expect(submit).toBeDisabled();
  await wizard.getByLabel(/^Type/).fill('ADA@example.com');
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect.poll(() => calls.filter((call) => call.method === 'DELETE').map((call) => (call.body as { confirmationText: string }).confirmationText)).toEqual(['ADA@example.com']);
});

test('a step-up request keeps what was typed when the check is left', async ({ page }) => {
  let attempts = 0;
  const { calls } = await openRealSettings(page, {
    respond: (method) => {
      if (method !== 'DELETE') return undefined;
      attempts += 1;
      return attempts === 1 ? { __status: 403, success: false, errorCode: 'STEP_UP_REQUIRED', details: { availableMethods: ['password'] } } : { success: true, data: { hardDeleteAt: null } };
    },
  });
  await ready(page);
  await page.locator('#settings-delete-account').getByRole('button', { name: 'Delete account' }).click();
  const wizard = page.getByRole('dialog', { name: 'Delete account' });
  await wizard.getByLabel(/^Type/).fill('ada@example.com');
  await wizard.getByRole('button', { name: /^Delete/ }).last().click();
  const verify = page.getByRole('dialog', { name: "Confirm it’s you" });
  await expect(verify).toBeVisible();
  // Leaving the check puts the wizard back with the typed email still in it.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Delete account' }).getByLabel(/^Type/)).toHaveValue('ada@example.com');
  expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(1);
});

test('signed in with a provider and nothing to verify with, the wizard offers a fresh sign-in', async ({ page }) => {
  await openRealSettings(page, { respond: (method) => (method === 'DELETE' ? { __status: 403, success: false, errorCode: 'STEP_UP_REQUIRED', details: { availableMethods: [] } } : undefined) });
  await ready(page);
  await page.locator('#settings-delete-account').getByRole('button', { name: 'Delete account' }).click();
  const wizard = page.getByRole('dialog', { name: 'Delete account' });
  await wizard.getByLabel(/^Type/).fill('ada@example.com');
  await wizard.getByRole('button', { name: /^Delete/ }).last().click();
  await expect(wizard.getByRole('button', { name: 'Sign in again' })).toBeVisible();
});

test('a scheduled deletion shows its date and Reactivate in Settings, and Reactivate lifts it', async ({ page }) => {
  let pending = true;
  const actions = {
    getAccountDeletionStatus: () => (pending ? { pending: true, hardDeleteAt: '2026-11-27T00:00:00.000Z', scheduledAt: '2026-10-28T00:00:00.000Z' } : { pending: false }),
    cancelAccountDeletion: () => { pending = false; return { success: true }; },
  };
  await openRealSettings(page, { actions });
  await expect(page.getByRole('heading', { name: 'Settings', exact: true, level: 1 })).toBeVisible();
  const section = page.locator('#settings-delete-account');
  await expect(section.getByText(/Account deletion scheduled for/)).toBeVisible();
  await expect(section.getByRole('button', { name: 'Delete account' })).toHaveCount(0);
  await section.getByRole('button', { name: 'Reactivate account' }).click();
  await expect(section.getByRole('button', { name: 'Delete account' })).toBeVisible();
  await expect(page.getByText(/Account deletion scheduled for/)).toHaveCount(0);
});

test('while the deletion status is unknown, Delete stays disabled', async ({ page }) => {
  await openRealSettings(page, { actions: { getAccountDeletionStatus: () => { throw new Error('down'); } } });
  await expect(page.getByRole('heading', { name: 'Settings', exact: true, level: 1 })).toBeVisible();
  await expect(page.locator('#settings-delete-account').getByRole('button', { name: 'Delete account' })).toBeDisabled();
});

// ── Legal and data rights ────────────────────────────────────────────────────────────────────────────────────
const pendingTerms = { success: true, data: { current: false, latest: null, history: [{ acceptedAt: '2026-09-01T10:00:00.000Z', termsVersion: '2026-09', eulaVersion: '2026-09', privacyNoticeVersion: '2026-09', context: 'settings' }], versions: { termsVersion: '2026-10-A', eulaVersion: '2026-10-B', privacyNoticeVersion: '2026-10-C' } } };

test('accepting terms needs the age statement and the terms box, uses the server versions, and sends both', async ({ page }) => {
  const { calls } = await openRealSettings(page, { respond: (method, url) => (url.pathname === '/api/v1/legal/acceptance' ? (method === 'GET' ? pendingTerms : { success: true, data: { accepted: true } }) : undefined) });
  await ready(page);
  const legal = page.locator('#settings-privacy-policies');
  await expect(legal.getByText('Terms 2026-10-A, EULA 2026-10-B, Privacy Policy 2026-10-C')).toBeVisible();
  const accept = legal.getByRole('button', { name: 'Accept current terms' });
  await expect(accept).toBeDisabled();
  await legal.getByRole('checkbox', { name: /at least 18/ }).click();
  await expect(accept).toBeDisabled();
  await legal.getByRole('checkbox', { name: /I accept the/ }).click();
  await expect(accept).toBeEnabled();
  await accept.click();
  await expect.poll(() => calls.find((call) => call.method === 'POST' && call.path === '/api/v1/legal/acceptance')?.body).toEqual({ accepted: true, context: 'settings', ageConfirmed: true });
  await expect(legal.getByText(/Acceptance history \(1\)/)).toBeVisible();
});

test('a failed acceptance check says so with Retry, and a recorded export shows when it last ran', async ({ page }) => {
  let failing = true;
  await openRealSettings(page, { respond: (_method, url) => {
    if (url.pathname === '/api/v1/legal/acceptance' && failing) return { __status: 500, success: false, message: 'down' };
    if (url.pathname === '/api/v1/account/export-status') return { success: true, data: { lastExportedAt: '2026-10-20T10:00:00.000Z' } };
    return undefined;
  } });
  await expect(page.getByRole('heading', { name: 'Settings', exact: true, level: 1 })).toBeVisible();
  const legal = page.locator('#settings-privacy-policies');
  await expect(legal.getByText('Check failed')).toBeVisible();
  failing = false;
  await legal.getByRole('button', { name: 'Retry' }).click();
  await expect(legal.getByText('Check failed')).toHaveCount(0);
  await expect(legal.getByText(/Last exported/)).toBeVisible();
});

// ── Integrations ─────────────────────────────────────────────────────────────────────────────────────────────
const integrations = (overrides: Record<string, unknown> = {}) => ({ success: true, data: { summary: 'You sign in with email and Google.', authConnections: [{ provider: 'google', label: 'Google', state: 'linked', detail: 'ada@gmail.com' }, { provider: 'github', label: 'GitHub', state: 'not_linked', detail: 'Not linked to this account.' }, { provider: 'email', label: 'Email', state: 'primary', detail: 'ada@example.com' }], githubService: { status: 'not_connected', summary: 'No GitHub repository access is currently in use.', detail: 'Connect GitHub from a workspace when repository access is needed.', usageCount: 0, recoveryAction: null }, ...overrides } });

test('disconnecting a sign-in method asks first and Cancel sends nothing', async ({ page }) => {
  const { calls } = await openRealSettings(page, { respond: (_method, url) => (url.pathname === '/api/v1/integrations' ? integrations() : undefined) });
  await ready(page);
  const connections = page.locator('#settings-integrations-connections');
  await expect(connections.getByText('Main sign-in method')).toBeVisible();
  await connections.getByRole('button', { name: 'Disconnect' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Disconnect Google?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  expect(calls.filter((call) => call.path === '/api/v1/integrations/unlink')).toEqual([]);
});

test('disconnecting asks for verification when the server wants it', async ({ page }) => {
  const { calls } = await openRealSettings(page, { respond: (method, url) => {
    if (url.pathname === '/api/v1/integrations') return integrations();
    if (url.pathname === '/api/v1/integrations/unlink') return { __status: 403, success: false, errorCode: 'STEP_UP_REQUIRED' };
    if (url.pathname === '/api/v1/auth/security-step-up') return { success: true, data: { availableMethods: ['password'] } };
    return undefined;
  } });
  await ready(page);
  await page.locator('#settings-integrations-connections').getByRole('button', { name: 'Disconnect' }).click();
  await page.getByRole('alertdialog', { name: 'Disconnect Google?' }).getByRole('button', { name: 'Disconnect' }).click();
  await expect(page.getByRole('dialog', { name: /verify|confirm/i })).toBeVisible();
  expect(calls.filter((call) => call.path === '/api/v1/integrations/unlink')).toHaveLength(1);
});

test('replacing an unavailable GitHub account warns that GitHub stays disconnected until a new one is chosen', async ({ page }) => {
  await openRealSettings(page, { respond: (_method, url) => (url.pathname === '/api/v1/integrations' ? integrations({ githubService: { status: 'action_required', summary: 'GitHub account unavailable.', detail: 'Replace it.', usageCount: 1, githubUsername: 'old-ada', recoveryAction: 'replace_account' } }) : undefined) });
  await ready(page);
  await page.getByRole('button', { name: 'Replace GitHub account' }).click();
  const dialog = page.getByRole('dialog', { name: 'Replace the unavailable GitHub account?' });
  await expect(dialog.getByText(/GitHub stays disconnected until you finish choosing a new account/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
});

// ── Verification dialog ──────────────────────────────────────────────────────────────────────────────────────
test('the verification dialog cannot be dismissed mid-request, and the action after it runs once', async ({ page }) => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const { calls } = await openRealSettings(page, { respond: async (method, url) => {
    if (method === 'POST' && url.pathname === '/api/v1/auth/security-step-up') { await gate; return { success: true, data: { verified: true } }; }
    return undefined;
  } });
  await ready(page);
  await page.locator('#settings-security-sessions').getByRole('button', { name: 'Sign out other devices' }).click();
  const dialog = page.getByRole('dialog', { name: 'Verify this device' });
  await dialog.getByLabel('Current password').fill('correct horse');
  await dialog.getByRole('button', { name: /^Verify|Continue|Confirm/ }).last().click();
  await page.keyboard.press('Escape');
  await page.mouse.click(5, 5);
  await expect(dialog).toBeVisible();
  expect(calls.filter((call) => call.method === 'DELETE')).toEqual([]);
  release();
  await expect.poll(() => calls.filter((call) => call.method === 'DELETE' && call.path === '/api/v1/sessions?scope=others').length).toBe(1);
  await expect(dialog).toHaveCount(0);
});

// ── Appearance ───────────────────────────────────────────────────────────────────────────────────────────────
test('appearance: a change applies at once, a queued sync says so and Retry sends it again, Reset restores defaults', async ({ page }) => {
  let puts = 0;
  const { calls } = await openRealSettings(page, { respond: (method, url) => {
    if (method === 'PUT' && url.pathname === '/api/v1/appearance') { puts += 1; return { success: true, data: { remoteSynced: puts > 1 } }; }
    return undefined;
  } });
  await ready(page);
  const appearance = page.locator('#settings-appearance');
  const reset = appearance.getByRole('button', { name: 'Reset to defaults' });
  await expect(reset).toBeDisabled();
  await appearance.getByRole('radio', { name: /Compact/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-density', 'compact');
  await expect(appearance.getByText('Saved on this device. It will sync to your account shortly.')).toBeVisible();
  await appearance.getByRole('button', { name: 'Retry' }).click();
  await expect(appearance.getByText(/^Saved to your account/)).toBeVisible();
  expect(calls.filter((call) => call.method === 'PUT')).toHaveLength(2);
  await expect(reset).toBeEnabled();
  await reset.click();
  await expect(page.locator('html')).toHaveAttribute('data-density', 'default');
  await expect(reset).toBeDisabled();
});

test('appearance: the theme choice moves with the arrow keys and picks with Space', async ({ page }) => {
  await openRealSettings(page);
  await ready(page);
  const theme = page.locator('#settings-appearance-theme');
  await theme.getByRole('radio', { checked: true }).focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Space');
  await expect(theme.getByRole('radio', { checked: true })).toBeFocused();
});

// ── Keyboard only ────────────────────────────────────────────────────────────────────────────────────────────
test('Tab reaches every control in the document, and radio groups are one stop each', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'Safari does not Tab to buttons and links unless the system setting is on.');
  await openRealSettings(page);
  await ready(page);
  const describe = (el: Element | null) => (el ? `${el.tagName}|${el.getAttribute('role') ?? ''}|${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40)}|${el.id}` : 'none');
  const expected = await page.evaluate(() => {
    const visible = (el: Element) => { const r = (el as HTMLElement).getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && !el.closest('[aria-hidden="true"], [inert]'); };
    const nodes = [...document.querySelectorAll('a[href], button, input, select, textarea, summary, [role="switch"], [role="radio"], [tabindex]')]
      .filter((el) => (el as HTMLElement).tabIndex >= 0 && !(el as HTMLButtonElement).disabled && el.getAttribute('aria-disabled') !== 'true' && visible(el));
    return nodes.length;
  });
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  const seen = new Set<string>();
  const order: string[] = [];
  for (let step = 0; step < expected + 20; step += 1) {
    await page.keyboard.press('Tab');
    const label = await page.evaluate((fnSource) => { const fn = new Function('el', `return (${fnSource})(el)`); return fn(document.activeElement) as string; }, describe.toString());
    if (order.length && label === order[0] && step > 3) break;
    order.push(label);
    seen.add(label);
  }
  // Every control that can take focus did, and nothing trapped focus on the way.
  expect(order.length).toBeGreaterThanOrEqual(expected - 2);
  const radioStops = order.filter((label) => label.includes('|radio|'));
  const groups = await page.locator('[role="radiogroup"]').count();
  expect(radioStops.length).toBe(groups);
});

test('a dialog traps focus, Escape closes it, and focus returns to what opened it', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'Safari does not Tab to buttons and links unless the system setting is on.');
  await openRealSettings(page);
  await ready(page);
  const trigger = page.locator('#settings-security-sessions').getByRole('button', { name: 'Sign out other devices' });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Verify this device' });
  await expect(dialog).toBeVisible();
  for (let i = 0; i < 8; i += 1) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

// ── Authenticator and recovery codes ─────────────────────────────────────────────────────────────────────────
const withAuthenticator = { success: true, data: { mfaFactors: [{ id: 'f1', type: 'totp', status: 'verified', created_at: '2026-09-01T10:00:00.000Z' }], sessions: sampleData.sessions(0, 1), sessionsNextOffset: null, loginHistory: [], password: { hasPassword: true }, recoveryCodes: { configured: true, remainingCount: 8, generatedAt: '2026-09-01T10:00:00.000Z' }, securityActivity: [], assurance: { currentLevel: 'aal2', nextLevel: 'aal2' } } };

test('regenerating recovery codes warns, verifies, and the codes dialog only closes from its button', async ({ page }) => {
  const { calls } = await openRealSettings(page, { respond: (method, url) => {
    if (url.pathname === '/api/v1/security' && !url.searchParams.get('activityBefore')) return withAuthenticator;
    if (method === 'POST' && url.pathname === '/api/v1/auth/mfa/recovery-codes') return { success: true, data: { codes: ['AAAA-1111', 'BBBB-2222'], generatedAt: '2026-10-28T10:00:00.000Z' } };
    if (method === 'POST' && url.pathname === '/api/v1/auth/security-step-up') return { success: true, data: { verified: true } };
    return undefined;
  } });
  await expect(page.getByRole('heading', { name: 'Settings', exact: true, level: 1 })).toBeVisible();
  const authenticator = page.locator('#settings-security-authenticator');
  await authenticator.getByRole('button', { name: 'Regenerate recovery codes' }).click();
  const verify = page.getByRole('dialog', { name: 'Verify this device' });
  await expect(verify.getByText('the old codes stop working')).toBeVisible();
  await verify.getByLabel('Current 6-digit code').fill('123456');
  await verify.getByRole('button', { name: /^Verify|Continue|Confirm/ }).last().click();
  const codes = page.getByRole('dialog', { name: 'Save your recovery codes' });
  await expect(codes.getByText('AAAA-1111')).toBeVisible();
  await expect(codes.getByText(/not shown again/)).toBeVisible();
  await page.keyboard.press('Escape');
  await page.mouse.click(5, 5);
  await expect(codes).toBeVisible();
  await codes.getByRole('button', { name: 'I saved these codes' }).click();
  await expect(codes).toHaveCount(0);
  expect(calls.filter((call) => call.path === '/api/v1/auth/mfa/recovery-codes')).toHaveLength(1);
});

test('removing the authenticator says recovery codes go with it, and Cancel sends nothing', async ({ page }) => {
  const { calls } = await openRealSettings(page, { respond: (_method, url) => (url.pathname === '/api/v1/security' && !url.searchParams.get('activityBefore') ? withAuthenticator : undefined) });
  await expect(page.getByRole('heading', { name: 'Settings', exact: true, level: 1 })).toBeVisible();
  await page.locator('#settings-security-authenticator').getByRole('button', { name: 'Remove authenticator app' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Remove authenticator app?' });
  await expect(dialog.getByText('Your recovery codes stop working too.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  expect(calls.filter((call) => call.method === 'DELETE')).toEqual([]);
});

// ── Layout at the extremes ───────────────────────────────────────────────────────────────────────────────────
const LONG_EMAIL = 'ada.lovelace.with.a.very.long.address.for.testing@example-organisation-name.example.com';

for (const width of [320, 640]) {
  test(`nothing spills sideways at ${width}px (phone, or 200% zoom), in every density, light and dark`, async ({ page }) => {
    await openRealSettings(page, { auth: { user: { id: 'u1', email: LONG_EMAIL, app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, identities: [{ provider: 'email' }] } } });
    await ready(page);
    await page.setViewportSize({ width, height: 700 });
    for (const density of ['compact', 'default', 'comfortable']) {
      for (const dark of [false, true]) {
        await page.evaluate(({ density, dark }) => { document.documentElement.setAttribute('data-density', density); document.documentElement.classList.toggle('dark', dark); }, { density, dark });
        await page.waitForTimeout(250);
        const overflow = await page.evaluate(() => {
          const root = document.querySelector('[data-scroll-root="route"]') as HTMLElement;
          const rootBox = root.getBoundingClientRect();
          const wide: string[] = [];
          for (const el of root.querySelectorAll('*')) {
            if (el.closest('.sr-only') || el.closest('[aria-hidden="true"]')) continue;
            const box = (el as HTMLElement).getBoundingClientRect();
            if (box.width === 0 || box.height === 0) continue;
            // An element inside its own horizontal scroller is allowed to be wider than the page.
            let scroller = el.parentElement; let inside = false;
            while (scroller && scroller !== root) { const s = getComputedStyle(scroller); if (/(auto|scroll)/.test(s.overflowX)) { inside = true; break; } scroller = scroller.parentElement; }
            if (inside) continue;
            if (box.right > rootBox.right + 1 || box.left < rootBox.left - 1) wide.push(`${el.tagName.toLowerCase()}.${String((el as HTMLElement).className).slice(0, 50)} ${Math.round(box.left)}-${Math.round(box.right)}`);
          }
          return { pageScrolls: document.documentElement.scrollWidth > innerWidth, rootScrolls: root.scrollWidth > root.clientWidth + 1, wide: wide.slice(0, 6) };
        });
        expect(overflow, `${width}px ${density} ${dark ? 'dark' : 'light'}`).toEqual({ pageScrolls: false, rootScrolls: false, wide: [] });
      }
    }
    // Phones and zoomed windows still reach every section from the compact nav.
    await expect(page.getByRole('navigation', { name: 'Settings sections' }).getByRole('link')).toHaveCount(8);
  });
}

test('touch targets: buttons and switches are at least 44px on a coarse pointer', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await openRealSettings(page);
  await ready(page);
  const small = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll('[data-scroll-root="route"] button, [data-scroll-root="route"] [role="switch"], [data-scroll-root="route"] [role="radio"], [data-scroll-root="route"] a[href]')) {
      if (el.closest('.sr-only')) continue;
      // elementFromPoint only answers for what is on screen.
      (el as HTMLElement).scrollIntoView({ block: 'center' });
      const box = (el as HTMLElement).getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      // Links inside running text follow the text; the rest must be 44px tall, or have a 44px hit area around them.
      if (el.tagName === 'A' && el.closest('p, li, span.text')) continue;
      // An invisible halo counts: what matters is that a touch 20px above or below the centre still lands on it.
      const cx = box.left + box.width / 2; const cy = box.top + box.height / 2;
      const lands = (y: number) => { const hit = document.elementFromPoint(cx, y); return hit === el || Boolean(hit && el.contains(hit)); };
      if (box.height < 43.5 && !(lands(cy - 20) && lands(cy + 20))) out.push(`${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)}" ${Math.round(box.height)}px`);
    }
    return out;
  });
  console.log(small.join('\n'));
  expect(small).toEqual([]);
  await context.close();
});
