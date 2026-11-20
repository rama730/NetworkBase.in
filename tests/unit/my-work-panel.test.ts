import assert from 'node:assert/strict'
import test from 'node:test'
import { addDaysKey, bucketOf, dayDiff, dueLabel, inkLine, nextMondayOffset, pickNextUp, requestsLine, weekColumns } from '../../src/lib/my-work/panel'

// Friday 20 Nov 2026
const TODAY = '2026-11-20'

test('days between due dates and today, and where each task sits', () => {
    assert.equal(dayDiff('2026-11-18', TODAY), -2)
    assert.equal(dayDiff('2026-11-20', TODAY), 0)
    assert.equal(dayDiff('2026-12-01', TODAY), 11)
    assert.equal(dayDiff(null, TODAY), null)
    assert.deepEqual([-2, 0, 1, 6, 7, null].map(bucketOf), ['late', 'today', 'week', 'week', 'later', 'none'])
})

test('due labels read like the prototype: late, today, tomorrow, a weekday, then a date', () => {
    assert.equal(dueLabel(-2, TODAY), '2d late')
    assert.equal(dueLabel(0, TODAY), 'Today')
    assert.equal(dueLabel(1, TODAY), 'Tomorrow')
    assert.equal(dueLabel(3, TODAY), 'Mon')
    assert.equal(dueLabel(8, TODAY), 'Nov 28')
    assert.equal(dueLabel(null, TODAY), '')
})

test('the week strip is Late plus today and the next six days', () => {
    const cols = weekColumns(TODAY)
    assert.deepEqual(cols.map((c) => c.label), ['Late', 'Today', 'Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu'])
    assert.deepEqual(cols.map((c) => c.key), ['late', 0, 1, 2, 3, 4, 5, 6])
    assert.equal(addDaysKey(TODAY, 3), '2026-11-23')
    assert.equal(nextMondayOffset(TODAY), 3)
})

test('Next up is the most urgent task of yours you can act on now', () => {
    const tasks = [
        { id: 'blocked', diff: -3, mine: true, status: 'blocked', inReview: false },
        { id: 'review', diff: -2, mine: true, status: 'done', inReview: true },
        { id: 'team', diff: -1, mine: false, status: 'todo', inReview: false },
        { id: 'later', diff: 4, mine: true, status: 'todo', inReview: false },
        { id: 'today', diff: 0, mine: true, status: 'in_progress', inReview: false },
        { id: 'nodate', diff: null, mine: true, status: 'todo', inReview: false },
    ]
    assert.equal(pickNextUp(tasks)?.id, 'today')
    assert.equal(pickNextUp(tasks.filter((t) => t.id !== 'today' && t.id !== 'later'))?.id, 'nodate')
    assert.equal(pickNextUp([]), null)
})

test('the serif line says what matters', () => {
    assert.deepEqual(inkLine({ late: 2, today: 1, week: 4, total: 9, day: null }), { em: '2 late', rest: ', 1 due today.' })
    assert.deepEqual(inkLine({ late: 2, today: 0, week: 4, total: 9, day: null }), { em: '2 late', rest: ', 4 due this week.' })
    assert.deepEqual(inkLine({ late: 0, today: 1, week: 3, total: 3, day: null }), { em: '', rest: '1 thing is due today.' })
    assert.deepEqual(inkLine({ late: 0, today: 0, week: 0, total: 2, day: null }), { em: '', rest: 'Nothing due this week.' })
    assert.deepEqual(inkLine({ late: 0, today: 0, week: 0, total: 0, day: null }), { em: '', rest: 'All clear.' })
    assert.deepEqual(inkLine({ late: 2, today: 1, week: 4, total: 9, day: 'late' }), { em: '2 late.', rest: ' Start with these.' })
    assert.deepEqual(inkLine({ late: 2, today: 1, week: 4, total: 9, day: 0, dayCount: 1 }), { em: '', rest: '1 due today.' })
    assert.deepEqual(inkLine({ late: 0, today: 0, week: 2, total: 2, day: 3, dayCount: 2, dayName: 'Monday' }), { em: '', rest: '2 due on Monday.' })
    assert.deepEqual(requestsLine(4, 1), { em: '4 people are', rest: ' waiting on you.' })
    assert.deepEqual(requestsLine(1, 0), { em: '1 person is', rest: ' waiting on you.' })
    assert.deepEqual(requestsLine(0, 2), { em: '2 invitations', rest: ' to answer.' })
    assert.deepEqual(requestsLine(0, 0), { em: '', rest: 'All caught up.' })
})
