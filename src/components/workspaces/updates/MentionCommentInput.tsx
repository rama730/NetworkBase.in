'use client';

import { useCallback, useRef, useState, type ComponentProps } from 'react';
import { useQuery } from '@tanstack/react-query';
import { searchUpdateMentionsAction } from '@/app/actions/workspace/updates';
import { MentionDropdown, matchMentions } from '@/components/messages/parts/MentionDropdown';

const TOKEN = /(?:^|\s)@([a-zA-Z0-9_]{1,30})$/;

/** A comment box that suggests people after "@" and writes `@username`, which the comment text links. */
export function MentionCommentInput({ projectId, updateId, value, onValueChange, onKeyDown, ...props }: Omit<ComponentProps<'input'>, 'value' | 'onChange'> & {
  projectId: string;
  updateId: string;
  value: string;
  onValueChange: (next: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState<string | null>(null);
  const getInput = useCallback(() => ref.current, []);
  const { data: people = [] } = useQuery({
    queryKey: ['update-mentions', updateId, query],
    queryFn: () => searchUpdateMentionsAction(projectId, updateId, query!),
    enabled: Boolean(query),
    staleTime: 30_000,
  });
  const open = query !== null && matchMentions(people, query).length > 0;

  const readToken = (input: HTMLInputElement) => {
    const before = input.value.slice(0, input.selectionStart ?? input.value.length);
    setQuery(before.match(TOKEN)?.[1] ?? null);
  };

  return (
    <div className="relative flex min-w-0 flex-1">
      <input
        {...props}
        ref={ref}
        value={value}
        onChange={(event) => {
          onValueChange(event.target.value.slice(0, 1_000));
          readToken(event.target);
        }}
        onKeyDown={(event) => {
          // The list has these keys while it's open: Enter picks a person rather than posting.
          if (open && ['Enter', 'Tab', 'Escape', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
          onKeyDown?.(event);
        }}
        onBlur={() => setQuery(null)}
      />
      {open ? (
        <MentionDropdown
          query={query}
          participants={people}
          getInput={getInput}
          onClose={() => setQuery(null)}
          onSelect={(person) => {
            const input = ref.current;
            if (!input || !person.username) return;
            const caret = input.selectionStart ?? value.length;
            const head = value.slice(0, caret).replace(/@[a-zA-Z0-9_]*$/, `@${person.username} `);
            onValueChange(`${head}${value.slice(caret)}`.slice(0, 1_000));
            setQuery(null);
            requestAnimationFrame(() => { input.focus(); input.setSelectionRange(head.length, head.length); });
          }}
        />
      ) : null}
    </div>
  );
}
