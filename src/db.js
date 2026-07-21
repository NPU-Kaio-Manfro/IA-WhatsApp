// src/db.js
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { logError } = require('./logger');

function initDb(dbPath, errorLogPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const raw = new Database(dbPath);

  raw.exec(`
    CREATE TABLE IF NOT EXISTS contacts (
      chat_id TEXT PRIMARY KEY,
      contact_name TEXT,
      is_group INTEGER NOT NULL DEFAULT 0,
      last_client_msg_at TEXT,
      last_reply_at TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING'
    )
  `);

  const upsertStmt = raw.prepare(`
    INSERT INTO contacts (chat_id, contact_name, is_group, last_client_msg_at, status)
    VALUES (@chatId, @contactName, @isGroup, @nowIso, 'PENDING')
    ON CONFLICT(chat_id) DO UPDATE SET
      contact_name = excluded.contact_name,
      is_group = excluded.is_group,
      last_client_msg_at = excluded.last_client_msg_at,
      status = 'PENDING'
  `);

  const markRepliedStmt = raw.prepare(`
    UPDATE contacts SET last_reply_at = ?, status = 'REPLIED' WHERE chat_id = ?
  `);

  const pendingStmt = raw.prepare(`
    SELECT * FROM contacts WHERE status = 'PENDING'
  `);

  function upsertClientMessage(chatId, contactName, isGroup, nowIso) {
    try {
      upsertStmt.run({ chatId, contactName, isGroup: isGroup ? 1 : 0, nowIso });
    } catch (err) {
      logError(errorLogPath, 'DB_WRITE_ERROR', err.message);
    }
  }

  function markReplied(chatId, nowIso) {
    try {
      markRepliedStmt.run(nowIso, chatId);
    } catch (err) {
      logError(errorLogPath, 'DB_WRITE_ERROR', err.message);
    }
  }

  function getPendingContacts() {
    try {
      return pendingStmt.all();
    } catch (err) {
      logError(errorLogPath, 'DB_READ_ERROR', err.message);
      return [];
    }
  }

  return { raw, upsertClientMessage, markReplied, getPendingContacts };
}

module.exports = { initDb };
