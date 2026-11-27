"use client";

import { useState } from "react";
import { Clock, Heart } from "lucide-react";

import { NeedsYouRow } from "@/components/notifications/NeedsYouRow";
import { NotificationRow, type RowHandlers } from "@/components/notifications/NotificationRow";
import type { NeedsYouItem, NotificationAct } from "@/lib/notifications/needs-you";
import type { NotificationBundle } from "@/lib/notifications/presentation";
import type { TrayShape } from "@/lib/notifications/tray-model";

export type FeedProps = RowHandlers & {
    filter: "unread" | "all";
    now: Date;
    needs: NeedsYouItem[];
    shape: TrayShape;
    scopeLabel?: string | null;
    inScope?: (bundle: NotificationBundle) => boolean;
    handIn?: Record<string, { handedIn: number; total: number }>;
    activeKey?: string | null;
    onAct: (item: NeedsYouItem, act: NotificationAct & { questionKey?: string }) => Promise<boolean>;
    snoozedCount?: number;
    onShowSnoozed?: () => void;
};

function Label({ text, count, tone, aside }: { text: string; count?: number; tone?: "act"; aside?: string }) {
    return (
        <div className="nb-nt-label">
            <span className="nb-micro"><b>{text}</b></span>
            {typeof count === "number" ? <span className="nb-nt-n" data-tone={tone}>{count}</span> : null}
            {aside ? <span className="nb-micro nb-nt-aside">{aside}</span> : null}
        </div>
    );
}

/**
 * The feed (notifications mix), shared by the bell's tray and the notifications page: Needs you first, then New (or
 * Today and Earlier on All), one quiet Activity line, and Snoozed at the bottom. Inside a workspace or organization its
 * own rows come first.
 */
export function NotificationList(props: FeedProps) {
    const { filter, now, needs, shape, scopeLabel, inScope, handIn, activeKey, onAct, snoozedCount, onShowSnoozed, ...handlers } = props;
    const [activityOpen, setActivityOpen] = useState(false);
    const row = (bundle: NotificationBundle) => (
        <NotificationRow key={bundle.key + bundle.lead.id} bundle={bundle} now={now} active={activeKey === `row:${bundle.lead.id}`} handIn={handIn?.[bundle.lead.entityRefs?.taskId ?? ""] ?? null} {...handlers} />
    );
    const needsRows = needs.map((item) => item.source === "important" && item.notification
        ? row({ key: item.key, lead: item.notification, items: [item.notification] })
        : <NeedsYouRow key={item.key} item={item} now={now} active={activeKey === item.key} onAct={onAct} />);
    const scoped = inScope ? shape.fresh.filter(inScope) : [];
    const elsewhere = inScope ? shape.fresh.filter((b) => !inScope(b)) : shape.fresh;

    return (
        <div role="region" aria-label="Notifications list. J and K move, Enter opens, A answers, E marks done, S snoozes, R marks unread.">
            {needs.length ? (
                <section aria-label="Needs you">
                    <Label text="Needs you" count={needs.length} tone="act" aside="Stays until answered" />
                    <div role="list">{needsRows.map((node, i) => <div role="listitem" key={i}>{node}</div>)}</div>
                </section>
            ) : null}
            {scopeLabel && scoped.length ? (
                <section aria-label={`In ${scopeLabel}`}>
                    <Label text={`In ${scopeLabel}`} count={scoped.length} />
                    <div role="list">{scoped.map((b) => <div role="listitem" key={b.key + b.lead.id}>{row(b)}</div>)}</div>
                </section>
            ) : null}
            {elsewhere.length ? (
                <section aria-label={filter === "unread" ? "New" : "Today"}>
                    <Label text={scopeLabel && scoped.length ? "Everywhere" : filter === "unread" ? "New" : "Today"} count={elsewhere.length} />
                    <div role="list">{elsewhere.map((b) => <div role="listitem" key={b.key + b.lead.id}>{row(b)}</div>)}</div>
                </section>
            ) : null}
            {shape.activity ? (
                <section aria-label="Activity">
                    <div className="nb-nt-row">
                        <span className="nb-nt-who"><span className="nb-nt-tile"><Heart aria-hidden="true" /></span></span>
                        <span className="nb-nt-tx">
                            <span className="nb-nt-t1 nb-compact"><b>{shape.activity.label}</b></span>
                            <span className="nb-nt-meta nb-meta"><span>Activity · not counted on the bell</span></span>
                        </span>
                        <span className="nb-nt-side">
                            <button type="button" className="nb-nt-ib" aria-expanded={activityOpen} aria-label={activityOpen ? "Hide activity" : "Show activity"} onClick={() => setActivityOpen((v) => !v)}>
                                <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.75" style={activityOpen ? { transform: "rotate(90deg)" } : undefined}><path d="m9 6 6 6-6 6" /></svg>
                            </button>
                        </span>
                    </div>
                    {activityOpen ? <div className="nb-nt-kids">{shape.activity.items.map((item) => (
                        <div key={item.id} className="nb-nt-kid"><span className="nb-nt-tx"><span className="nb-compact">{item.title}</span></span></div>
                    ))}</div> : null}
                </section>
            ) : null}
            {shape.earlier.length ? (
                <section aria-label="Earlier">
                    <Label text="Earlier" count={shape.earlier.length} />
                    <div role="list">{shape.earlier.map((b) => <div role="listitem" key={b.key + b.lead.id}>{row(b)}</div>)}</div>
                </section>
            ) : null}
            {snoozedCount && onShowSnoozed ? (
                <div className="nb-nt-snz">
                    <Clock className="size-4 text-muted-foreground" aria-hidden="true" />
                    <span className="nb-compact flex-1">Snoozed {snoozedCount}</span>
                    <button type="button" className="nb-nt-btn" data-kind="ghost" onClick={onShowSnoozed}>Show</button>
                </div>
            ) : null}
        </div>
    );
}
