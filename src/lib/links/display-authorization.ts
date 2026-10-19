/** Display freshness only. Reads and destination actions still enforce authorization. */
export const PREVIEW_DISPLAY_LEASE_MS = 60_000;
export const PREVIEW_REFRESH_MS = 30_000;
export const PREVIEW_RETENTION_MS = 5 * 60_000;
export const PREVIEW_REQUEST_TIMEOUT_MS = 15_000;

export type PreviewDisplayAuthorization = {
  viewerId: string;
  /** SHA-256 of the verified session ID; never expose the raw session or token. */
  sessionBinding: string;
  resourceKey: string;
  issuedAt: string;
  expiresAt: string;
};

export function normalizeDisplayAuthorization(value: unknown): PreviewDisplayAuthorization | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  if (typeof data.viewerId !== 'string' || !/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(data.viewerId)
    || typeof data.sessionBinding !== 'string' || !/^[a-f\d]{64}$/.test(data.sessionBinding)
    || typeof data.resourceKey !== 'string' || !data.resourceKey || data.resourceKey.length > 2048
    || typeof data.issuedAt !== 'string' || typeof data.expiresAt !== 'string') return null;
  const duration = Date.parse(data.expiresAt) - Date.parse(data.issuedAt);
  if (!Number.isFinite(duration) || duration <= 0 || duration > PREVIEW_DISPLAY_LEASE_MS) return null;
  return { viewerId: data.viewerId, sessionBinding: data.sessionBinding, resourceKey: data.resourceKey,
    issuedAt: data.issuedAt, expiresAt: data.expiresAt };
}

export async function previewSessionBinding(sessionId: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sessionId));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Charge the entire request's elapsed time; clock skew or slow reads cannot extend the lease. */
export function previewDisplayDeadline(authorization: PreviewDisplayAuthorization | null, input: {
  viewerId: string | null; sessionBinding: string | null; resourceKey: string | null;
  startedAt: number; serverTime: number;
}): number {
  if (!authorization || !input.viewerId || !input.sessionBinding || !input.resourceKey
    || authorization.viewerId !== input.viewerId || authorization.sessionBinding !== input.sessionBinding
    || authorization.resourceKey !== input.resourceKey || !Number.isFinite(input.serverTime)) return 0;
  // HTTP Date has second precision: it must never move a sub-second token deadline backwards.
  const serverTime = Math.max(input.serverTime, Date.parse(authorization.issuedAt));
  const remaining = Math.min(PREVIEW_DISPLAY_LEASE_MS, Date.parse(authorization.expiresAt) - serverTime);
  return remaining > 0 ? input.startedAt + remaining : 0;
}
