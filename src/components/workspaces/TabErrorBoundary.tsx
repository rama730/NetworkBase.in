"use client";

import { Component, ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { logger } from "@/lib/logger";

const STACK_PREFIX_COMPONENT_LIMIT = 4;
const NORMALIZED_MESSAGE_LIMIT = 160;

function hashToken(input: string): string {
    let hash = 0x811c9dc5;
    for (let i = 0; i < input.length; i += 1) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
}

function normalizeErrorMessage(rawMessage: string): string {
    const normalized = rawMessage
        .toLowerCase()
        .replace(/\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/g, "<email>")
        .replace(/\bhttps?:\/\/\S+/g, "<url>")
        .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/g, "<uuid>")
        .replace(/\b0x[0-9a-f]+\b/g, "<hex>")
        .replace(/(?:[a-z]:)?[\\/][^\s)]+/g, "<path>")
        .replace(/\b\d+\b/g, "<num>")
        .replace(/["'`][^"'`]{1,120}["'`]/g, "<str>")
        .replace(/\s+/g, " ")
        .trim();

    if (!normalized) return "empty";
    return normalized.slice(0, NORMALIZED_MESSAGE_LIMIT);
}

function sanitizeComponentStackPrefix(componentStack: string): string {
    const names = componentStack
        .split("\n")
        .map((line) => line.trim())
        .map((line) => (line.startsWith("at ") ? line.slice(3) : line))
        .map((line) => line.match(/^[A-Za-z0-9_$.-]+/)?.[0] ?? "")
        .map((name) => name.replace(/[^A-Za-z0-9_$.-]/g, ""))
        .filter((name): name is string => name.length > 0)
        .slice(0, STACK_PREFIX_COMPONENT_LIMIT);

    return names.length > 0 ? names.join(">") : "stack_unavailable";
}

interface TabErrorBoundaryProps {
    children: ReactNode;
    tabName: string;
    fillContainer?: boolean;
}

interface TabErrorBoundaryState {
    hasError: boolean;
    error?: Error;
    retryCount: number;
}

export class TabErrorBoundary extends Component<TabErrorBoundaryProps, TabErrorBoundaryState> {
    constructor(props: TabErrorBoundaryProps) {
        super(props);
        this.state = { hasError: false, retryCount: 0 };
    }

    static getDerivedStateFromError(error: Error): Partial<TabErrorBoundaryState> {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        const componentStack = errorInfo.componentStack || "";
        const errorName = error.name || "Error";
        const sanitizedMessageHash = hashToken(normalizeErrorMessage(error.message || ""));
        const safeStackPrefix = sanitizeComponentStackPrefix(componentStack);
        const stackHash = `${this.props.tabName}:${errorName}:${sanitizedMessageHash}:${safeStackPrefix}`;
        const safePayload = {
            tabName: this.props.tabName,
            errorName,
            sanitizedMessageHash,
            safeStackPrefix,
            stackHash,
            retryCount: this.state.retryCount,
        };
        logger.error("Error in project tab", { ...safePayload, digest: (error as Error & { digest?: string }).digest });
        logger.metric("project.tab.error", {
            ...safePayload,
        });
    }

    render() {
        const containerClassName = this.props.fillContainer
            ? "h-full min-h-0 flex flex-col"
            : undefined;

        if (this.state.hasError) {
            // Raw messages can carry internals; show the reference the log line carries instead.
            const error = this.state.error as (Error & { digest?: string }) | undefined;
            const reference = error?.digest ?? hashToken(normalizeErrorMessage(error?.message || ""));
            return (
                <div className={containerClassName}>
                    <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-8 text-center">
                        <AlertTriangle className="w-12 h-12 text-destructive mx-auto mb-4" aria-hidden="true" />
                        <h2 className="text-lg font-semibold text-foreground mb-2">
                            Something went wrong in {this.props.tabName}
                        </h2>
                        <p className="text-sm text-muted-foreground mb-4">
                            This tab could not load. Try again; if it keeps failing, share reference{" "}
                            <span className="font-mono">{reference}</span>.
                        </p>
                        <button
                            type="button"
                            onClick={() =>
                                this.setState((prev) => ({
                                    hasError: false,
                                    error: undefined,
                                    retryCount: prev.retryCount + 1,
                                }))
                            }
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors text-sm font-medium"
                        >
                            <RefreshCw className="w-4 h-4" aria-hidden="true" />
                            Try again
                        </button>
                    </div>
                </div>
            );
        }

        return (
            <div
                key={`${this.props.tabName}:${this.state.retryCount}`}
                className={containerClassName}
            >
                {this.props.children}
            </div>
        );
    }
}

export default TabErrorBoundary;
