// Talking to NetworkBase (report A12.1, A12.2, A2.4, A2.6). Retries reads and keyed writes on network errors,
// 408/429/5xx with backoff and Retry-After; every write carries one Idempotency-Key for all its attempts, so a
// retry never writes twice (finding 72). Errors come back as CliError with the server's code and a next step.
import crypto from "node:crypto";

import { CliError } from "./errors.mjs";

const RETRY_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 5;
const RETRY_BUDGET_MS = 60_000;

const sleep = (/** @type {number} */ ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Next step for common server codes (A4.7: every error ends with what to do). */
const HINTS = /** @type {Record<string, string>} */ ({
  NEEDS_CONFIRMATION: "Show this to the person; if they agree, run the same command again with --confirm <token> (in --json: error.details.confirmToken)",
  UNAUTHORIZED: "Run nb login",
  SCOPE_MISSING: "Allow it in Settings → Integrations: Change access for an agent, or a token with more access",
  ACCESS_REQUESTED: "The person answers in NetworkBase (their inbox, or Settings → Integrations); run the same command again once they have",
  ACCESS_DENIED_BY_PERSON: "The person said no for 24 hours: leave this one to them",
  FORBIDDEN: "Check you're a member of this workspace with nb whoami",
  RATE_LIMITED: "Wait a minute and try again",
  VERSION_CONFLICT: "Run nb pull, then push again — or nb resolve <path>",
  SECRET_DETECTED: "Remove the secret, or push again with --confirm-secrets if it's safe to share",
  CLIENT_TOO_OLD: "Update: npm i -g @networkbase/cli@latest (or use npx @networkbase/cli@latest)",
});

/**
 * @param {{ origin: string, token: string | null, version: string, fetchImpl?: typeof fetch, onRetry?: (info: { attempt: number, waitMs: number, reason: string }) => void, confirmToken?: string | null, onUndo?: (u: { token: string, method: string, path: string, summary: string | null }) => void, dryRun?: boolean }} options
 *   confirmToken: the person's yes for a held agent change (sent as X-NB-Confirm); onUndo: called with every undo
 *   token a write returns, so `nb undo` can use it (report A2.8, A2.9).
 */
export function createApi({ origin, token, version, fetchImpl = fetch, onRetry, confirmToken = null, onUndo, dryRun = false, keySeed = null }) {
  // With a seed (an agent's retryKey, report D10), the nth write gets the same key on every try, so a retry after a
  // failure halfway is replayed by the server for the steps already done instead of done twice.
  let writes = 0;
  /**
   * @param {"GET" | "POST" | "PUT" | "PATCH" | "DELETE"} method
   * @param {string} path
   * @param {{ query?: Record<string, string | number | boolean | string[] | undefined | null>, body?: unknown, key?: string, timeoutMs?: number, auth?: boolean, headers?: Record<string, string> }} [options]
   */
  async function request(method, path, options = {}) {
    if (options.auth !== false && !token) {
      throw new CliError("NOT_SIGNED_IN", `You're not signed in to ${new URL(origin).host}`, { hint: "Run nb login" });
    }
    // --dry-run on every write command (C3): reads go ahead, the first change stops here and is shown instead.
    if (dryRun && method !== "GET" && !path.startsWith("/api/v1/device/") && path !== "/api/v1/extension/auth-code") {
      throw new CliError("DRY_RUN", `Dry run: would ${method} ${path}`, { details: { method, path, body: options.body ?? null } });
    }
    const url = new URL(path, origin);
    // An array repeats the key (nb fs read a b: ?path=a&path=b).
    for (const [k, v] of Object.entries(options.query ?? {})) for (const x of [v].flat()) if (x !== undefined && x !== null && x !== "") url.searchParams.append(k, String(x));
    const body = options.body === undefined ? undefined : JSON.stringify(options.body);
    const key = method === "GET" ? null : options.key ?? (keySeed ? `nbk_${crypto.createHash("sha256").update(`${keySeed}:${writes++}`).digest("hex").slice(0, 40)}` : crypto.randomUUID());
    const timeoutMs = options.timeoutMs ?? 20_000 + Math.ceil((body?.length ?? 0) / (256 * 1024)) * 1000;
    /** @type {Record<string, string>} */
    const headers = {
      accept: "application/json",
      "user-agent": `networkbase-cli/${version} (${process.platform}-${process.arch}; node ${process.versions.node})`,
      "x-nb-client": `cli/${version}`,
      // Kept for the 1.x session table's device details.
      "x-extension-version": version,
      "x-editor-host": "cli",
      "x-editor-name": "NetworkBase CLI",
      "x-editor-platform": `${process.platform}-${process.arch}`,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(token && options.auth !== false ? { authorization: `Bearer ${token}` } : {}),
      ...(key ? { "idempotency-key": key } : {}),
      ...(confirmToken && method !== "GET" ? { "x-nb-confirm": confirmToken } : {}),
      ...options.headers,
    };

    const started = Date.now();
    let lastReason = "";
    for (let attempt = 1; ; attempt++) {
      /** @type {Response} */
      let response;
      try {
        response = await fetchImpl(url, { method, headers, body, signal: AbortSignal.timeout(timeoutMs) });
      } catch (error) {
        lastReason = describeNetworkError(error, timeoutMs);
        if (attempt < MAX_ATTEMPTS && Date.now() - started < RETRY_BUDGET_MS) {
          await backoff(attempt, null, lastReason);
          continue;
        }
        throw new CliError("OFFLINE", `Can't reach ${url.host}: ${lastReason}`, { hint: "Check your connection, or run nb doctor" });
      }

      if (RETRY_STATUS.has(response.status) && attempt < MAX_ATTEMPTS && Date.now() - started < RETRY_BUDGET_MS) {
        lastReason = `HTTP ${response.status}`;
        await backoff(attempt, response.headers.get("retry-after"), lastReason);
        continue;
      }
      if (response.status === 304) return { notModified: true };
      const text = await response.text();
      /** @type {any} */
      let payload = null;
      try {
        payload = text ? JSON.parse(text) : null;
      } catch {
        if (!response.ok) throw new CliError("SERVER_ERROR", `${url.host} answered HTTP ${response.status}`, { status: response.status, hint: response.status >= 500 ? "Try again in a minute" : undefined });
        throw new CliError("SERVER_ERROR", `${url.host} sent an answer the CLI can't read`, { status: response.status });
      }
      if (!response.ok || payload?.success === false) {
        const code = response.status === 401 ? "UNAUTHORIZED" : payload?.errorCode ?? `HTTP_${response.status}`;
        const message = payload?.message ?? `${url.host} answered HTTP ${response.status}`;
        throw new CliError(code, message, { status: response.status, details: payload?.details, hint: HINTS[code] });
      }
      const data = payload?.data !== undefined ? payload.data : payload;
      if (method !== "GET" && data && typeof data.undoToken === "string") onUndo?.({ token: data.undoToken, method, path: url.pathname, summary: typeof data.undone === "string" ? data.undone : null });
      return data;
    }

    /** @param {number} attempt @param {string | null} retryAfter @param {string} reason */
    async function backoff(attempt, retryAfter, reason) {
      const fromHeader = retryAfter ? (/^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now()) : NaN;
      const waitMs = Number.isFinite(fromHeader) && fromHeader > 0 ? Math.min(fromHeader, 30_000) : Math.round(500 * 2 ** (attempt - 1) * (0.5 + Math.random()));
      onRetry?.({ attempt, waitMs, reason });
      await sleep(waitMs);
    }
  }

  /**
   * A streamed download (file bytes), retried on network errors and 5xx like any read.
   * @param {string} path @param {Record<string, string>} query
   * @returns {Promise<Response>}
   */
  async function download(path, query) {
    if (!token) throw new CliError("NOT_SIGNED_IN", `You're not signed in to ${new URL(origin).host}`, { hint: "Run nb login" });
    const url = new URL(path, origin);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    const started = Date.now();
    for (let attempt = 1; ; attempt++) {
      try {
        const response = await fetchImpl(url, { headers: { authorization: `Bearer ${token}`, "user-agent": `networkbase-cli/${version}`, "x-nb-client": `cli/${version}` }, signal: AbortSignal.timeout(10 * 60_000) });
        if (response.ok) return response;
        if (!RETRY_STATUS.has(response.status) || attempt >= MAX_ATTEMPTS || Date.now() - started > RETRY_BUDGET_MS) {
          const payload = /** @type {any} */ (await response.json().catch(() => null));
          throw new CliError(payload?.errorCode ?? `HTTP_${response.status}`, payload?.message ?? `Download failed (HTTP ${response.status})`, { status: response.status, details: payload?.details });
        }
      } catch (error) {
        if (error instanceof CliError) throw error;
        if (attempt >= MAX_ATTEMPTS || Date.now() - started > RETRY_BUDGET_MS) throw new CliError("OFFLINE", `Can't reach ${url.host}: ${describeNetworkError(error, 600_000)}`, { hint: "Check your connection" });
      }
      await sleep(Math.round(500 * 2 ** (attempt - 1) * (0.5 + Math.random())));
    }
  }

  return {
    origin,
    request,
    download,
    /** @param {string} path @param {Parameters<typeof request>[2]} [o] */
    get: (path, o) => request("GET", path, o),
    /** @param {string} path @param {unknown} body @param {Parameters<typeof request>[2]} [o] */
    post: (path, body, o) => request("POST", path, { ...o, body }),
    /** @param {string} path @param {unknown} body @param {Parameters<typeof request>[2]} [o] */
    patch: (path, body, o) => request("PATCH", path, { ...o, body }),
    /** @param {string} path @param {unknown} body @param {Parameters<typeof request>[2]} [o] */
    put: (path, body, o) => request("PUT", path, { ...o, body }),
    /** @param {string} path @param {Parameters<typeof request>[2]} [o] */
    delete: (path, o) => request("DELETE", path, o),
  };
}

/** @param {unknown} error @param {number} timeoutMs */
export function describeNetworkError(error, timeoutMs) {
  const e = /** @type {any} */ (error);
  if (e?.name === "TimeoutError" || e?.name === "AbortError") return `no answer after ${Math.round(timeoutMs / 1000)} s`;
  const code = e?.cause?.code ?? e?.code;
  if (code === "ENOTFOUND") return "the server name doesn't resolve";
  if (code === "ECONNREFUSED") return "connection refused";
  // A company proxy that opens HTTPS signs with its own certificate; Node names that several ways (T16 live test:
  // UNABLE_TO_VERIFY_LEAF_SIGNATURE showed raw).
  if (["UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "SELF_SIGNED_CERT_IN_CHAIN", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "DEPTH_ZERO_SELF_SIGNED_CERT", "CERT_UNTRUSTED", "UNABLE_TO_GET_ISSUER_CERT"].includes(code)) return "your network's certificate isn't trusted. Ask IT for its certificate file, then: nb config set ca-file <file.pem>";
  return code ? String(code) : e?.message ?? "network error";
}

/** @typedef {ReturnType<typeof createApi>} Api */
