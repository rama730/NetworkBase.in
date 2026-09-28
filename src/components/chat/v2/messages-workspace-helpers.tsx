'use client';


type ConversationLastMessageSnapshot = {
    id?: string | null;
    createdAt?: Date | string | null;
} | null | undefined;

function lastMessageEpoch(value: ConversationLastMessageSnapshot) {
    if (!value?.createdAt) return 0;
    const epoch = value.createdAt instanceof Date
        ? value.createdAt.getTime()
        : new Date(value.createdAt).getTime();
    return Number.isFinite(epoch) ? epoch : 0;
}

export function pickNewestLastMessage(
    left: ConversationLastMessageSnapshot,
    right: ConversationLastMessageSnapshot,
) {
    if (!left?.id) return right?.id ? right : null;
    if (!right?.id) return left;
    const leftEpoch = lastMessageEpoch(left);
    const rightEpoch = lastMessageEpoch(right);
    if (rightEpoch !== leftEpoch) {
        return rightEpoch > leftEpoch ? right : left;
    }
    return String(right.id).localeCompare(String(left.id)) > 0 ? right : left;
}

export function getSearchHighlightTerm(query: string) {
    const textOnly = query
        .replace(/(?:^|\s)(?:from:"[^"]*"|from:\S+|has:\S+|kind:\S+|is:\S+|in:\S+)/giu, ' ')
        .normalize('NFKC')
        .replace(/\s+/g, ' ')
        .trim();
    const [term] = textOnly.match(/"([^"]+)"|[^\s"]+/u) ?? [];
    const normalized = term?.replace(/^"|"$/g, '').trim() ?? '';
    return Array.from(normalized).length >= 2 ? normalized : null;
}

export function renderHighlightedSearchText(text: string, term: string | null) {
    if (!term) return text;
    const index = text.toLocaleLowerCase().indexOf(term.toLocaleLowerCase());
    if (index < 0) return text;
    const end = index + term.length;
    return (
        <>
            {text.slice(0, index)}
            <mark className="rounded-sm bg-primary/15 px-0.5 text-inherit">{text.slice(index, end)}</mark>
            {text.slice(end)}
        </>
    );
}
