import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

// ponytail: the Inngest Hobby plan allows 50,000 executions a month, about 1,650 a day, counting a run and each step.
// A run costs about 2 to 3, so 450 scheduled runs a day leaves room for real activity. Upgrade path: a paid plan, once
// the dashboard shows real activity (not timers) approaching the limit.
const MAX_SCHEDULED_RUNS_PER_DAY = 450;
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
