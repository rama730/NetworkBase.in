import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";

import { inRollback, sql } from "./_helpers";

// Sign-in runs on the server, so Supabase records the server's runtime ("node") and sometimes its address.
// app_private.nb_session_set_device treats that as unknown and fills in the browser's (0270).
after(() => sql.end());

const SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

async function session(tx: Parameters<Parameters<typeof inRollback>[0]>[0], userAgent: string | null, ip: string | null) {
  const id = randomUUID();
  await tx`INSERT INTO auth.sessions (id, user_id, aal, user_agent, ip) VALUES (${id}, ${randomUUID()}, 'aal1', ${userAgent}, ${ip})`;
  return id;
}

async function device(tx: Parameters<Parameters<typeof inRollback>[0]>[0], id: string) {
  const [row] = await tx`SELECT user_agent, host(ip) AS ip FROM auth.sessions WHERE id = ${id}`;
  return { ...row };
}

test("a session the server recorded gets the browser's device name and address", async () => {
  await inRollback(async (tx) => {
    for (const serverAgent of ["node", "undici", "node-fetch/1.0", "Unknown device", "", null]) {
      const id = await session(tx, serverAgent, "34.126.135.91");
      await tx`SELECT app_private.nb_session_set_device(${id}, ${SAFARI}, '49.47.253.132')`;
      assert.deepEqual(await device(tx, id), { user_agent: SAFARI, ip: "49.47.253.132" }, String(serverAgent));
    }
  });
});

test("a real browser already recorded is kept, and a missing address is filled", async () => {
  await inRollback(async (tx) => {
    const kept = await session(tx, "Mozilla/5.0 (Windows NT 10.0) Chrome/130.0", "10.0.0.1");
    await tx`SELECT app_private.nb_session_set_device(${kept}, ${SAFARI}, '49.47.253.132')`;
    assert.deepEqual(await device(tx, kept), { user_agent: "Mozilla/5.0 (Windows NT 10.0) Chrome/130.0", ip: "10.0.0.1" });
    const noIp = await session(tx, "Mozilla/5.0 (Windows NT 10.0) Chrome/130.0", null);
    await tx`SELECT app_private.nb_session_set_device(${noIp}, ${SAFARI}, '49.47.253.132')`;
    assert.equal((await device(tx, noIp)).ip, "49.47.253.132");
  });
});
