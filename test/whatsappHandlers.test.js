const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isIgnoredChat,
  resolveContactName,
  handleIncomingMessage,
  handleOutgoingMessage,
} = require('../src/whatsappHandlers');

function fakeDb() {
  const upserts = [];
  const replies = [];
  return {
    upsertClientMessage: (chatId, name, isGroup, nowIso) => upserts.push({ chatId, name, isGroup, nowIso }),
    markReplied: (chatId, nowIso) => replies.push({ chatId, nowIso }),
    upserts,
    replies,
  };
}

test('isIgnoredChat flags status broadcast and broadcast lists', () => {
  assert.equal(isIgnoredChat('status@broadcast'), true);
  assert.equal(isIgnoredChat('123456@broadcast'), true);
  assert.equal(isIgnoredChat('5511999999999@c.us'), false);
  assert.equal(isIgnoredChat('120363012345@g.us'), false);
});

test('resolveContactName prefers name, then pushname, then number', () => {
  assert.equal(resolveContactName({ name: 'Maria Saved', pushname: 'Mari', number: '5511999999999' }), 'Maria Saved');
  assert.equal(resolveContactName({ name: undefined, pushname: 'Mari', number: '5511999999999' }), 'Mari');
  assert.equal(resolveContactName({ name: undefined, pushname: undefined, number: '5511999999999' }), '5511999999999');
});

test('handleIncomingMessage upserts PENDING for a real DM from the client', () => {
  const db = fakeDb();
  handleIncomingMessage(
    { chatId: '5511999999999@c.us', isGroup: false, fromMe: false, contact: { name: 'Maria' } },
    db,
    '2026-07-21T09:00:00.000Z',
  );
  assert.equal(db.upserts.length, 1);
  assert.deepEqual(db.upserts[0], {
    chatId: '5511999999999@c.us',
    name: 'Maria',
    isGroup: false,
    nowIso: '2026-07-21T09:00:00.000Z',
  });
});

test('handleIncomingMessage ignores broadcast/status chats', () => {
  const db = fakeDb();
  handleIncomingMessage(
    { chatId: 'status@broadcast', isGroup: false, fromMe: false, contact: { name: 'Maria' } },
    db,
    '2026-07-21T09:00:00.000Z',
  );
  assert.equal(db.upserts.length, 0);
});

test('handleIncomingMessage ignores messages the owner sent themselves', () => {
  const db = fakeDb();
  handleIncomingMessage(
    { chatId: '5511999999999@c.us', isGroup: false, fromMe: true, contact: { name: 'Maria' } },
    db,
    '2026-07-21T09:00:00.000Z',
  );
  assert.equal(db.upserts.length, 0);
});

test('handleIncomingMessage marks any non-owner group message as PENDING for the group chat_id, named after the group subject', () => {
  const db = fakeDb();
  handleIncomingMessage(
    {
      chatId: '120363012345@g.us',
      isGroup: true,
      fromMe: false,
      contact: { name: 'Cliente X' },
      groupName: 'Grupo Suporte Acme',
    },
    db,
    '2026-07-21T09:00:00.000Z',
  );
  assert.equal(db.upserts.length, 1);
  assert.equal(db.upserts[0].chatId, '120363012345@g.us');
  assert.equal(db.upserts[0].isGroup, true);
  assert.equal(db.upserts[0].name, 'Grupo Suporte Acme');
});

test('handleIncomingMessage falls back to the sender contact name if a group has no groupName', () => {
  const db = fakeDb();
  handleIncomingMessage(
    { chatId: '120363012345@g.us', isGroup: true, fromMe: false, contact: { name: 'Cliente X' }, groupName: '' },
    db,
    '2026-07-21T09:00:00.000Z',
  );
  assert.equal(db.upserts[0].name, 'Cliente X');
});

test('handleOutgoingMessage marks REPLIED only when fromMe is true', () => {
  const db = fakeDb();
  handleOutgoingMessage({ chatId: '5511999999999@c.us', fromMe: true }, db, '2026-07-21T10:00:00.000Z');
  assert.equal(db.replies.length, 1);
  assert.deepEqual(db.replies[0], { chatId: '5511999999999@c.us', nowIso: '2026-07-21T10:00:00.000Z' });
});

test('handleOutgoingMessage no-ops when fromMe is false or chat is ignored', () => {
  const db = fakeDb();
  handleOutgoingMessage({ chatId: '5511999999999@c.us', fromMe: false }, db, '2026-07-21T10:00:00.000Z');
  handleOutgoingMessage({ chatId: 'status@broadcast', fromMe: true }, db, '2026-07-21T10:00:00.000Z');
  assert.equal(db.replies.length, 0);
});

test('handleOutgoingMessage in a group marks REPLIED regardless of who sent the last client message', () => {
  const db = fakeDb();
  handleOutgoingMessage({ chatId: '120363012345@g.us', fromMe: true }, db, '2026-07-21T10:00:00.000Z');
  assert.equal(db.replies.length, 1);
  assert.equal(db.replies[0].chatId, '120363012345@g.us');
});
