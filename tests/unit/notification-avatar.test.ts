import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { NotificationAvatar } from "@/components/notifications/NotificationAvatar";

const render = (actorUserId: string | null, actorName: string | null) =>
    renderToStaticMarkup(createElement(NotificationAvatar, { actorUserId, actorName, avatarUrl: null, size: 34 }));

test("a notice with no person shows the brand mark, never initials from the word Notification", () => {
    const html = render(null, null);
    assert.match(html, /nb-brand-dot/);
    assert.doesNotMatch(html, />NO</);
});

test("a notice from a person shows that person", () => {
    const html = render("11111111-1111-4111-8111-111111111111", "Ravi Kumar");
    assert.doesNotMatch(html, /nb-brand-dot/);
    assert.match(html, /title="Ravi Kumar"/);
    assert.match(html, /data-avatar="pixel"/, "no photo: their pixel person");
});
