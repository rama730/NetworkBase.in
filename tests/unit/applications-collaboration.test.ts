import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readProjectFile(relativePath: string) {
    return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function extractExportedFunction(source: string, functionName: string) {
    let start = source.indexOf(`export async function ${functionName}`);
    if (start === -1) {
        start = source.indexOf(`export function ${functionName}`);
    }
    assert.notEqual(start, -1, `${functionName} should exist`);
    const nextFunction = source.indexOf('\nexport ', start + functionName.length);
    return source.slice(start, nextFunction === -1 ? undefined : nextFunction);
}

test('applications barrel delegates the server boundary to its async implementation module', () => {
    const barrel = readProjectFile('src/app/actions/applications/index.ts');
    const internal = readProjectFile('src/app/actions/applications/internal.ts');

    assert.doesNotMatch(barrel, /^['"]use server['"];?/m);
    assert.match(internal, /^['"]use server['"];?/m);
    assert.doesNotMatch(internal, /^export (?!async function|type |interface )/m);
});
