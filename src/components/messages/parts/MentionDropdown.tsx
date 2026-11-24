'use client';

import { useEffect, useId, useState } from 'react';
import { buildIdentityPresentation } from '@/lib/ui/identity';
import { Megaphone } from 'lucide-react';
import { UserAvatar } from '@/components/ui/UserAvatar';

interface MentionParticipant {
    id: string;
    username: string | null;
    fullName: string | null;
    avatarUrl: string | null;
    /** Shown under the name instead of the username (@here, @channel say who they notify). */
    hint?: string;
}

interface MentionDropdownProps {
    query: string;
    participants: MentionParticipant[];
    onSelect: (participant: MentionParticipant) => void;
    onClose: () => void;
    /** The editor the keys come from: it gets the combobox attributes (aria-activedescendant) while the list is open. */
    getInput?: () => HTMLElement | null;
}

/**
 * The editor becomes a combobox while a suggestion list is open (ARIA 1.2), and a plain textbox
 * again when it closes. Returns the undo, for an effect's cleanup.
 */
export function openCombobox(input: HTMLElement, listId: string, activeId: string) {
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-controls', listId);
    input.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-activedescendant', activeId);
    return () => {
        input.setAttribute('role', 'textbox');
        for (const name of ['aria-autocomplete', 'aria-controls', 'aria-expanded', 'aria-activedescendant']) input.removeAttribute(name);
    };
}

/**
 * The people an @query shows (the composer only lets Enter pick when there are some): people
 * whose name or username starts with it first, then other matches, and @here / @channel last,
 * so "@h" finds Hana before @here.
 */
export function matchMentions<T extends MentionParticipant>(participants: T[], query: string) {
    const q = query.toLowerCase();
    const rank = (p: T) => {
        const names = [p.username, p.fullName, ...(p.fullName?.split(/\s+/) ?? [])].filter(Boolean).map((n) => n!.toLowerCase());
        const broadcast = p.hint ? 2 : 0;
        if (names.some((n) => n.startsWith(q))) return broadcast;
        if (names.some((n) => n.includes(q))) return broadcast + 1;
        return -1;
    };
    return participants
        .map((p, index) => ({ p, index, r: rank(p) }))
        .filter((x) => x.r >= 0)
        .sort((a, b) => a.r - b.r || a.index - b.index)
        .slice(0, 5)
        .map((x) => x.p);
}

export function MentionDropdown({ query, participants, onSelect, onClose, getInput }: MentionDropdownProps) {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const listId = useId();

    const filtered = matchMentions(participants, query);
    const activeId = filtered[selectedIndex] ? `${listId}-${filtered[selectedIndex].id}` : null;

    // Screen readers follow the highlighted person while focus stays in the editor (a combobox while the list is open).
    useEffect(() => {
        const input = getInput?.();
        if (!input || !activeId) return;
        return openCombobox(input, listId, activeId);
    }, [activeId, getInput, listId]);

    useEffect(() => {
        setSelectedIndex(0);
    }, [query]);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            // Nothing matches: Enter sends, arrows move the caret (nothing to pick).
            if (!filtered.length) return;
            // Only keys typed in this editor, and never while an input method is composing
            // (Japanese or Chinese: Enter commits the text there, not a person).
            const input = getInput?.();
            if (e.isComposing || e.keyCode === 229 || (input && e.target instanceof Node && !input.contains(e.target))) return;
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelectedIndex((prev) => Math.min(prev + 1, filtered.length - 1));
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelectedIndex((prev) => Math.max(prev - 1, 0));
            } else if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                if (filtered[selectedIndex]) onSelect(filtered[selectedIndex]);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
            }
        };
        window.addEventListener('keydown', handler, true);
        return () => window.removeEventListener('keydown', handler, true);
    }, [filtered, getInput, selectedIndex, onSelect, onClose]);

    if (filtered.length === 0) return null;

    return (
        <div id={listId} role="listbox" aria-label="People to mention" className="absolute bottom-full left-0 z-30 mb-1 w-64 rounded-lg border border-border bg-popover p-1 shadow-md">
            {filtered.map((participant, index) => {
                const identity = buildIdentityPresentation(participant);
                return (
                    <div
                        key={participant.id}
                        id={`${listId}-${participant.id}`}
                        role="option"
                        aria-selected={index === selectedIndex}
                        onMouseDown={(e) => {
                            e.preventDefault();
                            onSelect(participant);
                        }}
                        className={`flex min-h-[34px] w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-left text-[13px] pointer-coarse:min-h-11 ${
                            index === selectedIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-muted'
                        }`}
                    >
                        {participant.hint ? (
                            <span className="grid size-[26px] flex-none place-items-center rounded-md bg-muted text-muted-foreground" aria-hidden="true"><Megaphone size={14} /></span>
                        ) : (
                            <UserAvatar identity={participant} size={26} unoptimized fallbackClassName="text-[11px] font-medium" />
                        )}
                        <div className="min-w-0">
                            <div className="truncate font-medium text-foreground">{participant.hint ? `@${participant.id}` : identity.displayName}</div>
                            {participant.hint || identity.usernameLabel ? <div className="truncate text-[12px] text-muted-foreground">{participant.hint ?? identity.usernameLabel}</div> : null}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
