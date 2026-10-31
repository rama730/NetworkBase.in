import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

// ponytail: the Inngest Hobby plan allows 50,000 executions a month, about 1,650 a day, counting a run and each step.
// A run costs about 2 to 3, so 480 scheduled runs a day leaves room for real activity. Upgrade path: a paid plan, once
// the dashboard shows real activity (not timers) approaching the limit.
const MAX_SCHEDULED_RUNS_PER_DAY = 480;
const MIN_MINUTES_BETWEEN_RUNS = 30;

const DIR = "src/inngest/functions";

function schedules() {
  return readdirSync(DIR).filter((file) => file.endsWith(".ts")).flatMap((file) =>
    [...readFileSync(`${DIR}/${file}`, "utf8").matchAll(/cron: "([^"]+)"/g)].map((match) => ({ file, cron: match[1]! })),
  );
}

function perField(field: string, size: number) {
  if (field === "*") return size;
  const step = field.match(/^\*\/(\d+)$/);
  if (step) return Math.ceil(size / Number(step[1]));
  return field.split(",").length;
}

function runsPerDay(cron: string) {
  const [minute, hour] = cron.split(" ");
  return perField(minute!, 60) * perField(hour!, 24);
}

test("the parser counts schedules correctly", () => {
  assert.equal(runsPerDay("* * * * *"), 1440);
  assert.equal(runsPerDay("*/30 * * * *"), 48);
  assert.equal(runsPerDay("15 * * * *"), 24);
  assert.equal(runsPerDay("0 */2 * * *"), 12);
  assert.equal(runsPerDay("35 2 * * *"), 1);
});

test("finds the scheduled jobs", () => {
  assert.ok(schedules().length >= 25);
});

test("no scheduled job runs more often than every 30 minutes", () => {
  const tooOften = schedules().filter(({ cron }) => runsPerDay(cron) > (24 * 60) / MIN_MINUTES_BETWEEN_RUNS);
  assert.deepEqual(tooOften, []);
});

test("scheduled runs fit the free plan's budget", () => {
  const total = schedules().reduce((sum, { cron }) => sum + runsPerDay(cron), 0);
  assert.ok(total <= MAX_SCHEDULED_RUNS_PER_DAY, `${total} scheduled runs a day`);
});

test("trust deadlines still run within the hour the health summary checks for", () => {
  const source = readFileSync(`${DIR}/trust-safety.ts`, "utf8");
  const job = source.slice(source.indexOf('id: "trust-deadlines"'));
  const cron = job.match(/cron: "([^"]+)"/)![1]!;
  assert.ok(runsPerDay(cron) >= 24, cron);
});

test("the daily trust summary's one run lands inside its 8 am IST check", () => {
  const source = readFileSync(`${DIR}/trust-safety.ts`, "utf8");
  const job = source.slice(source.indexOf('id: "trust-daily-summary"'));
  const [minute, hour] = job.match(/cron: "([^"]+)"/)![1]!.split(" ");
  assert.equal(runsPerDay(`${minute} ${hour}`), 1);
  const at = new Date(Date.UTC(2026, 10, 2, Number(hour), Number(minute)));
  const ist = new Intl.DateTimeFormat("en-IN", { hour: "numeric", hourCycle: "h23", timeZone: "Asia/Kolkata" }).format(at);
  assert.equal(Number(ist), 8);
});

test("reconciliation's cycle estimate uses its real schedule", () => {
  const source = readFileSync(`${DIR}/workspace-files-reconciliation.ts`, "utf8");
  const stated = Number(source.match(/RECONCILIATION_RUNS_PER_DAY = (\d+)/)![1]);
  assert.equal(runsPerDay(source.match(/cron: "([^"]+)"/)![1]!), stated);
});

// Fewer runs must not mean less work done: a run that fills its batch asks for the next one straight away.
for (const [file, full] of [
  ["email-delivery.ts", /EMAIL_DRAIN_BATCH/],
  ["chat-maintenance.ts", /DUE_MESSAGE_LIMIT[\s\S]*DUE_REMINDER_LIMIT/],
  ["notification-push-delivery.ts", /DELIVERY_BATCH_SIZE/],
] as const) {
  test(`${file} runs again when its batch was full`, () => {
    const source = readFileSync(`${DIR}/${file}`, "utf8");
    const again = source.slice(source.indexOf("drain-more") - 200, source.indexOf("drain-more"));
    assert.match(source, /step\.sendEvent\("drain-more"/);
    assert.match(again, full);
  });
}

test("file deletion can keep up with its slower schedule", () => {
  const before = 100 * 288;
  const batch = Number(readFileSync("src/lib/storage/asset-deletion.ts", "utf8").match(/DELETE_BATCH_SIZE = (\d+)/)![1]);
  const cron = readFileSync(`${DIR}/storage-asset-deletion.ts`, "utf8").match(/cron: "([^"]+)"/)![1]!;
  assert.ok(batch * runsPerDay(cron) >= before / 5, `${batch * runsPerDay(cron)} a day`);
});
