import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { personRequestDate, personConnectedDate } from "../../src/lib/network/person-card";

const source = (path: string) => readFileSync(path, "utf8");

test("a reopened application displays the age of its current pending period, not its original submission", () => {
    const now = Date.parse("2026-10-20T11:00:00Z");
    assert.equal(personRequestDate("2026-10-19T10:20:54.315Z", now)?.text, "Requested · 1 day ago");
    const action = source("src/app/actions/network-invitations.ts");
    const pending = action.split("const pendingApplicationDate =")[1]!.split("const applicationActivityDate")[0]!;
    assert.match(pending, /greatest\(a.created_at/);
    assert.match(pending, /e.application_id=a.id AND e.kind='reopened' AND e.to_status='pending'/);
    assert.match(pending, /ORDER BY e.created_at DESC LIMIT 1/);
    assert.doesNotMatch(pending, /updated_at/); // editing the text does not restart the pending age
    assert.match(action, /'application','received',\$\{pendingApplicationDate\}/);
    assert.match(action, /'application','sent',\$\{applicationActivityDate\}/);
    assert.match(action, /ORDER BY created_at \$\{direction\},source \$\{direction\},id \$\{direction\}/);
});

test("decision cards use the decision timestamp and event label", () => {
    const action = source("src/app/actions/network-invitations.ts");
    assert.match(action, /ELSE coalesce\(a.decision_at,a.updated_at\) END/);
    const invitations = source("src/components/network/InvitationsClient.tsx");
    assert.doesNotMatch(invitations, /waitingLabel|Waiting /);
    assert.match(invitations, /footer=\{requestDate\(app.createdAt\)\}/);
    assert.match(invitations, /status === "accepted" \? "Accepted"/);
    assert.equal(personRequestDate("2026-10-19T10:00:00Z", Date.parse("2026-10-20T11:00:00Z"), "Accepted")?.text, "Accepted · 1 day ago");
});

test("connection cards show connected-since labels only for recorded acceptance dates", () => {
    assert.equal(personConnectedDate("2026-10-19T10:00:00Z").text, "Connected since Oct 2026");
    assert.equal(personConnectedDate(null).text, "Connected");
    const connection = source("src/components/network/ConnectionsClient.tsx");
    assert.match(connection, /acceptedAt=\{connection.acceptedAt\}/);
    assert.doesNotMatch(connection, /requestedAt=\{connection.createdAt\}/);
    assert.doesNotMatch(source("src/lib/network/person-card.ts"), /Request sent ·/);
});

test("shared person-card metadata accepts an unkeyed footer fragment without React key warnings", () => {
    const exports: Record<string, any> = {};
    const code = ts.transpileModule(source("src/components/network/PersonCardContent.tsx"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    vm.runInNewContext(code, {
        exports,
        require: (name: string) => name === "react" ? React : name === "react/jsx-runtime" ? jsxRuntime : {},
    });
    const messages: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => messages.push(args.map(String).join(" "));
    try {
        const footer = React.createElement(React.Fragment, null,
            React.createElement("span", null, "Requested · 1 day ago"),
            React.createElement("span", null, "Decision reason"));
        const html = renderToStaticMarkup(React.createElement(exports.PersonCardLayout, {
            avatar: "Avatar", head: "Name",
            meta: [React.createElement("span", { key: "shared" }, "1 shared connection"), footer],
        }));
        assert.match(html, /Requested · 1 day ago/);
        assert.match(html, /Decision reason/);
        assert.ok(!messages.some((message) => /unique.*key|Each child in a list/i.test(message)), messages.join("\n"));
    } finally { console.error = originalError; }
});
