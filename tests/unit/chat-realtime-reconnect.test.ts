import assert from "node:assert/strict";
import test from "node:test";

import { realtimeReconnectDelay } from "@/lib/supabase/client";

test("reconnect delays are jittered around the supabase-js steps and capped", () => {
  for (let tries = 1; tries <= 8; tries += 1) {
    const samples = Array.from({ length: 200 }, () => realtimeReconnectDelay(tries));
    const base = [1_000, 2_000, 5_000, 10_000][tries - 1] ?? 10_000;
    assert.ok(samples.every((ms) => ms >= base * 0.5 && ms <= Math.min(15_000, base * 1.5)), `tries=${tries}`);
    assert.ok(new Set(samples).size > 20, "delays must differ between tabs");
  }
});
