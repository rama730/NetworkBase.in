const MAX_PRIVATE_STREAM_MS = 4 * 60 * 1000;

export type ByteRange = { start: number; end: number };

export function enforceExactByteLength(
  body: ReadableStream<Uint8Array>,
  expectedBytes: number,
) {
  let receivedBytes = 0;
  return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      receivedBytes += chunk.byteLength;
      if (receivedBytes > expectedBytes) {
        controller.error(new Error("Storage provider exceeded the authorized byte range"));
        return;
      }
      controller.enqueue(chunk);
    },
    flush(controller) {
      if (receivedBytes !== expectedBytes) {
        controller.error(new Error("Storage provider returned an incomplete byte range"));
      }
    },
  }));
}

export function parseSingleByteRange(value: string | null, totalSize: number): ByteRange | null {
  if (!value) return null;
  if (!Number.isSafeInteger(totalSize) || totalSize < 0 || value.includes(",")) {
    throw new RangeError("Unsupported byte range");
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2]) || totalSize === 0) {
    throw new RangeError("Unsupported byte range");
  }

  let start: number;
  let end: number;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      throw new RangeError("Unsupported byte range");
    }
    start = Math.max(0, totalSize - suffixLength);
    end = totalSize - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : totalSize - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) {
      throw new RangeError("Unsupported byte range");
    }
  }
  if (start < 0 || end < start || start >= totalSize) {
    throw new RangeError("Unsatisfiable byte range");
  }
  return { start, end: Math.min(end, totalSize - 1) };
}

export function safeContentDisposition(filename: string, disposition: "inline" | "attachment") {
  const cleaned = filename.trim().replace(/[\"\r\n]/g, "_").slice(0, 255) || "download";
  return `${disposition}; filename="${cleaned}"; filename*=UTF-8''${encodeURIComponent(cleaned)}`;
}

// Only types a browser renders without running script may be served inline from the app origin.
// Everything else (HTML, XML, SVG, unknown) downloads as opaque bytes so uploads can never execute here.
const INLINE_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/bmp"]);

export function inlineSafeMimeType(mimeType: string | null | undefined): string | null {
  const base = mimeType?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (INLINE_IMAGE_TYPES.has(base) || base === "application/pdf" || base === "text/plain") return base;
  if (/^(video|audio)\/[a-z0-9][a-z0-9.+-]*$/.test(base)) return base;
  return null;
}

export async function streamPrivateObject(input: {
  request: Request;
  signedUrl: string;
  totalSize?: number | null;
  mimeType: string | null | undefined;
  filename: string;
  disposition: "inline" | "attachment";
  etag: string;
  cacheControl?: string;
}) {
  const safeType = inlineSafeMimeType(input.mimeType);
  const disposition = safeType ? input.disposition : "attachment";
  const baseHeaders = new Headers({
    "Accept-Ranges": "bytes",
    "Cache-Control": input.cacheControl ?? "private, no-store",
    "Content-Disposition": safeContentDisposition(input.filename, disposition),
    "Content-Type": safeType ?? "application/octet-stream",
    ETag: input.etag,
    "X-Content-Type-Options": "nosniff",
    Vary: "Cookie, Authorization",
  });
  // Chromium's PDF viewer refuses to render under a sandbox CSP; PDFs are inert data otherwise.
  if (safeType !== "application/pdf") baseHeaders.set("Content-Security-Policy", "sandbox; default-src 'none'");

  if (input.request.headers.get("if-none-match") === input.etag) {
    return new Response(null, { status: 304, headers: baseHeaders });
  }

  let range: ByteRange | null;
  try {
    const rangeHeader = input.request.headers.get("range");
    if (rangeHeader && !Number.isSafeInteger(input.totalSize)) throw new RangeError("Unknown object size");
    range = parseSingleByteRange(rangeHeader, input.totalSize ?? 0);
  } catch {
    if (Number.isSafeInteger(input.totalSize)) baseHeaders.set("Content-Range", `bytes */${input.totalSize}`);
    return new Response(null, { status: 416, headers: baseHeaders });
  }

  const contentLength: number | null = range
    ? range.end - range.start + 1
    : typeof input.totalSize === "number" && Number.isSafeInteger(input.totalSize)
      ? input.totalSize
      : null;
  if (contentLength !== null) baseHeaders.set("Content-Length", String(contentLength));
  if (range) baseHeaders.set("Content-Range", `bytes ${range.start}-${range.end}/${input.totalSize!}`);
  if (input.request.method === "HEAD") {
    return new Response(null, { status: range ? 206 : 200, headers: baseHeaders });
  }

  const timeoutSignal = AbortSignal.timeout(MAX_PRIVATE_STREAM_MS);
  const signal = AbortSignal.any([input.request.signal, timeoutSignal]);
  let upstream: Response;
  try {
    upstream = await fetch(input.signedUrl, {
      cache: "no-store",
      headers: range ? { Range: `bytes=${range.start}-${range.end}` } : undefined,
      signal,
    });
  } catch {
    return new Response("Storage provider unavailable", {
      status: 502,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
  if (!upstream.body || (upstream.status !== 200 && upstream.status !== 206)) {
    await upstream.body?.cancel().catch(() => undefined);
    return new Response("Object unavailable", {
      status: upstream.status === 404 ? 404 : 502,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
  if (range && upstream.status !== 206) {
    await upstream.body.cancel().catch(() => undefined);
    return new Response("Storage provider ignored byte range", {
      status: 502,
      headers: { "Cache-Control": "private, no-store" },
    });
  }

  const upstreamLength = upstream.headers.get("content-length");
  if (
    contentLength !== null
    && upstreamLength !== null
    && Number(upstreamLength) !== contentLength
  ) {
    await upstream.body.cancel().catch(() => undefined);
    return new Response("Storage provider returned an unexpected byte length", {
      status: 502,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
  if (range) {
    const expectedContentRange = `bytes ${range.start}-${range.end}/${input.totalSize!}`;
    if (upstream.headers.get("content-range") !== expectedContentRange) {
      await upstream.body.cancel().catch(() => undefined);
      return new Response("Storage provider returned an unexpected byte range", {
        status: 502,
        headers: { "Cache-Control": "private, no-store" },
      });
    }
  }

  const responseBody = contentLength === null
    ? upstream.body
    : enforceExactByteLength(upstream.body, contentLength);

  return new Response(responseBody, {
    status: range ? 206 : 200,
    headers: baseHeaders,
  });
}
