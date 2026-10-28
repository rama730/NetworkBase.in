import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { SettingsRadioGroup } from "@/components/settings/ui/SettingsRadioGroup";
import { SettingsRow } from "@/components/settings/ui/SettingsRow";
import { SettingsSwitch } from "@/components/settings/ui/SettingsSwitch";

const options = [
    { value: "a", label: "Alpha", description: "First" },
    { value: "b", label: "Beta", description: "Second" },
    { value: "c", label: "Gamma" },
];
const group = (value: string | undefined, busy = false) =>
    renderToStaticMarkup(createElement(SettingsRadioGroup<string>, { label: "Pick one", value, onValueChange: () => {}, options, busy, testIdPrefix: "pick" }));

test("a radio group is a labelled radiogroup with one checked option and one tab stop", () => {
    const html = group("b");
    assert.match(html, /role="radiogroup"[^>]*aria-labelledby=/);
    assert.equal((html.match(/role="radio"/g) ?? []).length, 3);
    assert.equal((html.match(/aria-checked="true"/g) ?? []).length, 1);
    // The checked option is the one Tab lands on; the others are reached with the arrow keys.
    assert.equal((html.match(/tabindex="0"/g) ?? []).length, 1);
    assert.match(html, /data-testid="pick-b"[^>]*>|aria-checked="true"[^>]*data-testid="pick-b"/);
});

test("with nothing selected Tab still lands on the first option", () => {
    const html = group(undefined);
    assert.equal((html.match(/aria-checked="false"/g) ?? []).length, 3);
    assert.equal((html.match(/tabindex="0"/g) ?? []).length, 1);
});

test("while a save runs the options stay focusable but say they are busy", () => {
    const html = group("a", true);
    assert.match(html, /aria-busy="true"/);
    assert.match(html, /aria-disabled="true"/);
    assert.doesNotMatch(html, /<button[^>]*\sdisabled/);
});

test("the switch keeps its place while pending, and its On/Off text is hidden from screen readers", () => {
    const html = renderToStaticMarkup(createElement(SettingsSwitch, { showLabel: true, checked: true, pending: true, "aria-label": "Email" }));
    assert.match(html, /role="switch"/);
    assert.match(html, /aria-busy="true"/);
    assert.match(html, /aria-hidden="true"[^>]*>On</);
    assert.doesNotMatch(html, /<button[^>]*\sdisabled[=\s>]/);
});

test("a settings row lets its control point at the description", () => {
    const html = renderToStaticMarkup(createElement(SettingsRow, { title: "Email", description: "Task emails", descriptionId: "email-description" }));
    assert.match(html, /id="email-description"/);
});
