import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

// Side effects that belong to a transaction (a notice about a change) and must wait until it commits, so a rollback
// leaves nothing behind. Notices are queued through their own connection, so they can't simply join the transaction.

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Job = () => Promise<unknown>;
const queued = new WeakMap<object, Job[]>();

const run = (job: Job) => job().catch((error) => logger.warn("db.after_commit_failed", { error: error instanceof Error ? error.message : String(error) }));

/** `db.transaction`, then whatever `afterCommit` queued on it, once it has committed. A rollback drops the queue. */
export async function transactionThen<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  const jobs: Job[] = [];
  const result = await db.transaction((tx) => {
    queued.set(tx, jobs);
    return work(tx);
  });
  for (const job of jobs) await run(job);
  return result;
}

/** Runs `job` once `executor`'s `transactionThen` commits; at once when `executor` is `db` or any other executor. */
export function afterCommit(executor: object, job: Job) {
  const jobs = queued.get(executor);
  if (jobs) jobs.push(job);
  else void run(job);
}
