/**
 * Sign-in with a code (report A3.1–A3.3): a terminal without a browser asks for a code, the person approves it at
 * /device in a signed-in browser, and the terminal's next poll gets a token. Only the hash of the code the terminal
 * polls with is stored, and the token is made once, at that poll, with only its hash kept.
 */
import crypto from "node:crypto";
import { and, desc, eq, gt, isNull, lt, or } from "drizzle-orm";

import { db } from "@/lib/db";
import { deviceCodes, extensionDeviceSessionEvents, extensionDeviceSessions, workspaceMembers, workspaces } from "@/lib/db/schema";
import { EXTENSION_DEVICE_SESSION_EVENTS } from "@/lib/extension/session-events";
import { AGENT_BASE_SCOPES, AGENT_EXTRA_SCOPES, type TokenScope } from "@/lib/security/token-access";

export const DEVICE_CODE_TTL_MS = 10 * 60_000;
export const DEVICE_POLL_INTERVAL_S = 5;
/** Letters a person won't misread (no I, L, O, U, 0, 1). */
const USER_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";

import { AGENT_EXPIRY_DAYS } from "@/lib/extension/device-decision";
export { AGENT_EXPIRY_DAYS };
export const DEVICE_EXPIRY_DAYS = 90;

const hash = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

function userCode() {
  const pick = () => USER_CODE_ALPHABET[crypto.randomInt(USER_CODE_ALPHABET.length)];
  return `${Array.from({ length: 4 }, pick).join("")}-${Array.from({ length: 4 }, pick).join("")}`;
}

/** `abcd efgh`, `ABCDEFGH` and `ABCD-EFGH` are the same code. */
export function normalizeUserCode(input: string) {
  const plain = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return plain.length === 8 ? `${plain.slice(0, 4)}-${plain.slice(4)}` : null;
}

export type DeviceCodeRequest = {
  clientName: string;
  deviceName: string;
  clientVersion?: string | null;
  platform?: string | null;
  type?: "device" | "agent";
  agentName?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  /** An OAuth authorization request for the hosted MCP server (0080): where to send the person back, and PKCE. */
  oauth?: { clientId: string; redirectUri: string; state: string | null; codeChallenge: string };
};

export async function createDeviceCode(input: DeviceCodeRequest, now = new Date()) {
  // Old codes are only useful for a few minutes; clearing them here keeps the table small without a job.
  await db.delete(deviceCodes).where(lt(deviceCodes.expiresAt, new Date(now.getTime() - 24 * 60 * 60_000)));
  const deviceCode = crypto.randomBytes(32).toString("base64url");
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = userCode();
    const [row] = await db
      .insert(deviceCodes)
      .values({
        deviceCodeHash: hash(deviceCode),
        userCode: code,
        clientName: input.clientName.slice(0, 80),
        deviceName: input.deviceName.slice(0, 120),
        clientVersion: input.clientVersion?.slice(0, 40) ?? null,
        platform: input.platform?.slice(0, 40) ?? null,
        requestedType: input.type ?? "device",
        agentName: input.agentName?.slice(0, 80) ?? null,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent?.slice(0, 240) ?? null,
        expiresAt: new Date(now.getTime() + DEVICE_CODE_TTL_MS),
        createdAt: now,
        ...(input.oauth ? { oauthClientId: input.oauth.clientId, redirectUri: input.oauth.redirectUri, oauthState: input.oauth.state, codeChallenge: input.oauth.codeChallenge } : {}),
      })
      .onConflictDoNothing({ target: deviceCodes.userCode })
      .returning({ userCode: deviceCodes.userCode, expiresAt: deviceCodes.expiresAt });
    if (row) return { deviceCode, userCode: row.userCode, expiresAt: row.expiresAt };
  }
  throw new Error("Couldn't pick a free sign-in code");
}

export type PollResult =
  | { status: "pending" | "slow_down" | "denied" | "expired" }
  | { status: "approved"; token: string; tokenType: "device" | "agent"; workspaceId: string | null; expiresAt: Date };

/**
 * One poll from the terminal. An approved code turns into a token exactly once: the status moves to consumed in
 * the same transaction that creates the session, so two polls can't both get a token.
 */
export async function pollDeviceCode(deviceCode: string, now = new Date()): Promise<PollResult> {
  const codeHash = hash(deviceCode);
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(deviceCodes).where(eq(deviceCodes.deviceCodeHash, codeHash)).limit(1).for("update");
    if (!row || row.status === "consumed" || row.expiresAt <= now) return { status: "expired" } as const;
    if (row.status === "denied") return { status: "denied" } as const;
    if (row.status === "pending") {
      const tooSoon = row.lastPolledAt && now.getTime() - row.lastPolledAt.getTime() < (DEVICE_POLL_INTERVAL_S - 1) * 1000;
      await tx.update(deviceCodes).set({ lastPolledAt: now }).where(eq(deviceCodes.id, row.id));
      return { status: tooSoon ? "slow_down" : "pending" } as const;
    }

    return issueApprovedToken(tx, row, now, "device_code");
  });
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * An approved code's token, made once: the row moves to consumed in the caller's transaction, which holds it locked.
 * Device sign-in (the terminal's poll) and OAuth (the token endpoint) both end here.
 */
export async function issueApprovedToken(tx: Tx, row: typeof deviceCodes.$inferSelect, now: Date, method: "device_code" | "oauth") {
  {
    const tokenType = row.tokenType ?? "device";
    const rawToken = `${tokenType === "agent" ? "nb_agt_" : "nb_dev_"}${crypto.randomBytes(24).toString("hex")}`;
    const expiresAt = row.tokenExpiresAt ?? new Date(now.getTime() + DEVICE_EXPIRY_DAYS * 86_400_000);
    const [session] = await tx
      .insert(extensionDeviceSessions)
      .values({
        userId: row.userId!,
        tokenHash: hash(rawToken),
        tokenPrefix: rawToken.slice(0, 11),
        deviceName: row.deviceName,
        clientVersion: row.clientVersion ?? "pending",
        scopes: row.scopes ?? [],
        tokenType,
        agentName: row.agentName,
        workspaceId: row.workspaceId,
        ipAddress: row.ipAddress,
        userAgent: row.userAgent,
        editorName: row.clientName,
        editorPlatform: row.platform,
        expiresAt,
        createdAt: now,
        lastSeenAt: now,
      })
      .returning({ id: extensionDeviceSessions.id });
    await tx.update(deviceCodes).set({ status: "consumed", sessionId: session!.id }).where(eq(deviceCodes.id, row.id));
    await tx.insert(extensionDeviceSessionEvents).values({
      sessionId: session!.id,
      eventType: EXTENSION_DEVICE_SESSION_EVENTS.login,
      ipAddress: row.ipAddress,
      userAgent: row.userAgent,
      metadata: { method, tokenType, agentName: row.agentName, workspaceId: row.workspaceId },
      createdAt: now,
    });
    return { status: "approved", token: rawToken, tokenType, workspaceId: row.workspaceId, scopes: row.scopes ?? [], expiresAt } as const;
  }
}

/** What the approval page shows for a code, or null when there's no such pending code. */
export async function findPendingDeviceCode(code: string, now = new Date()) {
  const normalized = normalizeUserCode(code);
  if (!normalized) return null;
  const [row] = await db.select().from(deviceCodes).where(and(eq(deviceCodes.userCode, normalized), eq(deviceCodes.status, "pending"))).limit(1);
  if (!row || row.expiresAt <= now) return null;
  return {
    userCode: row.userCode,
    clientName: row.clientName,
    deviceName: row.deviceName,
    clientVersion: row.clientVersion,
    platform: row.platform,
    requestedType: row.requestedType,
    agentName: row.agentName,
    ipAddress: row.ipAddress,
    /** An editor's OAuth request (hosted MCP): only an agent sign-in, and the browser goes back to the editor. */
    viaOAuth: Boolean(row.oauthClientId),
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  };
}

export type DeviceDecision =
  | { decision: "deny" }
  | { decision: "approve"; type: "device" }
  | { decision: "approve"; type: "agent"; workspaceId: string; expiryDays: (typeof AGENT_EXPIRY_DAYS)[number]; extraScopes: TokenScope[] };

/** Records the person's answer. Access to the workspace is checked by the caller (the server action). */
export async function decideDeviceCode(userId: string, code: string, decision: DeviceDecision, now = new Date()) {
  const normalized = normalizeUserCode(code);
  if (!normalized) return false;
  const values =
    decision.decision === "deny"
      ? { status: "denied" as const, userId, decidedAt: now }
      : decision.type === "agent"
        ? {
            status: "approved" as const,
            userId,
            decidedAt: now,
            tokenType: "agent" as const,
            workspaceId: decision.workspaceId,
            scopes: [...AGENT_BASE_SCOPES, ...decision.extraScopes.filter((s) => AGENT_EXTRA_SCOPES.includes(s))],
            tokenExpiresAt: new Date(now.getTime() + decision.expiryDays * 86_400_000),
          }
        : { status: "approved" as const, userId, decidedAt: now, tokenType: "device" as const, scopes: [], tokenExpiresAt: new Date(now.getTime() + DEVICE_EXPIRY_DAYS * 86_400_000) };
  const updated = await db
    .update(deviceCodes)
    .set(values)
    .where(and(eq(deviceCodes.userCode, normalized), eq(deviceCodes.status, "pending"), gt(deviceCodes.expiresAt, now)))
    .returning({ id: deviceCodes.id });
  return updated.length === 1;
}

/** Workspaces an agent token can be approved for: ones the person can change (owner, or a member who isn't a viewer). */
export async function listAgentWorkspaces(userId: string) {
  const rows = await db
    .select({ id: workspaces.id, title: workspaces.title, slug: workspaces.slug, ownerId: workspaces.ownerId, role: workspaceMembers.role })
    .from(workspaces)
    .leftJoin(workspaceMembers, and(eq(workspaceMembers.projectId, workspaces.id), eq(workspaceMembers.userId, userId)))
    .where(and(isNull(workspaces.deletedAt), or(eq(workspaces.ownerId, userId), eq(workspaceMembers.userId, userId))))
    .orderBy(desc(workspaces.updatedAt))
    .limit(100);
  return rows.filter((r) => r.ownerId === userId || (r.role && r.role !== "viewer")).map(({ id, title, slug }) => ({ id, title, slug }));
}
