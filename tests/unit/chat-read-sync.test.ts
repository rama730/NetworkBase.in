import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(path, 'utf8');

test('ChatShellProvider synchronizes both shell and channel details cache on applyRead', () => {
    const provider = read('src/components/messages/ChatShellProvider.tsx');

    // applyRead patches both shell and individual channel query data
    assert.match(provider, /queryKeys\.chat\.channel\(channelId\)/);
    assert.match(provider, /prev\.last_read_seq/);

    // read.moved broadcast also patches channel query data
    assert.match(provider, /queryKeys\.chat\.channel\(payload\.channel_id\)/);
});

test('ConversationView uses effectiveLastReadSeq and syncs read on send and mark read', () => {
    const view = read('src/components/messages/ConversationView.tsx');

    // Computes effectiveLastReadSeq taking the maximum of channel and shell cache
    assert.match(view, /effectiveLastReadSeq\s*=\s*isMember/);
    assert.match(view, /Math\.max\(channel\?\.last_read_seq\s*\?\?\s*0,\s*shellChannel\?\.last_read_seq\s*\?\?\s*0\)/);

    // Passes effectiveLastReadSeq down to Timeline
    assert.match(view, /lastReadSeq=\{effectiveLastReadSeq\}/);

    // On send, advances read sequence and flushes
    assert.match(view, /onSent\s*=\s*useCallback/);
    assert.match(view, /conversation\.flushRead\(target\)/);

    // markAllRead updates both shell and channel query data immediately
    assert.match(view, /queryClient\.setQueryData<any>\(queryKeys\.chat\.channel\(channelId\)/);
});

test('useConversation flushes pending reads on unmount and visibility change', () => {
    const hook = read('src/components/messages/useConversation.ts');

    // flushRead exists and flushes on visibilitychange and unmount
    assert.match(hook, /const flushRead = useCallback/);
    assert.match(hook, /document\.addEventListener\("visibilitychange"/);
    assert.match(hook, /if \(pendingSeq\.current > readSent\.current\)\s*\{\s*flushRead\(\);\s*\}/);
});

test('Timeline rangeChanged observes visible messages and sentTick dismisses banner', () => {
    const timeline = read('src/components/messages/Timeline.tsx');

    // rangeChanged reports visible messages in viewport
    assert.match(timeline, /rangeChanged=\{\(\{ startIndex, endIndex \}\)/);
    assert.match(timeline, /onSeen\(item\.message\.seq\)/);

    // Sending a message dismisses the unread banner immediately
    assert.match(timeline, /if \(sentTick === lastSentTick\.current\) return;/);
    assert.match(timeline, /setBannerOpen\(false\);/);
});
