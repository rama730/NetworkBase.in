"use client";

import { memo, useLayoutEffect, useRef } from "react";
import { ArrowLeft, ArrowRight, Check, CheckCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { DashboardCardHeader } from "./DashboardCard";
import { formatJourneyCompletionDate, getStageCompletionTooltip } from "@/lib/projects/journey-completion";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

interface JourneyTimelineProps {
    stages: string[];
    currentStageIndex: number;
    isCreator: boolean;
    onAdvanceStage?: () => void;
    onRedoStage?: () => void;
    stageCompletionDates?: Record<string, string>;
    layout?: "horizontal" | "rail";
}

export const JOURNEY_VISIBLE_STAGE_COUNT = 5;

export function getJourneyStageWindow(stageCount: number, currentStageIndex: number) {
    const count = Math.max(0, Math.trunc(Number.isFinite(stageCount) ? stageCount : 0));
    const visibleCount = Math.min(JOURNEY_VISIBLE_STAGE_COUNT, count);
    const lastIndex = Math.max(0, count - 1);
    const safeCurrentStageIndex = Math.min(Math.max(0, Math.trunc(Number.isFinite(currentStageIndex) ? currentStageIndex : 0)), lastIndex);
    const start = count <= visibleCount
        ? 0
        : Math.min(Math.max(safeCurrentStageIndex - Math.floor(visibleCount / 2), 0), count - visibleCount);

    return {
        start,
        end: start + visibleCount,
        currentStageIndex: safeCurrentStageIndex,
    };
}

export function getJourneyCenteredScrollLeft({
    itemOffsetLeft,
    itemWidth,
    containerWidth,
    scrollWidth,
}: {
    itemOffsetLeft: number;
    itemWidth: number;
    containerWidth: number;
    scrollWidth: number;
}) {
    const centered = itemOffsetLeft - Math.max(0, containerWidth - itemWidth) / 2;
    const maxScrollLeft = Math.max(0, scrollWidth - containerWidth);
    return Math.min(maxScrollLeft, Math.max(0, centered));
}

export { getStageCompletionTooltip } from "@/lib/projects/journey-completion";

export const JourneyTimeline = memo(function JourneyTimeline({
    stages,
    currentStageIndex,
    isCreator,
    onAdvanceStage,
    onRedoStage,
    stageCompletionDates = {},
    layout = "horizontal",
}: JourneyTimelineProps) {
    const lastIndex = Math.max(0, stages.length - 1);
    const stageWindow = getJourneyStageWindow(stages.length, currentStageIndex);
    const safeCurrentStageIndex = stageWindow.currentStageIndex;
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const timelineWidth = stages.length > JOURNEY_VISIBLE_STAGE_COUNT ? `${(stages.length / JOURNEY_VISIBLE_STAGE_COUNT) * 100}%` : undefined;
    const timelineMinWidth = stages.length > JOURNEY_VISIBLE_STAGE_COUNT ? `${stages.length * 7}rem` : undefined;

    useLayoutEffect(() => {
        const container = scrollContainerRef.current;
        if (!container) return;

        const alignCurrentStage = () => {
            const currentStage = container.querySelector<HTMLElement>(`[data-stage-index="${safeCurrentStageIndex}"]`);
            if (!currentStage) return;

            const nextScrollLeft = getJourneyCenteredScrollLeft({
                itemOffsetLeft: currentStage.offsetLeft,
                itemWidth: currentStage.offsetWidth,
                containerWidth: container.clientWidth,
                scrollWidth: container.scrollWidth,
            });
            if (Math.abs(container.scrollLeft - nextScrollLeft) > 1) {
                container.scrollLeft = nextScrollLeft;
            }
        };

        alignCurrentStage();
        const observer = typeof ResizeObserver === "undefined"
            ? null
            : new ResizeObserver(() => {
                window.requestAnimationFrame(alignCurrentStage);
            });
        observer?.observe(container);

        return () => observer?.disconnect();
    }, [layout, safeCurrentStageIndex, stages.length]);

    if (layout === "rail") {
        return (
            <section className="isolate overflow-hidden rounded-[8px] border border-border bg-card shadow-none">
                <TooltipPrimitive.Provider>
                    <DashboardCardHeader
                        title="Journey"
                        icon={CheckCircle}
                        compact
                        badge={stages[safeCurrentStageIndex] ? (
                            <span className="nb-compact min-w-0 truncate text-muted-foreground md:hidden">
                                {stages[safeCurrentStageIndex]} ({safeCurrentStageIndex + 1} of {stages.length})
                            </span>
                        ) : null}
                        action={isCreator ? (
                            <div className="flex items-center gap-1.5">
                                {onRedoStage ? (
                                    <button
                                        type="button"
                                        onClick={onRedoStage}
                                        disabled={safeCurrentStageIndex === 0}
                                        className="nb-touch-target flex h-[28px] w-[28px] items-center justify-center rounded-[5px] border border-border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                                        aria-label="Return to previous stage"
                                        title="Previous stage"
                                    >
                                        <ArrowLeft className="size-3.5" />
                                    </button>
                                ) : null}
                                {onAdvanceStage ? (
                                    <button
                                        type="button"
                                        onClick={onAdvanceStage}
                                        disabled={safeCurrentStageIndex >= lastIndex}
                                        className="nb-touch-target flex h-[28px] w-[28px] items-center justify-center rounded-[5px] bg-primary text-primary-foreground transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                                        aria-label="Advance to next stage"
                                        title="Next stage"
                                    >
                                        <ArrowRight className="size-3.5" />
                                    </button>
                                ) : null}
                            </div>
                        ) : null}
                    />
                    <div className="px-4 py-4">
                        <div
                            ref={scrollContainerRef}
                            className="app-scroll app-scroll-x app-scroll-hidden overflow-x-auto pb-2 select-none max-md:snap-x max-md:snap-mandatory"
                            aria-label="Project journey stages"
                        >
                            <div
                                role="list"
                                className="relative grid min-w-full gap-0 list-none p-0 m-0"
                                aria-label="Project journey stages"
                                style={{
                                    gridTemplateColumns: `repeat(${Math.max(1, stages.length)}, minmax(7rem, 1fr))`,
                                    width: timelineWidth,
                                    minWidth: timelineMinWidth,
                                }}
                            >
                            {stages.map((stage, index) => {
                                const isCompleted = index < safeCurrentStageIndex;
                                const isCurrent = index === safeCurrentStageIndex;
                                const hasPrevious = index > 0;
                                const hasNext = index < lastIndex;
                                const stageItem = (
                                    <div role="listitem" key={`${stage}-${index}`} data-stage-index={index} aria-current={isCurrent ? "step" : undefined} className="relative z-[1] flex min-w-0 flex-col items-center gap-2 py-0.5 text-center max-md:snap-center">
                                        {hasPrevious ? (
                                            <span
                                                aria-hidden="true"
                                                className={cn(
                                                    "absolute left-0 right-1/2 top-[13px] z-0 h-0.5",
                                                    index < safeCurrentStageIndex
                                                        ? "bg-[var(--status-success,#2F6B4F)]"
                                                        : index === safeCurrentStageIndex
                                                            ? "bg-primary"
                                                            : "bg-border",
                                                )}
                                            />
                                        ) : null}
                                        {hasNext ? (
                                            <span
                                                aria-hidden="true"
                                                className={cn(
                                                    "absolute left-1/2 right-0 top-[13px] z-0 h-0.5",
                                                    index < safeCurrentStageIndex - 1
                                                        ? "bg-[var(--status-success,#2F6B4F)]"
                                                        : index < safeCurrentStageIndex
                                                            ? "bg-primary"
                                                            : "bg-border",
                                                )}
                                            />
                                        ) : null}
                                        <span className={cn(
                                            "relative z-[1] flex size-5 items-center justify-center rounded-[3px] border-[2px] bg-card",
                                            isCompleted
                                                ? "border-[var(--status-success,#2F6B4F)] bg-[var(--status-success,#2F6B4F)] text-white"
                                                : isCurrent
                                                    ? "border-primary text-primary"
                                                    : "border-border text-muted-foreground",
                                        )}>
                                            {isCompleted ? <Check className="size-3 stroke-[2.5]" /> : isCurrent ? <span className="size-1.5 rounded-[2px] bg-primary" /> : null}
                                        </span>
                                        <p className={cn(
                                            "w-full truncate px-2 text-xs font-medium max-md:whitespace-normal max-md:[overflow-wrap:anywhere]",
                                            isCurrent ? "font-semibold text-primary" : isCompleted ? "text-foreground" : "text-muted-foreground",
                                        )}>
                                            {stage}
                                        </p>
                                        {isCurrent ? <span className="nb-micro uppercase tracking-[0.09em] text-primary">Current</span> : null}
                                        {isCompleted && stageCompletionDates[String(index)] ? (
                                            <>
                                                <span className="font-mono text-[11px] text-muted-foreground md:hidden">
                                                    {formatJourneyCompletionDate(stageCompletionDates[String(index)])}
                                                </span>
                                                <span className="sr-only">
                                                    {getStageCompletionTooltip(stageCompletionDates[String(index)])}
                                                </span>
                                            </>
                                        ) : null}
                                    </div>
                                );

                                return isCompleted ? (
                                    <TooltipPrimitive.Root key={`${stage}-${index}`} delayDuration={150}>
                                        <TooltipPrimitive.Trigger asChild>{stageItem}</TooltipPrimitive.Trigger>
                                        <TooltipPrimitive.Content className="z-[51] rounded-[3px] bg-foreground px-2 py-1 text-[11px] font-mono leading-[1.2] text-background shadow-none">
                                            {getStageCompletionTooltip(stageCompletionDates[String(index)])}
                                        </TooltipPrimitive.Content>
                                    </TooltipPrimitive.Root>
                                ) : stageItem;
                            })}
                            </div>
                        </div>
                    </div>
                </TooltipPrimitive.Provider>
            </section>
        );
    }

    return null;
});

export default JourneyTimeline;
