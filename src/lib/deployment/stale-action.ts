import { toast } from "@/lib/feedback";

// An internal Next.js header; tests/unit/stale-action.test.ts fails if an upgrade renames it.
const ACTION_NOT_FOUND_HEADER = "x-nextjs-action-not-found";
const NOTICE_ID = "stale-action-notice";

export function isStaleActionResponse(response: Response) {
  return response.headers.get(ACTION_NOT_FOUND_HEADER) === "1";
}

/** A button rather than an automatic reload: the person may have unsaved typing on the page. */
export function showStaleActionNotice() {
  toast.warning("NetworkBase was updated. Reload to continue.", {
    id: NOTICE_ID,
    duration: 0,
    action: { label: "Reload", onClick: () => window.location.reload() },
  });
}

/**
 * A tab left open across a deploy calls actions the new build no longer has. Next.js throws, and callers that catch
 * their own errors show something generic, so this watches every request from the one place they all pass through.
 */
export function withStaleActionNotice(fetchImpl: typeof fetch, notify: () => void = showStaleActionNotice): typeof fetch {
  return async (input, init) => {
    const response = await fetchImpl(input, init);
    if (isStaleActionResponse(response)) {
      try {
        notify();
      } catch {
        // The failed action still reaches its caller; a missing notice must not change that.
      }
    }
    return response;
  };
}
