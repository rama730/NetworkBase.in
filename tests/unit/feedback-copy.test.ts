import assert from 'node:assert/strict';
import test from 'node:test';
import { compactFeedback, feedbackError } from '../../src/lib/feedback';

const GENERIC = 'Action couldn’t finish';

test('straight apostrophes and three dots still find the catalog entry', () => {
  assert.equal(feedbackError(new Error("Couldn't copy the link")), 'Couldn’t copy the link');
  assert.equal(compactFeedback("Couldn't copy the link", 'error').message, 'Couldn’t copy the link');
});

test('specific failures keep their own wording', () => {
  for (const message of [
    'Couldn’t copy the hex dump',
    'Couldn’t copy the cell',
    'Couldn’t copy the table',
    'Couldn’t copy the image',
    'Couldn’t copy the SVG code',
    'Couldn’t update activity visibility',
    'Couldn’t upload the photo',
    'Couldn’t save the file',
    'Couldn’t open that channel',
  ]) assert.equal(feedbackError(message), message);
});

test('unknown server errors stay generic', () => {
  assert.equal(feedbackError(new Error('relation "projects" does not exist')), GENERIC);
  assert.equal(feedbackError('pg: something broke'), GENERIC);
});

test('warnings keep their text, so limits reach people', () => {
  const shown = compactFeedback('You can attach up to 4 items.', 'warning');
  assert.equal(shown.message, 'You can attach up to 4 items.');
  assert.equal(shown.type, 'warning');
});

test('action labels are never rewritten', () => {
  const shown = compactFeedback('Group created', 'success', { action: { label: 'Open details', onClick() {} } });
  assert.equal((shown.options.action as { label: string }).label, 'Open details');
});
