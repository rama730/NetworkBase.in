"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot } from "@/components/ui/icons";

import { answerAgentQuestionAction, listMyTaskQuestionsAction, muteAgentQuestionAction } from "@/app/actions/agent-questions";
import { QuestionCard, type CardQuestion } from "@/components/questions/QuestionCard";
import { feedbackError, toast } from "@/lib/feedback";

/** "Claude Code asks you…" on a task: a strip in the task panel that opens the question card (report §20.4). */
export function TaskAgentQuestions({ taskId }: { taskId: string }) {
  const client = useQueryClient();
  const key = ["task", taskId, "agent-questions"] as const;
  const list = useQuery({
    queryKey: key,
    staleTime: 15_000,
    queryFn: async () => {
      const result = await listMyTaskQuestionsAction(taskId);
      if (!result.success) throw new Error(result.error);
      return result.questions;
    },
  });
  const [openId, setOpenId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Arriving from the notification (…&question=<id>) opens it straight away.
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("question");
    if (wanted && list.data?.some((q) => q.id === wanted)) setOpenId(wanted);
  }, [list.data]);

  const questions = list.data ?? [];
  const current = questions.find((q) => q.id === openId) ?? null;
  if (!questions.length) return null;

  const done = async (message: string) => {
    setOpenId(null);
    toast.success(message);
    await client.invalidateQueries({ queryKey: key });
  };

  return (
    <>
      <div className="flex items-center gap-2.5 border-b border-border bg-muted/40 px-4 py-2" role="status">
        <Bot className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <p className="nb-compact min-w-0 flex-1 truncate">
          {questions[0]!.agentName ?? "An agent"} asks you {questions.length === 1 ? "a question" : `${questions.length} questions`}
        </p>
        <button type="button" className="nb-compact font-medium text-primary underline-offset-4 hover:underline" onClick={() => setOpenId(questions[0]!.id)}>Answer</button>
      </div>
      {current ? (
        <QuestionCard
          key={current.id}
          open
          onOpenChange={(open) => !open && setOpenId(null)}
          from={`${current.agentName ?? "An agent"} asks${current.context ? ` · ${current.context}` : ""}`}
          questions={current.questions as CardQuestion[]}
          submitting={submitting}
          onSubmit={async (answers) => {
            setSubmitting(true);
            try {
              const result = await answerAgentQuestionAction(current.id, answers);
              if (!result.success) throw new Error(result.error);
              await done("Answer sent");
            } catch (error) {
              toast.error(feedbackError(error instanceof Error ? error.message : "Couldn’t send the answer", "Couldn’t send the answer"));
            } finally {
              setSubmitting(false);
            }
          }}
          onMute={async () => {
            const result = await muteAgentQuestionAction(current.id);
            if (result.success) await done("This agent won't ask you about this task again");
            else toast.error(feedbackError(result.error, "Couldn’t mute"));
          }}
        />
      ) : null}
    </>
  );
}
