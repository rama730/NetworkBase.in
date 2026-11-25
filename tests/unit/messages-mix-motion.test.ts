import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const mix = readFileSync('src/components/messages/messages-mix.css', 'utf8');
const toasts = readFileSync('src/components/feedback/feedback.css', 'utf8');

test('Messages motion stops under the OS setting and under the app\'s own Reduce motion', () => {
  assert.match(mix, /@media \(prefers-reduced-motion: reduce\) \{\s*\.nbm, \.nbm \*/);
  assert.match(mix, /html\[data-reduce-motion="true"\] \.nbm, html\[data-reduce-motion="true"\] \.nbm \*/);
});

test('toasts follow the app\'s Reduce motion too: fade only, the stack fans without moving', () => {
  assert.match(toasts, /html\[data-reduce-motion="true"\] \.nb-feedback-card\{animation-name:nb-feedback-fade-in;animation-duration:100ms;transition:none\}/);
  assert.match(toasts, /html\[data-reduce-motion="true"\] \.nb-feedback-stack\{transition:none\}/);
  assert.match(toasts, /html\[data-reduce-motion="true"\] \.nb-feedback-fallback\{transition:none\}/);
});

test('the toast host times its fades by the same two settings', () => {
  assert.match(readFileSync('src/components/feedback/FeedbackHost.tsx', 'utf8'), /document\.documentElement\.dataset\.reduceMotion === 'true'/);
});
