"use client";
import { TabMarker } from "@/components/ui/TabMarker";

import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

/** `nb.question/1` (report §20.1). */
export type CardQuestion = {
  key: string;
  header: string;
  question: string;
  multiSelect?: boolean;
  allowOther?: boolean;
  options: Array<{ value: string; label: string; description?: string; recommended?: boolean }>;
  preview?: { kind: "text" | "diff" | "code"; text: string };
};
export type CardAnswers = Record<string, string | string[]>;

/**
 * The question card (report §20.2): one to four questions, 2–4 options each with the recommended one first, an
 * "Other" box, number keys 1–4, Back/Next/Submit. A dialog on desktop, a bottom sheet on a phone. Used for agents'
 * questions and, later, rare drop choices (§19.2).
 */
export function QuestionCard({
  open, onOpenChange, from, questions, onSubmit, onMute, submitting,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  from?: string | null;
  questions: CardQuestion[];
  onSubmit: (answers: CardAnswers) => void;
  onMute?: () => void;
  submitting?: boolean;
}) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<CardAnswers>(() => Object.fromEntries(questions.map((q) => [q.key, q.multiSelect ? [] : q.options.find((o) => o.recommended)?.value ?? ""])));
  const [other, setOther] = useState<Record<string, string>>({});
  const q = questions[index]!;
  const last = index === questions.length - 1;
  const chosen = answers[q.key];

  const pick = (value: string) =>
    setAnswers((cur) => {
      if (!q.multiSelect) return { ...cur, [q.key]: value };
      const list = Array.isArray(cur[q.key]) ? (cur[q.key] as string[]) : [];
      return { ...cur, [q.key]: list.includes(value) ? list.filter((v) => v !== value) : [...list, value] };
    });

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement && event.target.type === "text") return;
      const n = Number(event.key);
      if (n >= 1 && n <= q.options.length) pick(q.options[n - 1]!.value);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const final = useMemo(() => Object.fromEntries(questions.map((x) => [x.key, answers[x.key] === "__other" ? other[x.key] ?? "" : answers[x.key] ?? ""])), [answers, other, questions]);
  const answered = (x: CardQuestion) => (Array.isArray(final[x.key]) ? (final[x.key] as string[]).length > 0 : String(final[x.key] ?? "").trim() !== "");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent overlayClassName="z-[300]" className="z-[301] max-h-[90dvh] w-full gap-4 overflow-y-auto max-sm:bottom-0 max-sm:top-auto max-sm:translate-y-0 max-sm:rounded-b-none">
        <div className="flex items-center justify-between gap-3">
          <span className="nb-micro text-muted-foreground">QUESTION {index + 1} OF {questions.length}</span>
          <div className="flex flex-wrap justify-end gap-1" role="tablist" aria-label="Questions">
            {questions.map((x, i) => (
              <button key={x.key} type="button" role="tab" aria-selected={i === index} onClick={() => setIndex(i)} className={`nb-meta rounded-sm border px-1.5 py-0.5 ${i === index ? "border-primary text-foreground" : "border-border text-muted-foreground"}`}>
                {x.header}
              </button>
            ))}
              <TabMarker />
          </div>
        </div>
        {from ? <p className="nb-compact text-muted-foreground">{from}</p> : null}
        <DialogTitle className="nb-card-title">{q.question}</DialogTitle>
        <DialogDescription className="sr-only">Choose an answer, then {last ? "submit" : "go to the next question"}.</DialogDescription>
        <div className="space-y-2" role={q.multiSelect ? "group" : "radiogroup"} aria-label={q.header}>
          {[...q.options, ...(q.allowOther === false ? [] : [{ value: "__other", label: "Other…", description: undefined, recommended: false }])].map((o, i) => {
            const selected = Array.isArray(chosen) ? chosen.includes(o.value) : chosen === o.value;
            return (
              <label key={o.value} className={`flex cursor-pointer items-start gap-2.5 rounded-md border p-2.5 ${selected ? "border-primary" : "border-border"}`}>
                <input type={q.multiSelect ? "checkbox" : "radio"} className={`${q.multiSelect ? "nb-check" : "nb-radio"} mt-0.5`} name={`q-${q.key}`} checked={selected} onChange={() => pick(o.value)} />
                <span className="min-w-0 flex-1 space-y-0.5">
                  <span className="nb-ui-label flex items-center gap-2">
                    <span className="text-muted-foreground">{i + 1}</span> {o.label}
                    {o.recommended ? <span className="nb-meta text-primary">Recommended</span> : null}
                  </span>
                  {o.description ? <span className="nb-compact block text-muted-foreground">{o.description}</span> : null}
                  {o.value === "__other" && selected ? (
                    <input type="text" autoFocus className="mt-1.5 h-9 w-full rounded-md border border-input bg-card px-2 text-sm" value={other[q.key] ?? ""} onChange={(e) => setOther((cur) => ({ ...cur, [q.key]: e.target.value }))} aria-label="Your answer" />
                  ) : null}
                </span>
              </label>
            );
          })}
        </div>
        {q.preview ? <pre className="nb-terminal max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-border p-2.5 font-mono text-xs">{q.preview.text}</pre> : null}
        <div className="flex items-center justify-between gap-2">
          {onMute ? <Button type="button" variant="ghost" size="sm" onClick={onMute}>Mute this agent here</Button> : <span />}
          <div className="flex gap-2">
            {index > 0 ? <Button type="button" variant="ghost" onClick={() => setIndex(index - 1)}>Back</Button> : null}
            {last ? (
              <Button type="button" disabled={submitting || !questions.every(answered)} onClick={() => onSubmit(final)}>Submit</Button>
            ) : (
              <Button type="button" variant="ghost" disabled={!answered(q)} onClick={() => setIndex(index + 1)}>Next</Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
