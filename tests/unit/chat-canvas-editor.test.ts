import assert from "node:assert/strict";
import test from "node:test";

import { chatDraftToHtmlish, cleanChatMarkdown } from "@/components/messages/ChatEditor";
import { CANVAS_TEMPLATES, canvasAssetIds } from "@/lib/messaging/canvas-store";

const A = "11111111-1111-4111-8111-111111111111";

test("canvas asset ids come only from chat attachment URLs, deduped and capped", () => {
  const body = `![a](/api/v1/chat/attachments/${A} "m")\n![b](https://x.test/api/v1/chat/attachments/${A.toUpperCase()})\n![c](https://evil.test/${A})`;
  assert.deepEqual(canvasAssetIds(body), [A]);
  const many = Array.from({ length: 60 }, (_, i) => `![image](/api/v1/chat/attachments/${A.slice(0, -2)}${String(i).padStart(2, "0")})`).join("\n");
  assert.equal(canvasAssetIds(many).length, 50);
});

test("templates keep the title out of the body, so it never shows as '# Title'", () => {
  for (const template of CANVAS_TEMPLATES) {
    const { title, content } = template.generate("general", "Acme");
    assert.ok(title.trim(), template.id);
    assert.ok(!/^# /.test(content), `${template.id} body starts with an H1`);
  }
});

test("composer markdown drops serializer escapes the timeline doesn't need", () => {
  assert.equal(cleanChatMarkdown("a\\\nb"), "a\nb", "Shift+Enter line breaks stay plain newlines");
  assert.equal(cleanChatMarkdown("1 &lt; 2 &gt; 0"), "1 < 2 > 0");
  assert.equal(cleanChatMarkdown("snake\\_case and \\_lead"), "snake_case and \\_lead", "only intraword underscores unescape");
  assert.equal(cleanChatMarkdown("**bold** <@" + A + ">"), `**bold** <@${A}>`);
});

test("stored bodies load with tokens as atoms and other '<' as text", () => {
  const html = chatDraftToHtmlish(`hi <@${A}> <b>x</b>`, () => "@Ann");
  assert.equal(html, `hi <span data-chat-token="<@${A}>">@Ann</span> &lt;b>x&lt;/b>`);
});
