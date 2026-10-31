import * as Sentry from "@sentry/nextjs";

// ponytail: Node only, no edge config. ceiling: an edge route would go unreported. upgrade: add one with the first edge route (Proxy runs on Node).
// ponytail: no tracing. ceiling: no slow-request breakdown. upgrade: set tracesSampleRate when Railway metrics can't explain slowness.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { baseSentryOptions } = await import("@/lib/observability/sentry-options");
  Sentry.init({
    ...baseSentryOptions(),
    integrations: [Sentry.captureConsoleIntegration({ levels: ["error"] })],
  });
}

export const onRequestError = Sentry.captureRequestError;
