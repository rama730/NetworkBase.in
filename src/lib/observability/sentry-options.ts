import type { ErrorEvent, Event, EventHint } from "@sentry/nextjs";

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

  // No IP address or location: only the opaque id, so we can tell how many people an error reached.
  // An empty geo stops Sentry working out a city from the connection.
  event.user = { ...(event.user?.id ? { id: event.user.id } : {}), geo: {} };

  if (event.request) {
    if (event.request.url) event.request.url = withoutQuery(event.request.url);
    delete event.request.query_string;
    delete event.request.cookies;
    delete event.request.headers;
    delete event.request.data;
    delete event.request.env;
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

// Sentry 11 collects all of this unless told otherwise; sendDefaultPii no longer exists. Source lines around a frame stay on: they are our own code.
const DATA_COLLECTION = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  mcp: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
};

// logger.error reports directly, so its console line must not arrive a second time through the console integration.
function beforeSend(event: ErrorEvent, _hint: EventHint) {
  if (event.logger === "console") {
    const consoleArguments = event.extra?.arguments;
    if (Array.isArray(consoleArguments) && consoleArguments[0] === "[logger]") return null;
    // A logged line has no Error of its own: Sentry would title and group it by a minified function in its console wrapper.
    if (event.message) {
      event.fingerprint = ["console", scrubMessage(event.message)];
      for (const exception of event.exception?.values ?? []) {
        exception.type = "console.error";
        if (exception.mechanism) exception.mechanism.synthetic = false;
      }
    }
  }
  return scrubEvent(event);
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
    dataCollection: DATA_COLLECTION,
    beforeSend,
  };
}
