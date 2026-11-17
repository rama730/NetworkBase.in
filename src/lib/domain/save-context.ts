import { sql } from "drizzle-orm";

import type { db } from "@/lib/db";

type Executor = Pick<typeof db, "execute">;

/**
 * What the save this transaction records should say (report H12; 0096 records the save itself). Without it the
 * database fills the author, agent and message from the file versions ("Changed 3 files"). Lasts to the end of the
 * transaction, so call it inside one.
 */
export type SaveContext = {
  kind?: "save" | "revert" | "sync" | "restore";
  message?: string | null;
  authorId?: string | null;
  via?: "cli" | "agent" | null;
  agentName?: string | null;
  taskId?: string | null;
  changeSetId?: string | null;
  revertsSaveId?: string | null;
};

export async function saveContext(tx: Executor, ctx: SaveContext) {
  const clean = Object.fromEntries(Object.entries(ctx).filter(([, v]) => v != null && v !== ""));
  await tx.execute(sql`SELECT set_config('nb.save', ${JSON.stringify(clean)}, true)`);
}
