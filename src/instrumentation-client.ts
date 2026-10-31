import { init } from "@sentry/nextjs";

import { baseSentryOptions } from "@/lib/observability/sentry-options";

// ponytail: posts straight to Sentry, no tunnel route. ceiling: ad blockers hide some browser errors. upgrade: set tunnelRoute if browser errors look under-reported.
// ponytail: browser console.error is not captured. ceiling: errors a component catches itself are missed. upgrade: route them through logger.error.
init(baseSentryOptions());
