import { captureException } from "@sentry/nextjs";

import { inngest } from "../client";

const FUNCTION_ID = "report-failure-to-sentry";

export function reportInngestFailure(data: {
    function_id: string;
    run_id: string;
    error: { name?: string; message: string; stack?: string };
}) {
    if (data.function_id.endsWith(FUNCTION_ID)) return;

    const error = new Error(data.error.message);
    if (data.error.name) error.name = data.error.name;
    if (data.error.stack) error.stack = data.error.stack;

    captureException(error, {
        fingerprint: ["inngest", data.function_id],
        tags: { function_id: data.function_id, run_id: data.run_id },
    });
}

/**
 * Inngest catches a job's errors itself, so Sentry only hears about them here.
 * The event fires once, after the job's retries run out, so a retry that recovers emails nobody.
 */
export const reportFailureToSentry = inngest.createFunction(
    { id: FUNCTION_ID, retries: 0 },
    { event: "inngest/function.failed" },
    async ({ event }) => {
        reportInngestFailure(event.data);
    },
);
