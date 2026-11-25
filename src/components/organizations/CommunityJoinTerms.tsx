"use client";

import { useQuery } from "@tanstack/react-query";

import { readJoinTermsAction } from "@/app/actions/organizations";
import { Input } from "@/components/ui/input";

// Report 34.2 (plan B5.1b): before joining a community — its numbered rules, I agree, and up to 3 join questions
// (optional for instant join, required when organisers approve joins).
export type JoinTermsValue = { agreed: boolean; answers: Record<string, string> };

export function useJoinTerms(input: { code?: string; orgId?: string }, enabled = true) {
  return useQuery({ queryKey: ["join-terms", input.code ?? null, input.orgId ?? null], queryFn: () => readJoinTermsAction(input), enabled, staleTime: 60_000 });
}

/** True when the terms are met: agreed (if asked) and, in approval mode, every question answered. */
export function termsMet(terms: { agreeRequired: boolean; questions: Array<{ id: string }> } | null, v: JoinTermsValue, approval: boolean) {
  if (!terms) return true;
  return (!terms.agreeRequired || v.agreed) && (!approval || terms.questions.every((q) => v.answers[q.id]?.trim()));
}

export function CommunityJoinTerms({ terms, approval, value, onChange }: {
  terms: { agreeRequired: boolean; rules: Array<{ n: number; text: string }>; questions: Array<{ id: string; label: string }>; cocHref: string | null };
  approval: boolean; value: JoinTermsValue; onChange: (v: JoinTermsValue) => void;
}) {
  return (
    <div className="space-y-2 text-left text-[13px]" data-testid="join-terms">
      {terms.rules.length ? <ol className="list-decimal space-y-1 pl-5">{terms.rules.map((r) => <li key={r.n} value={r.n}>{r.text}</li>)}</ol> : null}
      {terms.cocHref ? <a href={terms.cocHref} className="nb-link inline-block" target="_blank" rel="noreferrer">Read the full Code of conduct</a> : null}
      {terms.agreeRequired ? <label className="flex items-center gap-2"><input type="checkbox" className="nb-check" checked={value.agreed} onChange={(e) => onChange({ ...value, agreed: e.target.checked })} />I agree to the Code of conduct</label> : null}
      {terms.questions.map((q) => (
        <label key={q.id} className="flex flex-col gap-1"><span>{q.label}{approval ? " *" : " (optional)"}</span>
          <Input value={value.answers[q.id] ?? ""} maxLength={500} onChange={(e) => onChange({ ...value, answers: { ...value.answers, [q.id]: e.target.value } })} /></label>
      ))}
    </div>
  );
}
