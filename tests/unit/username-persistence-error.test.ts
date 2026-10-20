import test from 'node:test'
import assert from 'node:assert/strict'
import { mapUsernamePersistenceError } from '@/lib/usernames/service'

test('only the username constraints mean "taken"; any other unique violation is not blamed on the name', () => {
    assert.equal(mapUsernamePersistenceError({ code: '23505', constraint_name: 'profiles_username_unique' }).code, 'USERNAME_TAKEN')
    assert.equal(mapUsernamePersistenceError({ code: '23505', constraint_name: 'username_aliases_pkey' }).code, 'USERNAME_TAKEN')
    // drizzle wraps the driver error in `cause`
    assert.equal(mapUsernamePersistenceError({ cause: { code: '23505', constraint_name: 'profiles_username_unique' } }).code, 'USERNAME_TAKEN')

    const email = mapUsernamePersistenceError({ code: '23505', constraint_name: 'profiles_email_unique' })
    assert.equal(email.code, 'DB_ERROR')
    assert.equal(email.retryable, true)
    assert.equal(mapUsernamePersistenceError({ code: '23505' }).code, 'DB_ERROR')
})

test('check violations map to reserved or invalid', () => {
    assert.equal(mapUsernamePersistenceError({ code: '23514', message: 'Username is reserved' }).code, 'USERNAME_RESERVED')
    assert.equal(mapUsernamePersistenceError({ code: '23514', message: 'Invalid username format' }).code, 'USERNAME_INVALID')
    assert.equal(mapUsernamePersistenceError(new Error('boom')).code, 'DB_ERROR')
})
