/** A status as Slack shows it: the emoji, then the text (either may be missing). */
export function StatusInline({ emoji, text, className }: { emoji: string | null | undefined; text: string | null | undefined; className?: string }) {
  if (!emoji && !text) return null;
  return (
    <span className={className}>
      {emoji ? <span aria-hidden={text ? true : undefined} className="mr-1 inline-block font-[system-ui] not-italic">{emoji}</span> : null}
      {text}
    </span>
  );
}
