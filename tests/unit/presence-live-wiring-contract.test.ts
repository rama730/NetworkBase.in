import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

test("every person badge reads the one shared live store through usePersonPresence", () => {
  const hook = read("src/components/presence/usePresence.ts");
  assert.match(hook, /import \{ useLiveOnline \} from "@\/components\/presence\/live-online"/);
  assert.match(hook, /const realtime = useLiveOnline\(options\.live === undefined \? userId : null\)/);
  assert.match(hook, /resolveLive\(options\.live \?\? realtime, data\?\.live\)/);
  const live = read("src/components/presence/live-online.ts");
  assert.match(live, /createLiveStore\(\{ subscribeRoom: subscribePresenceRoom \}\)/);
  assert.match(live, /useSyncExternalStore/);
});

test("the provider owns the Realtime token gate and the viewer's own id", () => {
  const provider = read("src/components/providers/PresenceProvider.tsx");
  assert.match(provider, /session\?\.access_token/);
  assert.match(provider, /liveStore\.setReady\(/);
  assert.match(provider, /liveStore\.setSelf\(/);
});

test("the chat no longer has its own presence path or live plumbing", () => {
  assert.equal(existsSync(resolve(process.cwd(), "src/hooks/useOnlineUsers.ts")), false);
  for (const file of ["ChatSections", "ConversationView", "DetailsPane"]) {
    const source = read(`src/components/messages/${file}.tsx`);
    assert.doesNotMatch(source, /useOnlineUsers/, `${file} still uses useOnlineUsers`);
    assert.doesNotMatch(source, /memberOnline|dmOnline/, `${file} still passes realtime values by hand`);
  }
  assert.doesNotMatch(read("src/components/messages/DetailsPane.tsx"), /MemberRow\(\{[^}]*online/);
});
