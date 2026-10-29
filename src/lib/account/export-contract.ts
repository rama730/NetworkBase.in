export type AccountExportMessageRow = {
  channelId: string;
  channelName: string | null;
  channelKind: string;
  seq: number;
  body: string;
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
};

/** One of the account holder's own messages. Other people's messages are never read. */
export function toAccountExportMessage(row: AccountExportMessageRow) {
  const channel = row.channelKind === "dm"
    ? "Direct message"
    : row.channelName ? `#${row.channelName}` : "Group message";
  return {
    channel,
    channelId: row.channelId,
    seq: row.seq,
    body: row.deletedAt ? null : row.body,
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt ? row.editedAt.toISOString() : null,
  };
}
