const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { logError } = require('../src/logger');

test('logError creates parent directories and appends a formatted line', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logger-test-'));
  const logPath = path.join(dir, 'nested', 'errors.log');

  logError(logPath, 'DB_WRITE_ERROR', 'disk full');

  const content = fs.readFileSync(logPath, 'utf8');
  assert.match(content, /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] \[DB_WRITE_ERROR\] disk full\n$/);
});

test('logError appends multiple lines without overwriting', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logger-test-'));
  const logPath = path.join(dir, 'errors.log');

  logError(logPath, 'SMTP_SEND_FAILED', 'timeout');
  logError(logPath, 'DB_READ_ERROR', 'locked');

  const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n');
  assert.equal(lines.length, 2);
  assert.match(lines[0], /\[SMTP_SEND_FAILED\] timeout$/);
  assert.match(lines[1], /\[DB_READ_ERROR\] locked$/);
});
