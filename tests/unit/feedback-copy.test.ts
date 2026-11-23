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

test('catalog templates fill placeholders and match real text (decision 44)', async () => {
  const { fillTemplate } = await import('../../src/lib/feedback');
  const { FEEDBACK_COPY } = await import('../../src/lib/feedback/copy');
  assert.equal(fillTemplate('{uploaded} uploaded · {failed} failed', { uploaded: 6, failed: 2 }), '6 uploaded · 2 failed');
  const shown = compactFeedback('6 uploaded · 2 failed', 'success');
  assert.equal(shown.type, 'warning');
  assert.equal(shown.options.description, 'Finished files were saved.');
  assert.equal(compactFeedback('Asha mentioned you', 'info').message, 'Asha mentioned you');
  for (const key of Object.keys(FEEDBACK_COPY)) assert.doesNotMatch(key, /Kavya|Fieldnotes|^\d|· \d/, key);
});

test("success wording is plain: no 'successfully' anywhere, 'Copied' not 'Copied to clipboard', capital first letter kept", () => {
  assert.equal(compactFeedback("Copied to clipboard", "success").message, "Copied");
  assert.equal(compactFeedback("Successfully saved your settings", "success").message, "Saved your settings");
  assert.equal(compactFeedback("Saved successfully!", "success").message, "Saved");
  assert.equal(compactFeedback("Profile was successfully updated.", "success").message, "Profile was updated.");
});

test('every error toast says what to do next: a plain failure gets "Try again", one with its own step keeps it', async () => {
  const { toast, feedbackStore } = await import('../../src/lib/feedback');
  const last = () => feedbackStore.getSnapshot().items.at(-1)!;
  toast.error('Some internal thing broke');
  assert.equal(last().title, 'Action couldn’t finish');
  assert.equal(last().description, 'Try again. If it keeps happening, refresh the page.');
  toast.error('Some internal thing broke', { retry: () => undefined });
  assert.equal(last().action?.label, 'Retry');
  assert.equal(last().description, undefined);
  toast.error('Failed to fetch');
  assert.equal(last().description, 'Check your connection and try again.');
  toast.error('Some internal thing broke', { description: 'Ask an admin to unlock it.' });
  assert.equal(last().description, 'Ask an admin to unlock it.');
  toast.dismiss();
});
