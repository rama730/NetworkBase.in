import { fetchProviderUrl, GITHUB_API_HOSTS } from '@/lib/security/outbound-url';

const REQUEST_TIMEOUT_MS = (() => {
  const v = Number(process.env.GITHUB_API_TIMEOUT_MS || 12000);
  return Number.isFinite(v) && v >= 1000 ? Math.floor(v) : 12000;
})();
const TRANSIENT_STATUS = new Set([429, 500, 502, 503, 504]);

export function createTimeoutSignal(timeoutMs: number = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('GitHub request timed out')), timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timer),
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** An answer GitHub gave on purpose: asking again cannot change it. */
class GithubResponseError extends Error {}

/**
 * One request with bounded retries (PERF-010). Only network failures, transient statuses and rate
 * limits are retried, a server-sent Retry-After is honoured only when it fits what is left of the
 * total budget, and the whole call (attempts and waits) never exceeds `budgetMs`.
 */
export async function fetchGithubJson<T>(
  url: string,
  init: RequestInit,
  options: { retries?: number; timeoutMs?: number; budgetMs?: number; send?: typeof fetchProviderUrl } = {},
): Promise<{ data: T; status: number; headers: Headers }> {
  const send = options.send ?? fetchProviderUrl;
  const retries = options.retries ?? 2;
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const deadline = Date.now() + (options.budgetMs ?? timeoutMs * 2);
  let attempt = 0;

  const backoffMs = () => Math.min(2000, 250 * (attempt + 1) * (attempt + 1) + Math.floor(Math.random() * 150));
  /** Waits and returns true when another attempt still fits the budget. */
  const waitForRetry = async (delayMs: number) => {
    if (attempt >= retries || Date.now() + delayMs >= deadline) return false;
    attempt += 1;
    await sleep(delayMs);
    return true;
  };

  while (true) {
    const timeout = createTimeoutSignal(Math.max(250, Math.min(timeoutMs, deadline - Date.now())));
    try {
      const response = await send(url, GITHUB_API_HOSTS, {
        ...init,
        signal: timeout.signal,
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(init.headers || {}),
        },
      });

      const bodyText = await response.text();
      let body: unknown = null;
      if (bodyText.trim().length > 0) {
        try {
          body = JSON.parse(bodyText);
        } catch {
          body = bodyText;
        }
      }

      if (response.ok) {
        return { data: body as T, status: response.status, headers: response.headers };
      }

      const message =
        typeof body === 'object' && body && 'message' in body
          ? String((body as Record<string, unknown>).message || '')
          : typeof body === 'string'
            ? body
            : '';
      const rateLimited = /rate limit/i.test(message) || response.headers.get('x-ratelimit-remaining') === '0';
      const retryable = TRANSIENT_STATUS.has(response.status) || (response.status === 403 && rateLimited);
      if (retryable) {
        const retryAfterSeconds = Number(response.headers.get('retry-after') || '0');
        const delayMs = retryAfterSeconds > 0 ? retryAfterSeconds * 1000 + Math.floor(Math.random() * 150) : backoffMs();
        if (await waitForRetry(delayMs)) continue;
      }

      throw new GithubResponseError(`GitHub request failed (${response.status})${message ? `: ${message}` : ''}`);
    } catch (error) {
      if (!(error instanceof GithubResponseError) && (await waitForRetry(backoffMs()))) continue;
      throw error;
    } finally {
      timeout.cleanup();
    }
  }
}
