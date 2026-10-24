import { createHmac, timingSafeEqual } from "node:crypto";

const PREVIEW_HMAC_SECRET = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXTAUTH_SECRET || "nb-preview-stateless-secret-key-32b";

export interface PreviewTokenPayload {
  projectId: string;
  nodeId: string;
  storageKey: string;
  filename: string;
  mimeType: string;
  size: number;
  version: number;
  exp: number; // Unix timestamp in seconds
}

export function generatePreviewHmacToken(payload: PreviewTokenPayload): string {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", PREVIEW_HMAC_SECRET).update(data).digest("base64url");
  return `${data}.${sig}`;
}

export function verifyPreviewHmacToken(token: string): PreviewTokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [data, sig] = parts;
  const expectedSig = createHmac("sha256", PREVIEW_HMAC_SECRET).update(data).digest("base64url");
  if (sig.length !== expectedSig.length) return null;
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (!timingSafeEqual(sigBuf, expBuf)) return null;

  try {
    const payload = JSON.parse(Buffer.from(data, "base64url").toString("utf-8")) as PreviewTokenPayload;
    if (!payload || typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}
