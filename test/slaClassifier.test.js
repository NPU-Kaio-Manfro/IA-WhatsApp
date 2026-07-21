const test = require('node:test');
const assert = require('node:assert/strict');
const { daysPending, parseThresholds, buildRanges, classifyPending } = require('../src/slaClassifier');

test('daysPending floors whole days elapsed', () => {
  assert.equal(daysPending('2026-07-18T10:00:00.000Z', '2026-07-21T09:00:00.000Z'), 2);
  assert.equal(daysPending('2026-07-18T10:00:00.000Z', '2026-07-21T11:00:00.000Z'), 3);
});

test('parseThresholds sorts and converts to integers', () => {
  assert.deepEqual(parseThresholds('15,3,5'), [3, 5, 15]);
});

test('buildRanges creates half-open ranges with the last one unbounded', () => {
  assert.deepEqual(buildRanges([3, 5, 15]), [
    { label: '3-4 dias', min: 3, max: 4 },
    { label: '5-14 dias', min: 5, max: 14 },
    { label: '15+ dias', min: 15, max: Infinity },
  ]);
});

test('classifyPending buckets contacts by days late and excludes under-threshold ones', () => {
  const now = '2026-07-21T09:00:00.000Z';
  const pending = [
    { chat_id: 'a@c.us', contact_name: 'A', is_group: 0, last_client_msg_at: '2026-07-20T09:00:00.000Z' }, // 1 day - excluded
    { chat_id: 'b@c.us', contact_name: 'B', is_group: 0, last_client_msg_at: '2026-07-17T09:00:00.000Z' }, // 4 days
    { chat_id: 'c@g.us', contact_name: 'Grupo C', is_group: 1, last_client_msg_at: '2026-07-10T09:00:00.000Z' }, // 11 days
    { chat_id: 'd@c.us', contact_name: 'D', is_group: 0, last_client_msg_at: '2026-06-20T09:00:00.000Z' }, // 31 days
  ];

  const result = classifyPending(pending, [3, 5, 15], now);

  assert.equal(result[0].contacts.length, 1);
  assert.equal(result[0].contacts[0].contactName, 'B');
  assert.equal(result[0].contacts[0].days, 4);

  assert.equal(result[1].contacts.length, 1);
  assert.equal(result[1].contacts[0].contactName, 'Grupo C');
  assert.equal(result[1].contacts[0].isGroup, true);

  assert.equal(result[2].contacts.length, 1);
  assert.equal(result[2].contacts[0].contactName, 'D');
  assert.equal(result[2].contacts[0].days, 31);
});
