import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

test('realtime presence-client: preserves incoming payload.profile and populates userName', () => {
    const presenceClientPath = path.join(process.cwd(), 'src/lib/realtime/presence-client.ts');
    const content = fs.readFileSync(presenceClientPath, 'utf8');

    // Verify broadcastTyping payload populates userName and profile
    assert.ok(
        content.includes('userName: event.profile?.fullName ?? event.profile?.username ?? null'),
        'broadcastTyping must populate userName from profile'
    );

    // Verify setupChannel preserves incoming payload.profile instead of overwriting with null
    assert.ok(
        content.includes('const profile = payload.profile ?? authenticatedMember.profile ?? null;'),
        'setupChannel must retain payload.profile'
    );
});

test('video attachments: chat tiles show thumbnails and the media viewer owns playback', () => {
    const tiles = fs.readFileSync(path.join(process.cwd(), 'src/components/messages/parts/message-attachments.tsx'), 'utf8');
    const viewer = fs.readFileSync(path.join(process.cwd(), 'src/components/ui/media-viewer.tsx'), 'utf8');
    const player = fs.readFileSync(path.join(process.cwd(), 'src/components/messages/parts/resolved-video-player.tsx'), 'utf8');

    assert.ok(!tiles.includes('<video'), 'Chat tiles must not start a video-body request');
    assert.ok(viewer.includes('<ResolvedVideoPlayer'), 'The media viewer must play videos');
    for (const attribute of ['autoPlay={true}', 'muted={viewerMuted}', 'playsInline={true}']) {
        assert.ok(viewer.includes(attribute), `Viewer video must set ${attribute}`);
    }
    // The sound toggle lives in the mix player bar under the viewer's video (Phase 10).
    const bar = fs.readFileSync(path.join(process.cwd(), 'src/components/messages/parts/MixPlayerBar.tsx'), 'utf8');
    assert.ok(viewer.includes('<MixPlayerBar') && bar.includes('VolumeX') && bar.includes('Volume2'), 'The viewer player bar must include VolumeX and Volume2 toggle icons');
    assert.ok(player.includes('<video'), 'ResolvedVideoPlayer must render a native video element');
});

test('global presence: MainRuntimeProviders sets presenceEnabled={true}', () => {
    const runtimePath = path.join(process.cwd(), 'src/components/providers/MainRuntimeProviders.tsx');
    const content = fs.readFileSync(runtimePath, 'utf8');

    assert.ok(
        content.includes('<LazyPresenceProvider presenceEnabled={true} />'),
        'MainRuntimeProviders must pass presenceEnabled={true} so user presence shows green across entire app'
    );
    assert.ok(
        !content.includes('presenceEnabled={isMessagesRoute || popupOpen}'),
        'Must not restrict presence to isMessagesRoute || popupOpen'
    );
});
