import assert from 'node:assert/strict';
import test from 'node:test';
import { feedbackError } from '../../src/lib/feedback';
import { CHAT_ERROR_MESSAGES } from '../../src/lib/messaging/errors';

const GENERIC = 'Action couldn’t finish';

test('every chat error reaches people in its own words (finding 13)', () => {
  for (const words of [...Object.values(CHAT_ERROR_MESSAGES), 'Something went wrong. Try again.'])
    assert.notEqual(feedbackError(words), GENERIC, words);
});

test('attachment errors keep the file name', () => {
  assert.equal(feedbackError('photo.png is empty.'), 'photo.png is empty.');
  assert.equal(feedbackError('logo.svg: SVG files can’t be attached.'), 'logo.svg: SVG files can’t be attached.');
});

test('a send that bounced back says the message is back in the box', () => {
  const text = 'Couldn’t reach the server. Retry from the message. Your message is back in the box.';
  assert.equal(feedbackError(text), text);
});

test('unknown server errors still stay generic', () => {
  assert.equal(feedbackError(new Error('relation "chat_messages" does not exist')), GENERIC);
});
