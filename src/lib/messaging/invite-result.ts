/** The toast after an invitation (EntryPoints): where the note went, and the mentor-limit warning when there is one. */
export function inviteToast(result: { messageDelivered: boolean; capacityWarning: boolean }) {
  return {
    kind: result.capacityWarning ? ("warning" as const) : ("success" as const),
    title: "Invitation sent" as const,
    ...(result.capacityWarning ? { description: "mentor limit nearly full." } : !result.messageDelivered ? { description: "Your note stays with the invitation." } : {}),
    ...(result.messageDelivered ? { action: "View conversation" as const } : {}),
  };
}
