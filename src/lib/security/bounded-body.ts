// Dependency-free so edge-adjacent modules (auth snapshot) can share it.
/**
 * Reads at most `maxBytes` of a response body, cancelling the stream once the limit is reached or the
 * request's signal aborts (API-004). `truncated` reports that more data was available.
 */
export async function readBoundedBody(response: Response, maxBytes: number) {
  const reader = response.body?.getReader();
  if (!reader) return { bytes: new Uint8Array(0), truncated: false };
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
    if (total >= maxBytes) truncated = true;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const bytes = new Uint8Array(Math.min(total, maxBytes));
  let offset = 0;
  for (const chunk of chunks) {
    const take = Math.min(chunk.length, bytes.length - offset);
    if (take <= 0) break;
    bytes.set(chunk.subarray(0, take), offset);
    offset += take;
  }
  return { bytes, truncated };
}
