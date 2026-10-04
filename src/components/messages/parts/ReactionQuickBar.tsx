'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuickReactions } from '@/components/messages/useQuickReactions';
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
}

export function ReactionQuickBar({ align = 'start', anchor, selectedReactions = [], onReact, onClose }: ReactionQuickBarProps) {
    const ref = useRef<HTMLDivElement>(null);
    const [showExtended, setShowExtended] = useState(false);
    const quick = useQuickReactions();

    // Focus lands in the picker once; Esc closes it and returns focus to what opened it.
    const latest = useRef({ anchor, onClose });
    useEffect(() => {
        latest.current = { anchor, onClose };
    });
    useEffect(() => {
        ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            latest.current.onClose();
            latest.current.anchor?.focus();
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

    return createPortal(
        <div
            ref={ref}
            role="toolbar"
            aria-label="Quick reactions"
            className="msg-reaction-quick-bar fixed z-[130] flex flex-col rounded-lg border border-border bg-popover p-1.5 shadow-lg"
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
                            "nb-touch-target flex h-8 w-8 items-center justify-center rounded-full text-lg transition-transform hover:scale-125 hover:bg-muted",
                            selectedReactions.includes(emoji) && "bg-accent/50 ring-1 ring-ring/30"
                        )}
                        aria-label={`React with ${emoji}`}
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
                        className="nb-touch-target flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground text-sm font-semibold border border-dashed border-border"
                        aria-label="More reactions"
                    >
                        +
                    </button>
                )}
            </div>
            {showExtended && (
                <div className="grid grid-cols-6 gap-1 p-1 border-t border-border mt-1.5 animate-in fade-in slide-in-from-top-1 duration-[180ms]">
                    {EXTENDED_REACTIONS.map((emoji) => (
                        <button
                            key={emoji}
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                onReact(emoji);
                                onClose();
                            }}
                            className={cn(
                                "nb-touch-target flex h-8 w-8 items-center justify-center rounded-full text-lg transition-transform hover:scale-125 hover:bg-muted",
                                selectedReactions.includes(emoji) && "bg-accent/50 ring-1 ring-ring/30"
                            )}
                            aria-label={`React with ${emoji}`}
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
