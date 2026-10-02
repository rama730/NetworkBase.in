export type AccountExportMessageRow = {
  id: string;
  conversationId: string;
  content: string | null;
  type: string | null;
  createdAt: Date;
  senderId: string | null;
};

export function sanitizeAccountExportMessage(row: AccountExportMessageRow, userId: string) {
  const direction = row.senderId === userId ? "sent" : row.senderId === null ? "system" : "received";
  return {
    id: row.id,
    conversationId: row.conversationId,
    content: direction === "sent" || direction === "system" ? row.content : null,
    type: row.type,
    createdAt: row.createdAt,
    direction,
    sender: direction === "sent" ? "self" : direction === "system" ? "system" : "other-redacted",
    redacted: direction === "received",
  };
}
