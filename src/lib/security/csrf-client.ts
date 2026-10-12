import { CSRF_HEADER_NAME, CSRF_REJECTED_HEADER } from "@/lib/security/csrf-constants";

const CSRF_ENDPOINT = "/api/v1/security/csrf";

type FetchLike = typeof fetch;

function isMutatingMethod(method: string | null | undefined) {
  const normalized = (method || "GET").toUpperCase();
  return normalized === "POST" || normalized === "PUT" || normalized === "PATCH" || normalized === "DELETE";
}

/** A body that can be sent a second time unchanged (a stream or a Request body cannot). */
function isReplayable(input: RequestInfo | URL, init?: RequestInit) {
  if (input instanceof Request) return false;
  const body = init?.body;
  return body == null || typeof body === "string" || body instanceof URLSearchParams || body instanceof FormData || body instanceof Blob || body instanceof ArrayBuffer;
}

/**
 * Wraps fetch so same-origin mutations carry the CSRF header (the cookie is httpOnly, so the token
 * comes from a dedicated endpoint). The token is cached for the page's life; when the server answers
 * with its CSRF-rejection marker the cache is dropped, and because a CSRF rejection means the request
 * did not run, a replayable request is retried once with a fresh token (API-012). Anything else is never replayed.
 */
export function createCsrfFetch(originalFetch: FetchLike, isSameOrigin: (input: RequestInfo | URL) => boolean): FetchLike {
  let cached: Promise<string | null> | null = null;

  const load = async (): Promise<string | null> => {
    try {
      const response = await originalFetch(CSRF_ENDPOINT, { method: "GET", credentials: "include", headers: { accept: "application/json" } });
      if (!response.ok) return null;
      const token = ((await response.json()) as { data?: { token?: string } })?.data?.token;
      return typeof token === "string" && token.includes(".") ? token : null;
    } catch {
      return null;
    }
  };
  const resolve = () => {
    cached ??= load().then((token) => {
      if (!token) cached = null; // let the next mutation try again
      return token;
    });
    return cached;
  };

  const send = async (input: RequestInfo | URL, init: RequestInit | undefined, token: string) => {
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (!headers.has(CSRF_HEADER_NAME)) headers.set(CSRF_HEADER_NAME, token);
    return input instanceof Request ? originalFetch(new Request(input, { ...init, headers })) : originalFetch(input, { ...init, headers });
  };

  return async (input, init) => {
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    if (!isMutatingMethod(method) || !isSameOrigin(input)) return originalFetch(input, init);

    const token = await resolve();
    // Without a token the request goes out unadorned; the server rejects it and the caller can retry.
    if (!token) return originalFetch(input, init);

    const response = await send(input, init, token);
    if (response.status !== 403 || response.headers.get(CSRF_REJECTED_HEADER) !== "1") return response;

    cached = null;
    if (!isReplayable(input, init)) return response;
    const fresh = await resolve();
    // An explicit caller-supplied header is the caller's to refresh.
    if (!fresh || (init?.headers && new Headers(init.headers).has(CSRF_HEADER_NAME))) return response;
    return send(input, init, fresh);
  };
}
