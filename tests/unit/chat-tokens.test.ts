import assert from "node:assert/strict";
import test from "node:test";

import { parseMentions, splitTokens, tokensToPlainText } from "@/lib/messaging/tokens";

const A = "3f2b8c1e-9a7d-4e21-b0c4-5d6e7f8a9b0c";
const B = "11111111-2222-4333-8444-555555555555";

test("parses user mentions once each, plus @channel / @here", () => {
  assert.deepEqual(parseMentions(`hi <@${A}> and <@${B}> and again <@${A}>`), { userIds: [A, B], broadcast: null });
  assert.deepEqual(parseMentions("<!channel> standup"), { userIds: [], broadcast: "channel" });
  assert.deepEqual(parseMentions("<!here> anyone?"), { userIds: [], broadcast: "here" });
  assert.deepEqual(parseMentions("<@not-a-uuid> plain"), { userIds: [], broadcast: null });
});

test("splits text into renderable segments", () => {
  assert.deepEqual(splitTokens(`a <@${A}> b <#${B}> <!here>`), [
    { type: "text", value: "a " },
    { type: "user", id: A },
    { type: "text", value: " b " },
    { type: "channel", id: B },
    { type: "text", value: " " },
    { type: "broadcast", value: "here" },
  ]);
});

test("plain text for previews and push bodies", () => {
  const names = new Map([[A, "Priya"]]);
  assert.equal(tokensToPlainText(`hey <@${A}> see <#${B}> <!channel>`, (id) => names.get(id)), "hey @Priya see #channel @channel");
  assert.equal(tokensToPlainText(`hey <@${B}>`), "hey @someone");
});

test("drafts round-trip: @Name ↔ <@id>, broadcasts, longest name first", async () => {
  const { encodeMentions, tokensToDraft } = await import("@/lib/messaging/tokens");
  const people = [{ id: A, name: "Ann" }, { id: B, name: "Ann Lee" }];
  assert.equal(encodeMentions("hi @Ann Lee and @Ann, @here", people), `hi <@${B}> and <@${A}>, <!here>`);
  assert.equal(encodeMentions("mail ann@Ann.com", people), "mail ann@Ann.com", "only mentions after whitespace");
  const names = new Map([[A, "Ann"], [B, "Ann Lee"]]);
  const body = `hi <@${B}> <!channel>`;
  assert.equal(encodeMentions(tokensToDraft(body, (id) => names.get(id)), people), body);
});
