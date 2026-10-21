import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

type Cleanup = (() => void) | void;
type PrefixHook = (prefix: string | null | undefined, separator?: string) => void;

const hookCode = ts.transpileModule(readFileSync('src/hooks/useDocumentTitlePrefix.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

/** Execute the production effect with document.title's HTML whitespace semantics.
 * Observer deliveries are bounded so the original freeze fails without hanging the test process.
 */
function titleHarness(initialTitle = 'Messages | NetworkBase') {
    const observers = new Set<HeadObserver>();
    const pending = new Set<HeadObserver>();
    let rawTitle = initialTitle;
    let writes = 0;
    let effect: (() => Cleanup) | undefined;
    const mutateHead = () => observers.forEach(observer => pending.add(observer));
    const document = {
        head: {},
        get title() {
            // HTML's title getter strips and collapses ASCII whitespace, not NBSP.
            return rawTitle.replace(/[\t\n\f\r ]+/g, ' ').replace(/^ | $/g, '');
        },
        set title(value: string) {
            rawTitle = value;
            writes += 1;
            mutateHead();
        },
    };
    class HeadObserver {
        constructor(readonly callback: () => void) {}
        observe() { observers.add(this); }
        disconnect() { observers.delete(this); pending.delete(this); }
    }
    const exports = {} as { useDocumentTitlePrefix: PrefixHook };
    vm.runInNewContext(hookCode, {
        exports, document, MutationObserver: HeadObserver,
        require(name: string) {
            assert.equal(name, 'react');
            return { useEffect(callback: () => Cleanup) { effect = callback; } };
        },
    });
    return {
        document,
        mutateHead,
        get writes() { return writes; },
        get observers() { return observers.size; },
        mount(prefix: string | null | undefined, separator?: string) {
            effect = undefined;
            exports.useDocumentTitlePrefix(prefix, separator);
            assert.ok(effect);
            const cleanup = effect();
            return () => { cleanup?.(); };
        },
        flush() {
            for (let round = 0; pending.size && round < 20; round += 1) {
                const batch = [...pending];
                pending.clear();
                batch.forEach(observer => { if (observers.has(observer)) observer.callback(); });
            }
            assert.equal(pending.size, 0, 'title observers must settle instead of recursively growing the title');
        },
    };
}

test('the applicant title with the reported trailing project space settles after head mutations', () => {
    const harness = titleHarness();
    harness.mount('(1)', ' ');
    harness.mount('UI/UX Designer · Network for builders ');
    harness.mutateHead();
    harness.flush();
    assert.equal(harness.document.title, 'UI/UX Designer · Network for builders | (1) Messages | NetworkBase');
    assert.equal(harness.writes, 2);
    // Repeated route/head activity must not append the title again.
    for (let i = 0; i < 100; i += 1) {
        harness.mutateHead();
        harness.flush();
    }
    assert.equal(harness.writes, 2);
});

test('leading spaces, repeated spaces, tabs and line breaks normalize for comparison and cleanup', () => {
    const harness = titleHarness();
    const cleanup = harness.mount(' \tUI/UX\nDesigner · Network  for\r\nbuilders\f ', ' \t|\n ');
    harness.mutateHead();
    harness.flush();
    assert.equal(harness.document.title, 'UI/UX Designer · Network for builders | Messages | NetworkBase');
    cleanup();
    harness.flush();
    assert.equal(harness.document.title, 'Messages | NetworkBase');
    assert.equal(harness.observers, 0);
});

test('empty titles and separators settle without duplicated prefixes', () => {
    for (const separator of [' | ', ' ', '', ' - ', ' | \t ']) {
        const harness = titleHarness('');
        const cleanup = harness.mount('  Application  ', separator);
        const expected = `Application${separator}`.replace(/[\t\n\f\r ]+/g, ' ').replace(/^ | $/g, '');
        harness.mutateHead();
        harness.flush();
        assert.equal(harness.document.title, expected);
        assert.equal(harness.writes, 1);
        cleanup();
        assert.equal(harness.document.title, '');
    }
});

test('blank and absent prefixes do not write or subscribe', () => {
    for (const prefix of [null, undefined, '', ' \t\n\r\f ']) {
        const harness = titleHarness();
        harness.mount(prefix)();
        harness.mutateHead();
        harness.flush();
        assert.equal(harness.writes, 0);
        assert.equal(harness.observers, 0);
    }
});

test('unread-count changes and conversation navigation preserve the other active prefix', () => {
    const harness = titleHarness();
    let unread = harness.mount('(1)', ' ');
    let conversation = harness.mount('UI/UX Designer · Network for builders ');
    harness.mutateHead(); harness.flush();
    unread();
    unread = harness.mount('(2)', ' ');
    harness.flush();
    assert.equal(harness.document.title, '(2) UI/UX Designer · Network for builders | Messages | NetworkBase');
    conversation();
    conversation = harness.mount('Rama · UI/UX Designer');
    harness.flush();
    assert.equal(harness.document.title, 'Rama · UI/UX Designer | (2) Messages | NetworkBase');
    unread(); harness.flush();
    assert.equal(harness.document.title, 'Rama · UI/UX Designer | Messages | NetworkBase');
    conversation(); harness.flush();
    assert.equal(harness.document.title, 'Messages | NetworkBase');
    assert.equal(harness.observers, 0);
});

test('route metadata replacement restores each active prefix once and cleanup leaves new metadata intact', () => {
    const harness = titleHarness();
    const unread = harness.mount('(3)', ' ');
    const conversation = harness.mount('Application \t chat ');
    harness.document.title = 'New page | NetworkBase';
    harness.flush();
    assert.equal(harness.document.title, 'Application chat | (3) New page | NetworkBase');
    const writes = harness.writes;
    harness.mutateHead(); harness.flush();
    assert.equal(harness.writes, writes);
    conversation(); unread(); harness.flush();
    assert.equal(harness.document.title, 'New page | NetworkBase');
});

test('Strict Mode setup/cleanup and an already-present prefix remain stable', () => {
    const harness = titleHarness('Application | Messages | NetworkBase');
    const first = harness.mount('Application ');
    harness.mutateHead(); harness.flush();
    assert.equal(harness.writes, 0);
    first();
    const second = harness.mount('Application ');
    harness.mutateHead(); harness.flush();
    assert.equal(harness.document.title, 'Application | Messages | NetworkBase');
    second(); harness.flush();
    assert.equal(harness.document.title, 'Messages | NetworkBase');
});

test('non-ASCII whitespace and Unicode names remain intact', () => {
    const harness = titleHarness();
    const cleanup = harness.mount('Équipe\u00a0—\u00a0研究');
    harness.mutateHead(); harness.flush();
    assert.equal(harness.document.title, 'Équipe\u00a0—\u00a0研究 | Messages | NetworkBase');
    cleanup();
    assert.equal(harness.document.title, 'Messages | NetworkBase');
});
