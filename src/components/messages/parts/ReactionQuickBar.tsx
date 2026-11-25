'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuickReactions } from '@/components/messages/useQuickReactions';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { searchEmoji } from '@/lib/messaging/emoji';
import { cn } from '@/lib/utils';

const EXTENDED_REACTIONS = [
    '🔥', '🎉', '👏', '🚀', '👀', '💯',
    '🤔', '💡', '✅', '❌', '🤷', '💀',
    '🥳', '🌟', '⚡', '🌈', '🎈', '💔',
    '👑', '✨', '👾', '🎨', '👍', '❤️'
];

interface ReactionQuickBarProps {
    align?: 'start' | 'end';
    anchor: HTMLElement | null;
    selectedReactions?: string[];
    onReact: (emoji: string) => void;
    onClose: () => void;
    /** What a pick does, for screen readers: "React with" (messages) or "Insert" (the composer). */
    verb?: string;
    /** Where focus goes when it closes (the composer's editor); default: what opened it. */
    returnFocus?: () => void;
}

/** ←/→ (and ↑/↓) move between the emoji, like any toolbar. */
function moveFocus(event: React.KeyboardEvent<HTMLDivElement>) {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button'));
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    event.preventDefault();
    buttons[(at + step + buttons.length) % buttons.length]?.focus();
}

export function ReactionQuickBar({ align = 'start', anchor, selectedReactions = [], onReact, onClose, verb = 'React with', returnFocus }: ReactionQuickBarProps) {
    const ref = useRef<HTMLDivElement>(null);
    const [showExtended, setShowExtended] = useState(false);
    // Search by name ("tada", "thumbsup"); empty shows the usual set.
    const [query, setQuery] = useState('');
    const found = query.trim() ? searchEmoji(query).map((e) => e.emoji) : null;
    const search = (
        <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
                if (event.key === 'Enter' && found?.[0]) {
                    event.preventDefault();
                    onReact(found[0]);
                    onClose();
                }
            }}
            // Opening "+" with a mouse or keyboard goes straight to search (never on touch, where it would pop the keyboard).
            autoFocus={showExtended}
            placeholder="Search emoji"
            aria-label="Search emoji"
            className="h-8 w-full rounded-md border border-input bg-card px-2 text-[13px] outline-none focus:border-ring pointer-coarse:h-11 pointer-coarse:text-[17px]"
        />
    );
    const quick = useQuickReactions();

    // Focus lands in the picker once; Esc closes it and returns focus to what opened it.
    const latest = useRef({ anchor, onClose, returnFocus });
    useEffect(() => {
        latest.current = { anchor, onClose, returnFocus };
    });
    useEffect(() => {
        ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            latest.current.onClose();
            if (latest.current.returnFocus) latest.current.returnFocus();
            else latest.current.anchor?.focus();
        };
        document.addEventListener('keydown', onKeyDown, true);
        return () => document.removeEventListener('keydown', onKeyDown, true);
    }, []);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent | TouchEvent) => {
            const target = event.target as HTMLElement;
            if (target && target.closest('[data-reaction-trigger]')) {
                return;
            }
            if (ref.current && !ref.current.contains(target)) {
                onClose();
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('touchstart', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('touchstart', handleClickOutside);
        };
    }, [onClose]);

    useEffect(() => {
        const bar = ref.current;
        if (!anchor || !bar) return;
        const position = () => {
            const anchorRect = anchor.getBoundingClientRect();
            const barRect = bar.getBoundingClientRect();
            const preferredLeft = align === 'end'
                ? anchorRect.right - barRect.width
                : anchorRect.left;
            const left = Math.min(
                window.innerWidth - barRect.width - 12,
                Math.max(12, preferredLeft),
            );
            const above = anchorRect.top - barRect.height - 8;
            const top = above >= 12 ? above : anchorRect.bottom + 8;
            bar.style.left = `${left}px`;
            bar.style.top = `${Math.min(top, window.innerHeight - barRect.height - 12)}px`;
        };
        position();
        window.addEventListener('resize', position);
        window.addEventListener('scroll', position, true);
        return () => {
            window.removeEventListener('resize', position);
            window.removeEventListener('scroll', position, true);
        };
    }, [align, anchor, showExtended]); // re-position if height changes due to extension expansion

    if (typeof document === 'undefined') return null;

    // Touch: a bottom sheet with every emoji at 44px (spec: pickers on phones are sheets).
    if (window.matchMedia('(pointer: coarse)').matches) {
        const all = found ?? [...new Set([...quick, ...EXTENDED_REACTIONS])];
        const close = () => {
            onClose();
            if (returnFocus) returnFocus();
        };
        return (
            <Dialog open onOpenChange={(open) => !open && close()}>
                <DialogContent presentation="bottom-sheet" className="nbm px-3 pb-3">
                    <DialogTitle className="nb-micro px-1 pb-1 pt-4">{verb === 'Insert' ? 'Emoji' : 'Add reaction'}</DialogTitle>
                    <div className="pb-2">{search}</div>
                    {found && !found.length ? <p className="px-1 py-3 text-[13px] text-muted-foreground">No emoji match.</p> : null}
                    <div className="grid grid-cols-6 gap-1" role="group" aria-label={verb === 'Insert' ? 'Emoji' : 'Reactions'}>
                        {all.map((emoji) => (
                            <button
                                key={emoji}
                                type="button"
                                onClick={() => { onReact(emoji); onClose(); }}
                                className={cn('grid min-h-11 place-items-center rounded-md text-2xl hover:bg-muted', selectedReactions.includes(emoji) && 'bg-accent')}
                                aria-label={`${verb} ${emoji}`}
                                aria-pressed={verb === 'Insert' ? undefined : selectedReactions.includes(emoji)}
                            >
                                {emoji}
                            </button>
                        ))}
                    </div>
                </DialogContent>
            </Dialog>
        );
    }

    return createPortal(
        <div
            ref={ref}
            role="toolbar"
            aria-label={verb === 'Insert' ? 'Emoji' : 'Quick reactions'}
            onKeyDown={moveFocus}
            className="msg-reaction-quick-bar fixed z-[60] flex flex-col rounded-lg border border-border bg-popover p-1.5 shadow-md"
        >
            <div className="flex items-center gap-1">
                {quick.map((emoji) => (
                    <button
                        key={emoji}
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            onReact(emoji);
                            onClose();
                        }}
                        className={cn(
                            "nb-touch-target flex h-8 w-8 items-center justify-center rounded-md text-lg transition-colors duration-[130ms] hover:bg-muted",
                            selectedReactions.includes(emoji) && "bg-accent"
                        )}
                        aria-label={`${verb} ${emoji}`}
                    >
                        {emoji}
                    </button>
                ))}
                {!showExtended && (
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            setShowExtended(true);
                        }}
                        className="nb-touch-target flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground text-sm font-semibold border border-dashed border-border"
                        aria-label="More reactions"
                    >
                        +
                    </button>
                )}
            </div>
            {showExtended ? <div className="mt-1.5 border-t border-border px-1 pt-1.5">{search}</div> : null}
            {showExtended && found && !found.length ? <p className="px-2 py-2 text-[13px] text-muted-foreground">No emoji match.</p> : null}
            {showExtended && (
                <div className="grid max-h-56 grid-cols-6 gap-1 overflow-y-auto p-1 animate-in fade-in slide-in-from-top-1 duration-[180ms]">
                    {(found ?? EXTENDED_REACTIONS).map((emoji) => (
                        <button
                            key={emoji}
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                onReact(emoji);
                                onClose();
                            }}
                            className={cn(
                                "nb-touch-target flex h-8 w-8 items-center justify-center rounded-md text-lg transition-colors duration-[130ms] hover:bg-muted",
                                selectedReactions.includes(emoji) && "bg-accent"
                            )}
                            aria-label={`${verb} ${emoji}`}
                        >
                            {emoji}
                        </button>
                    ))}
                </div>
            )}
        </div>,
        document.body,
    );
}
