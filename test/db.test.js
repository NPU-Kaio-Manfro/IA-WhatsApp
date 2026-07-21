// test/db.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { initDb } = require('../src/db');

function tmpPaths() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-test-'));
  return {
    dbPath: path.join(dir, 'nested', 'contacts.db'),
    errorLogPath: path.join(dir, 'errors.log'),
  };
}

test('upsertClientMessage inserts a new PENDING row', () => {
  const { dbPath, errorLogPath } = tmpPaths();
  const db = initDb(dbPath, errorLogPath);

  db.upsertClientMessage('5511999999999@c.us', 'Maria', 0, '2026-07-20T10:00:00.000Z');

  const pending = db.getPendingContacts();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].chat_id, '5511999999999@c.us');
  assert.equal(pending[0].contact_name, 'Maria');
  assert.equal(pending[0].is_group, 0);
  assert.equal(pending[0].status, 'PENDING');
  assert.equal(pending[0].last_client_msg_at, '2026-07-20T10:00:00.000Z');
});

test('markReplied flips status to REPLIED and clears it from pending list', () => {
  const { dbPath, errorLogPath } = tmpPaths();
  const db = initDb(dbPath, errorLogPath);

  db.upsertClientMessage('5511999999999@c.us', 'Maria', 0, '2026-07-20T10:00:00.000Z');
  db.markReplied('5511999999999@c.us', '2026-07-20T11:00:00.000Z');

  assert.equal(db.getPendingContacts().length, 0);
});

test('a later client message re-opens a REPLIED row as PENDING again', () => {
  const { dbPath, errorLogPath } = tmpPaths();
  const db = initDb(dbPath, errorLogPath);

  db.upsertClientMessage('5511999999999@c.us', 'Maria', 0, '2026-07-20T10:00:00.000Z');
  db.markReplied('5511999999999@c.us', '2026-07-20T11:00:00.000Z');
  db.upsertClientMessage('5511999999999@c.us', 'Maria', 0, '2026-07-21T09:00:00.000Z');

  const pending = db.getPendingContacts();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].last_client_msg_at, '2026-07-21T09:00:00.000Z');
});

test('markReplied on an unknown chat_id is a no-op, not a throw', () => {
  const { dbPath, errorLogPath } = tmpPaths();
  const db = initDb(dbPath, errorLogPath);

  assert.doesNotThrow(() => db.markReplied('unknown@c.us', '2026-07-20T11:00:00.000Z'));
  assert.equal(db.getPendingContacts().length, 0);
});

test('a group chat_id is stored with is_group = 1', () => {
  const { dbPath, errorLogPath } = tmpPaths();
  const db = initDb(dbPath, errorLogPath);

  db.upsertClientMessage('120363012345@g.us', 'Grupo Suporte Acme', 1, '2026-07-20T10:00:00.000Z');

  const pending = db.getPendingContacts();
  assert.equal(pending[0].is_group, 1);
  assert.equal(pending[0].contact_name, 'Grupo Suporte Acme');
});
