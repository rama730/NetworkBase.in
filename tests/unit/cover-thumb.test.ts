import assert from 'node:assert/strict'
import test from 'node:test'
import { coverThumbUrl } from '../../src/lib/workspaces/cover-thumb'

test('a stored cover becomes a small square render; other addresses pass through', () => {
    const thumb = new URL(coverThumbUrl('https://x.supabase.co/storage/v1/object/public/project-images/a/b.png', 64))
    assert.equal(thumb.pathname, '/storage/v1/render/image/public/project-images/a/b.png')
    assert.equal(thumb.searchParams.get('width'), '64')
    assert.equal(thumb.searchParams.get('resize'), 'cover')
    assert.equal(coverThumbUrl('https://cdn.example.com/c.png'), 'https://cdn.example.com/c.png')
    assert.equal(coverThumbUrl('blob:abc'), 'blob:abc')
})
