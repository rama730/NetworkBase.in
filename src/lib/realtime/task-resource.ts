import { subscribeBroadcast } from "@/lib/realtime/private-broadcast";
import { liveTopics, type DbRealtimePayload, toRowChange } from "@/lib/realtime/subscriptions";

export type TaskResourceEvent =
  | { kind: "task"; payload: DbRealtimePayload }
  | { kind: "comment"; payload: DbRealtimePayload }
  | { kind: "subtask"; payload: DbRealtimePayload }
  | { kind: "attachment_link"; payload: DbRealtimePayload };

const KINDS: Record<string, TaskResourceEvent["kind"]> = {
  "task.changed": "task",
  "comment.changed": "comment",
  "subtask.changed": "subtask",
  "attachment.changed": "attachment_link",
};

/** One task's live events. The topic is shared per tab, so co-mounted listeners cost one channel. */
export function subscribeTaskResource(params: {
  taskId: string;
  onEvent: (event: TaskResourceEvent) => void;
  onStatus?: (status: string) => void;
}) {
  const subscription = subscribeBroadcast(
    liveTopics.task(params.taskId),
    (event, payload) => {
      const kind = KINDS[event];
      if (kind) params.onEvent({ kind, payload: toRowChange(payload) } as TaskResourceEvent);
    },
    (status) => {
      if (status === "connected") params.onStatus?.("SUBSCRIBED");
      else if (status !== "connecting") params.onStatus?.("CLOSED");
    },
  );
  return subscription.unsubscribe;
}
