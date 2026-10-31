import type { Event } from "@sentry/nextjs";

import { scrubMessage } from "@/lib/logger";

function withoutQuery(url: string) {
  return url.split(/[?#]/)[0];
}

const BREADCRUMB_URL_KEYS = ["url", "from", "to"];

// Error reports leave our infrastructure, so anything that can carry a secret or private content is removed here.
export function scrubEvent<T extends Event>(event: T): T {
  if (event.message) event.message = scrubMessage(event.message);

  for (const exception of event.exception?.values ?? []) {
    if (exception.value) exception.value = scrubMessage(exception.value);
  }

  if (event.request) {
    if (event.request.url) event.request.url = withoutQuery(event.request.url);
    delete event.request.query_string;
    delete event.request.cookies;
    delete event.request.headers;
    delete event.request.data;
  }

  if (event.extra) delete event.extra.arguments;

  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.filter((breadcrumb) => breadcrumb.category !== "console");
    for (const { data } of event.breadcrumbs) {
      for (const key of BREADCRUMB_URL_KEYS) {
        if (typeof data?.[key] === "string") data[key] = withoutQuery(data[key]);
      }
    }
  }

  return event;
}

// Read directly: NEXT_PUBLIC_ values are inlined by name into the browser bundle.
function sentryDsn() {
  return process.env.NEXT_PUBLIC_SENTRY_DSN?.trim() || undefined;
}

export function isSentryEnabled() {
  return Boolean(sentryDsn());
}

export function baseSentryOptions() {
  return {
    dsn: sentryDsn(),
    enabled: isSentryEnabled(),
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT?.trim() || "production",
    sendDefaultPii: false,
    beforeSend: scrubEvent,
  };
}
