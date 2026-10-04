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

/** The people an @query shows (the composer only lets Enter pick when there are some). */
export function matchMentions<T extends MentionParticipant>(participants: T[], query: string) {
    const q = query.toLowerCase();
    return participants.filter((p) => (p.username && p.username.toLowerCase().includes(q)) || (p.fullName && p.fullName.toLowerCase().includes(q))).slice(0, 5);
}

export function MentionDropdown({ query, participants, onSelect, onClose, getInput }: MentionDropdownProps) {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const listId = useId();

    const filtered = matchMentions(participants, query);
    const activeId = filtered[selectedIndex] ? `${listId}-${filtered[selectedIndex].id}` : null;

    // Screen readers follow the highlighted person while focus stays in the editor.
    useEffect(() => {
        const input = getInput?.();
        if (!input || !activeId) return;
        input.setAttribute('aria-controls', listId);
        input.setAttribute('aria-expanded', 'true');
        input.setAttribute('aria-activedescendant', activeId);
        return () => {
            input.removeAttribute('aria-controls');
            input.removeAttribute('aria-expanded');
            input.removeAttribute('aria-activedescendant');
        };
    }, [activeId, getInput, listId]);

    useEffect(() => {
        setSelectedIndex(0);
    }, [query]);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            // Nothing matches: Enter sends, arrows move the caret (nothing to pick).
            if (!filtered.length) return;
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
    }, [filtered, selectedIndex, onSelect, onClose]);

    if (filtered.length === 0) return null;

    return (
        <div id={listId} role="listbox" aria-label="People to mention" className="absolute bottom-full left-0 z-30 mb-1 w-64 rounded-lg border border-border bg-popover py-1 shadow-lg">
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
                        className={`flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm ${
                            index === selectedIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-muted'
                        }`}
                    >
                        {participant.hint ? (
                            <span className="grid size-6 flex-none place-items-center rounded-full bg-muted text-muted-foreground" aria-hidden="true"><Megaphone size={13} /></span>
                        ) : (
                            <UserAvatar identity={participant} size={24} unoptimized fallbackClassName="text-[11px] font-medium" />
                        )}
                        <div className="min-w-0">
                            <div className="truncate font-medium text-foreground">{participant.hint ? `@${participant.id}` : identity.displayName}</div>
                            {participant.hint || identity.usernameLabel ? <div className="truncate text-xs text-muted-foreground">{participant.hint ?? identity.usernameLabel}</div> : null}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
