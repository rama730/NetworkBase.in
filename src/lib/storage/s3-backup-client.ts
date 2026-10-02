import "server-only";

import { createHash, createHmac } from "node:crypto";

export interface S3BackupConfig {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  region: string;
  bucket: string;
  endpoint: string;
}

export interface S3BackupObject {
  assetId: string;
  sourceBucket: string;
  sourceKey: string;
  contentLength: number;
  contentType: string;
  sha256: string;
}

function required(name: string): string | null {
  const value = process.env[name]?.trim();
  return value || null;
}

export function getS3BackupConfig(): S3BackupConfig | null {
  const accessKeyId = required("STORAGE_BACKUP_AWS_ACCESS_KEY_ID");
  const secretAccessKey = required("STORAGE_BACKUP_AWS_SECRET_ACCESS_KEY");
  const region = required("STORAGE_BACKUP_AWS_REGION");
  const bucket = required("STORAGE_BACKUP_AWS_BUCKET");
  if (!accessKeyId || !secretAccessKey || !region || !bucket) return null;
  const endpoint = process.env.STORAGE_BACKUP_AWS_ENDPOINT?.trim()
    || `https://${bucket}.s3.${region}.amazonaws.com`;
  return {
    accessKeyId,
    secretAccessKey,
    sessionToken: process.env.STORAGE_BACKUP_AWS_SESSION_TOKEN?.trim() || undefined,
    region,
    bucket,
    endpoint: endpoint.replace(/\/$/, ""),
  };
}

function hmac(key: string | Buffer, value: string): Buffer {
  return createHmac("sha256", key).update(value).digest();
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function amzTimestamp(now: Date) {
  return now.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function encodeKeySegment(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function buildBackupKey(object: Pick<S3BackupObject, "assetId" | "sourceBucket" | "sourceKey">) {
  const sourceDigest = sha256(`${object.sourceBucket}\0${object.sourceKey}`);
  return `assets/${object.assetId}/${sourceDigest}`;
}

function signedHeaders(params: {
  config: S3BackupConfig;
  method: "PUT" | "HEAD" | "GET";
  key: string;
  headers: Record<string, string>;
  now: Date;
}) {
  const url = new URL(`${params.config.endpoint}/${params.key.split("/").map(encodeKeySegment).join("/")}`);
  const amzDate = amzTimestamp(params.now);
  const date = amzDate.slice(0, 8);
  const headers: Record<string, string> = {
    host: url.host,
    "x-amz-content-sha256": "UNSIGNED-PAYLOAD",
    "x-amz-date": amzDate,
    ...params.headers,
  };
  if (params.config.sessionToken) {
    headers["x-amz-security-token"] = params.config.sessionToken;
  }
  const names = Object.keys(headers).map((name) => name.toLowerCase()).sort();
  const canonicalHeaders = names.map((name) => `${name}:${headers[name]!.trim().replace(/\s+/g, " ")}\n`).join("");
  const canonicalRequest = [
    params.method,
    url.pathname,
    "",
    canonicalHeaders,
    names.join(";"),
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const scope = `${date}/${params.config.region}/s3/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256(canonicalRequest)}`;
  const dateKey = hmac(`AWS4${params.config.secretAccessKey}`, date);
  const regionKey = hmac(dateKey, params.config.region);
  const serviceKey = hmac(regionKey, "s3");
  const signingKey = hmac(serviceKey, "aws4_request");
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${params.config.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`;
  delete headers.host;
  return { url, headers };
}

export async function putS3Backup(params: {
  config: S3BackupConfig;
  object: S3BackupObject;
  body: ReadableStream<Uint8Array>;
  signal?: AbortSignal;
}) {
  const key = buildBackupKey(params.object);
  const request = signedHeaders({
    config: params.config,
    method: "PUT",
    key,
    now: new Date(),
    headers: {
      "content-length": String(params.object.contentLength),
      "content-type": params.object.contentType,
      "x-amz-meta-source-sha256": params.object.sha256,
      "x-amz-server-side-encryption": "AES256",
    },
  });
  const response = await fetch(request.url, {
    method: "PUT",
    headers: request.headers,
    body: params.body,
    signal: params.signal,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  if (!response.ok) {
    throw new Error(`S3 backup PUT failed with HTTP ${response.status}`);
  }
  return key;
}

export async function verifyS3Backup(params: {
  config: S3BackupConfig;
  key: string;
  contentLength: number;
  sha256: string;
  signal?: AbortSignal;
}) {
  const request = signedHeaders({
    config: params.config,
    method: "HEAD",
    key: params.key,
    now: new Date(),
    headers: {},
  });
  const response = await fetch(request.url, {
    method: "HEAD",
    headers: request.headers,
    signal: params.signal,
  });
  if (!response.ok) throw new Error(`S3 backup HEAD failed with HTTP ${response.status}`);
  const length = Number(response.headers.get("content-length"));
  const digest = response.headers.get("x-amz-meta-source-sha256");
  if (length !== params.contentLength || digest !== params.sha256) {
    throw new Error("S3 backup verification metadata mismatch");
  }

  const getRequest = signedHeaders({
    config: params.config,
    method: "GET",
    key: params.key,
    now: new Date(),
    headers: {},
  });
  const object = await fetch(getRequest.url, {
    method: "GET",
    headers: getRequest.headers,
    signal: params.signal,
  });
  if (!object.ok || !object.body) {
    throw new Error(`S3 backup verification GET failed with HTTP ${object.status}`);
  }
  const hash = createHash("sha256");
  const reader = object.body.getReader();
  let verifiedBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      verifiedBytes += value.byteLength;
      if (verifiedBytes > params.contentLength) {
        await reader.cancel("Backup object exceeded the expected size");
        throw new Error("S3 backup verification size mismatch");
      }
      hash.update(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (verifiedBytes !== params.contentLength || hash.digest("hex") !== params.sha256) {
    throw new Error("S3 backup verification content mismatch");
  }
}
