import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { editMessageSchema, deleteMessageSchema } from '../../src/lib/validations/messaging'

describe('sendMessageSchema', () => {
    const validId = '123e4567-e89b-42d3-a456-426614174000'
})

describe('editMessageSchema', () => {
    it('passes with valid input', () => {
        const result = editMessageSchema.safeParse({
            messageId: '123e4567-e89b-42d3-a456-426614174001',
            content: 'Updated!',
        })
        assert.equal(result.success, true)
    })

    it('rejects empty content', () => {
        const result = editMessageSchema.safeParse({
            messageId: '123e4567-e89b-42d3-a456-426614174001',
            content: '',
        })
        assert.equal(result.success, false)
    })
})

describe('deleteMessageSchema', () => {
    it('defaults scope to everyone', () => {
        const result = deleteMessageSchema.safeParse({
            messageId: '123e4567-e89b-42d3-a456-426614174002',
        })
        assert.equal(result.success, true)
        if (result.success) {
            assert.equal(result.data.scope, 'everyone')
        }
    })

    it('accepts me scope', () => {
        const result = deleteMessageSchema.safeParse({
            messageId: '123e4567-e89b-42d3-a456-426614174002',
            scope: 'me',
        })
        assert.equal(result.success, true)
    })
})
