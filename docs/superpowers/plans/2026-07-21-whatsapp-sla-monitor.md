# WhatsApp SLA Monitor Bot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a read-only Node.js bot that listens to WhatsApp Web (via `whatsapp-web.js`), tracks per-chat SLA status (DM and group) in SQLite, and emails a daily report of clients pending a reply for 3+, 5+, or 15+ days.

**Architecture:** Business logic (chat filtering, name resolution, SQLite reads/writes, day-range classification, HTML rendering) lives in small, pure/injectable modules under `src/` that can be unit-tested with `node:test` and fakes — no real WhatsApp connection or SMTP server needed in tests. `index.js` is the only file that wires real `whatsapp-web.js`, `node-cron`, and `nodemailer` instances to that logic.

**Tech Stack:** Node.js (CommonJS), `whatsapp-web.js`, `qrcode-terminal`, `better-sqlite3`, `node-cron`, `nodemailer`, `dotenv`. Tests use Node's built-in test runner (`node --test`) — no new test dependency.

## Global Constraints

- The bot must NEVER call `sendMessage`/`reply`/any WhatsApp send API — read-only listener only (spec: "Objetivo").
- Ignore groups only for `status@broadcast` and broadcast lists — regular groups ARE monitored (spec: "Mensagem recebida").
- PK of the `contacts` table is `chat_id` (TEXT), not `phone_number` — must support both `...@c.us` and `...@g.us` (spec: "Schema").
- In groups, only the account owner's own message (`fromMe === true`) marks `REPLIED`; any other participant's message marks `PENDING` (spec: "Mensagem enviada").
- All sensitive config (SMTP creds, recipient, cron schedule, thresholds, DB path, error log path) comes from `.env`, never hardcoded (spec: "Configuração").
- Every handled error (WhatsApp, SQLite, SMTP) is both logged to console AND appended to the file at `ERROR_LOG_PATH` as `[<ISO timestamp>] [<código>] <mensagem>` (spec: "Erros").
- No feature beyond this spec: no auto-retry queue, no dashboard, no group relevance filter, no group whitelist (spec: "Fora de escopo").

---

## File Structure

- `package.json` — modify: add dependencies + `test` script.
- `.env.example` — create: documents all config keys.
- `.gitignore` — create: ignore `node_modules/`, `.wwebjs_auth/`, `.wwebjs_cache/`, `data/`, `logs/`, `.env`.
- `src/logger.js` — create: file-based error logger.
- `src/db.js` — create: SQLite layer (init, upsert, mark replied, get pending).
- `src/slaClassifier.js` — create: pure day-math + threshold-bucketing logic.
- `src/mailer.js` — create: HTML report rendering + nodemailer send.
- `src/whatsappHandlers.js` — create: pure, injectable message-handling logic (chat filtering, name resolution, DB calls) — no direct `whatsapp-web.js` import.
- `src/scheduler.js` — create: orchestrates one SLA check (fetch pending → classify → render → send) and wraps it in a `node-cron` schedule.
- `index.js` — create: wires real `whatsapp-web.js` Client (`LocalAuth`, `qrcode-terminal`), real DB, real mailer transport, and the cron schedule together.
- `README.md` — create: setup/run instructions.
- `test/logger.test.js`, `test/db.test.js`, `test/slaClassifier.test.js`, `test/mailer.test.js`, `test/whatsappHandlers.test.js` — create.

---

### Task 1: Project scaffolding (dependencies, config files)

**Files:**
- Modify: `package.json`
- Create: `.env.example`
- Create: `.gitignore`

**Interfaces:**
- Produces: `package.json` scripts `"start": "node index.js"`, `"test": "node --test test/"`; dependencies `whatsapp-web.js`, `qrcode-terminal`, `better-sqlite3`, `node-cron`, `nodemailer`, `dotenv` available to all later tasks.

- [ ] **Step 1: Install dependencies**

Run:
```bash
npm install whatsapp-web.js qrcode-terminal better-sqlite3 node-cron nodemailer dotenv
```
Expected: `package.json` `dependencies` gains all five packages; `package-lock.json` created/updated.

- [ ] **Step 2: Add scripts to `package.json`**

Edit the existing `package.json`, replacing the `"scripts"` block:

```json
  "scripts": {
    "start": "node index.js",
    "test": "node --test test/"
  },
```

- [ ] **Step 3: Create `.env.example`**

```bash
# SMTP (envio do relatório por e-mail)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=seu-email@gmail.com
SMTP_PASS=sua-senha-de-app

# Destinatário do relatório
EMAIL_TO=desenvolvimento@hinc.com.br

# Agendamento do cron (formato node-cron; padrão: todo dia às 09:00)
CRON_SCHEDULE=0 9 * * *

# Faixas de dias sem resposta que disparam alerta (dias em que cada faixa começa)
SLA_THRESHOLDS=3,5,15

# Caminho do banco SQLite
DB_PATH=./data/contacts.db

# Caminho do arquivo de log de erros
ERROR_LOG_PATH=./logs/errors.log
```

- [ ] **Step 4: Create `.gitignore`**

```
node_modules/
.wwebjs_auth/
.wwebjs_cache/
data/
logs/
.env
```

- [ ] **Step 5: Verify `npm test` runs (no tests yet, should report 0 tests, exit 0)**

Run: `mkdir -p test && npm test`
Expected: `node --test` output showing `# tests 0`, `# pass 0`, `# fail 0`, exit code 0.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json .env.example .gitignore
git commit -m "Add project dependencies and config scaffolding"
```

---

### Task 2: File-based error logger

**Files:**
- Create: `src/logger.js`
- Test: `test/logger.test.js`

**Interfaces:**
- Consumes: nothing (only Node `fs`/`path` built-ins).
- Produces: `logError(logPath, code, message)` — synchronously appends one line `[<ISO timestamp>] [<code>] <message>\n` to `logPath`, creating parent directories and the file if missing. Used by `db.js`, `mailer.js`, `index.js`.

- [ ] **Step 1: Write the failing test**

```javascript
// test/logger.test.js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/logger.test.js`
Expected: FAIL with `Cannot find module '../src/logger'`.

- [ ] **Step 3: Write minimal implementation**

```javascript
// src/logger.js
const fs = require('node:fs');
const path = require('node:path');

function logError(logPath, code, message) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const line = `[${new Date().toISOString()}] [${code}] ${message}\n`;
  fs.appendFileSync(logPath, line);
}

module.exports = { logError };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/logger.test.js`
Expected: PASS, `# pass 2`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/logger.js test/logger.test.js
git commit -m "Add file-based error logger"
```

---

### Task 3: SQLite data layer

**Files:**
- Create: `src/db.js`
- Test: `test/db.test.js`

**Interfaces:**
- Consumes: `better-sqlite3` directly; `logError` from `src/logger.js` (Task 2) for read/write error logging.
- Produces:
  - `initDb(dbPath, errorLogPath)` → returns a `db` handle object `{ raw, upsertClientMessage, markReplied, getPendingContacts }`.
  - `db.upsertClientMessage(chatId, contactName, isGroup, nowIso)` → void. Inserts or updates the row: sets `contact_name`, `is_group`, `last_client_msg_at = nowIso`, `status = 'PENDING'`.
  - `db.markReplied(chatId, nowIso)` → void. Updates `last_reply_at = nowIso`, `status = 'REPLIED'` for an existing `chat_id`; no-op (not an error) if the `chat_id` doesn't exist yet.
  - `db.getPendingContacts()` → `Array<{ chat_id, contact_name, is_group, last_client_msg_at, last_reply_at, status }>` filtered to `status = 'PENDING'`.
  - All three methods catch thrown errors, call `logError(errorLogPath, 'DB_WRITE_ERROR' | 'DB_READ_ERROR', err.message)`, and re-throw nothing (swallow after logging) so the caller (WhatsApp listener / scheduler) never crashes.

- [ ] **Step 1: Write the failing test**

```javascript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/db.test.js`
Expected: FAIL with `Cannot find module '../src/db'`.

- [ ] **Step 3: Write minimal implementation**

```javascript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/db.test.js`
Expected: PASS, `# pass 5`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/db.js test/db.test.js
git commit -m "Add SQLite data layer for contact SLA tracking"
```

---

### Task 4: SLA day-math and threshold classification

**Files:**
- Create: `src/slaClassifier.js`
- Test: `test/slaClassifier.test.js`

**Interfaces:**
- Consumes: nothing (pure functions, only `Date`).
- Produces:
  - `daysPending(lastClientMsgAtIso, nowIso)` → integer, whole days elapsed (floor).
  - `parseThresholds(thresholdsCsv)` → sorted integer array, e.g. `"3,5,15"` → `[3, 5, 15]`.
  - `buildRanges(thresholds)` → `Array<{ label, min, max }>` where `max` is `Infinity` for the last range, e.g. `[3,5,15]` → `[{label:'3-4 dias', min:3, max:4}, {label:'5-14 dias', min:5, max:14}, {label:'15+ dias', min:15, max:Infinity}]`.
  - `classifyPending(pendingContacts, thresholds, nowIso)` → `Array<{ label, min, max, contacts: Array<{ chatId, contactName, isGroup, days }> }>`, one entry per range from `buildRanges`, in ascending order, each populated with the contacts whose `daysPending` falls in `[min, max]`, sorted by `days` descending. Contacts below the lowest threshold are excluded entirely (not late enough to report).

- [ ] **Step 1: Write the failing test**

```javascript
// test/slaClassifier.test.js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/slaClassifier.test.js`
Expected: FAIL with `Cannot find module '../src/slaClassifier'`.

- [ ] **Step 3: Write minimal implementation**

```javascript
// src/slaClassifier.js
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysPending(lastClientMsgAtIso, nowIso) {
  const diffMs = new Date(nowIso).getTime() - new Date(lastClientMsgAtIso).getTime();
  return Math.floor(diffMs / MS_PER_DAY);
}

function parseThresholds(thresholdsCsv) {
  return thresholdsCsv
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .sort((a, b) => a - b);
}

function buildRanges(thresholds) {
  return thresholds.map((min, i) => {
    const isLast = i === thresholds.length - 1;
    const max = isLast ? Infinity : thresholds[i + 1] - 1;
    const label = isLast ? `${min}+ dias` : `${min}-${max} dias`;
    return { label, min, max };
  });
}

function classifyPending(pendingContacts, thresholds, nowIso) {
  const ranges = buildRanges(thresholds);

  return ranges.map((range) => {
    const contacts = pendingContacts
      .map((row) => ({
        chatId: row.chat_id,
        contactName: row.contact_name,
        isGroup: !!row.is_group,
        days: daysPending(row.last_client_msg_at, nowIso),
      }))
      .filter((c) => c.days >= range.min && c.days <= range.max)
      .sort((a, b) => b.days - a.days);

    return { ...range, contacts };
  });
}

module.exports = { daysPending, parseThresholds, buildRanges, classifyPending };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/slaClassifier.test.js`
Expected: PASS, `# pass 4`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/slaClassifier.js test/slaClassifier.test.js
git commit -m "Add SLA day-math and threshold classification"
```

---

### Task 5: HTML report rendering and email sending

**Files:**
- Create: `src/mailer.js`
- Test: `test/mailer.test.js`

**Interfaces:**
- Consumes: `classifyPending`'s output shape `Array<{ label, min, max, contacts: Array<{ chatId, contactName, isGroup, days }> }>` (Task 4); `logError` (Task 2); `nodemailer` directly.
- Produces:
  - `buildReportHtml(bucketedRanges)` → string of full HTML, containing each range's label as a heading and a row per contact with `contactName`, `chatId`, `isGroup` (rendered as "DM"/"Grupo"), and `days`. Ranges with zero contacts are skipped entirely.
  - `sendReport(smtpConfig, bucketedRanges, errorLogPath)` → `Promise<boolean>`. Returns `false` immediately without sending (and without error) if every range is empty. Otherwise builds the HTML, sends via `nodemailer.createTransport(smtpConfig.transport).sendMail(...)` to `smtpConfig.to`, returns `true` on success. On send failure, calls `logError(errorLogPath, 'SMTP_SEND_FAILED', err.message)` and returns `false` (does not throw).

- [ ] **Step 1: Write the failing test**

```javascript
// test/mailer.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { buildReportHtml, sendReport } = require('../src/mailer');

test('buildReportHtml skips empty ranges and includes contact rows', () => {
  const ranges = [
    { label: '3-4 dias', min: 3, max: 4, contacts: [] },
    {
      label: '5-14 dias',
      min: 5,
      max: 14,
      contacts: [{ chatId: '5511999999999@c.us', contactName: 'Maria', isGroup: false, days: 6 }],
    },
  ];

  const html = buildReportHtml(ranges);

  assert.doesNotMatch(html, /3-4 dias/);
  assert.match(html, /5-14 dias/);
  assert.match(html, /Maria/);
  assert.match(html, /5511999999999@c\.us/);
  assert.match(html, />DM</);
  assert.match(html, /6/);
});

test('buildReportHtml renders groups as "Grupo"', () => {
  const ranges = [
    {
      label: '15+ dias',
      min: 15,
      max: Infinity,
      contacts: [{ chatId: '120363012345@g.us', contactName: 'Grupo Acme', isGroup: true, days: 20 }],
    },
  ];

  const html = buildReportHtml(ranges);
  assert.match(html, />Grupo</);
});

test('sendReport returns false and sends nothing when all ranges are empty', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mailer-test-'));
  const errorLogPath = path.join(dir, 'errors.log');
  const ranges = [{ label: '3-4 dias', min: 3, max: 4, contacts: [] }];

  const sent = await sendReport({ transport: {}, to: 'x@example.com' }, ranges, errorLogPath);

  assert.equal(sent, false);
  assert.equal(fs.existsSync(errorLogPath), false);
});

test('sendReport logs SMTP_SEND_FAILED and returns false when the transport rejects', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mailer-test-'));
  const errorLogPath = path.join(dir, 'errors.log');
  const ranges = [
    {
      label: '3-4 dias',
      min: 3,
      max: 4,
      contacts: [{ chatId: 'a@c.us', contactName: 'A', isGroup: false, days: 3 }],
    },
  ];

  const fakeTransportFactory = () => ({
    sendMail: async () => {
      throw new Error('connection timeout');
    },
  });

  const sent = await sendReport(
    { transport: {}, to: 'x@example.com' },
    ranges,
    errorLogPath,
    fakeTransportFactory,
  );

  assert.equal(sent, false);
  const logContent = fs.readFileSync(errorLogPath, 'utf8');
  assert.match(logContent, /\[SMTP_SEND_FAILED\] connection timeout/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/mailer.test.js`
Expected: FAIL with `Cannot find module '../src/mailer'`.

- [ ] **Step 3: Write minimal implementation**

```javascript
// src/mailer.js
const nodemailer = require('nodemailer');
const { logError } = require('./logger');

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildReportHtml(bucketedRanges) {
  const sections = bucketedRanges
    .filter((range) => range.contacts.length > 0)
    .map((range) => {
      const rows = range.contacts
        .map(
          (c) => `
            <tr>
              <td>${escapeHtml(c.contactName)}</td>
              <td>${escapeHtml(c.chatId)}</td>
              <td>${c.isGroup ? 'Grupo' : 'DM'}</td>
              <td>${c.days}</td>
            </tr>`,
        )
        .join('');

      return `
        <h2>${escapeHtml(range.label)}</h2>
        <table border="1" cellpadding="6" cellspacing="0">
          <thead>
            <tr><th>Contato</th><th>Telefone/ID</th><th>Tipo</th><th>Dias sem resposta</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>`;
    })
    .join('<br/>');

  return `<html><body><h1>Relatório de SLA de Atendimento</h1>${sections}</body></html>`;
}

async function sendReport(smtpConfig, bucketedRanges, errorLogPath, transportFactory = nodemailer.createTransport) {
  const hasPending = bucketedRanges.some((range) => range.contacts.length > 0);
  if (!hasPending) {
    return false;
  }

  const html = buildReportHtml(bucketedRanges);

  try {
    const transporter = transportFactory(smtpConfig.transport);
    await transporter.sendMail({
      from: smtpConfig.transport.auth?.user,
      to: smtpConfig.to,
      subject: 'Relatório de SLA de Atendimento — WhatsApp',
      html,
    });
    return true;
  } catch (err) {
    logError(errorLogPath, 'SMTP_SEND_FAILED', err.message);
    return false;
  }
}

module.exports = { buildReportHtml, sendReport };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/mailer.test.js`
Expected: PASS, `# pass 4`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/mailer.js test/mailer.test.js
git commit -m "Add SLA report HTML rendering and email sending"
```

---

### Task 6: WhatsApp message-handling logic (pure, injectable)

**Files:**
- Create: `src/whatsappHandlers.js`
- Test: `test/whatsappHandlers.test.js`

**Interfaces:**
- Consumes: a `db`-shaped object with `upsertClientMessage(chatId, contactName, isGroup, nowIso)` and `markReplied(chatId, nowIso)` (Task 3's `initDb` return shape, or a fake in tests).
- Produces:
  - `isIgnoredChat(chatId)` → boolean, true for `status@broadcast` and any id ending in `@broadcast`.
  - `resolveContactName(contact)` → string, given `{ name, pushname, number }`-shaped object: prefers `name`, then `pushname`, then `number`.
  - `handleIncomingMessage({ chatId, isGroup, fromMe, contact, groupName }, db, nowIso)` → void. No-ops if `isIgnoredChat(chatId)` or `fromMe`. Otherwise resolves the name to store — `groupName` when `isGroup` is true (falls back to `resolveContactName(contact)` if `groupName` is falsy), otherwise `resolveContactName(contact)` — and calls `db.upsertClientMessage(chatId, resolvedName, isGroup, nowIso)`. This matches the spec rule that a group's stored name is the group subject (`chat.name`), not the individual sender's contact name.
  - `handleOutgoingMessage({ chatId, fromMe }, db, nowIso)` → void. No-ops if `isIgnoredChat(chatId)` or not `fromMe`. Otherwise calls `db.markReplied(chatId, nowIso)`.
  - These are called from `index.js` (Task 8) inside the real `message`/`message_create` event listeners, which translate `whatsapp-web.js` `msg`/`chat`/`contact` objects into the plain shapes above.

- [ ] **Step 1: Write the failing test**

```javascript
// test/whatsappHandlers.test.js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/whatsappHandlers.test.js`
Expected: FAIL with `Cannot find module '../src/whatsappHandlers'`.

- [ ] **Step 3: Write minimal implementation**

```javascript
// src/whatsappHandlers.js
function isIgnoredChat(chatId) {
  return chatId === 'status@broadcast' || chatId.endsWith('@broadcast');
}

function resolveContactName(contact) {
  return contact.name || contact.pushname || contact.number;
}

function handleIncomingMessage({ chatId, isGroup, fromMe, contact, groupName }, db, nowIso) {
  if (isIgnoredChat(chatId) || fromMe) {
    return;
  }
  const name = isGroup && groupName ? groupName : resolveContactName(contact);
  db.upsertClientMessage(chatId, name, isGroup, nowIso);
}

function handleOutgoingMessage({ chatId, fromMe }, db, nowIso) {
  if (isIgnoredChat(chatId) || !fromMe) {
    return;
  }
  db.markReplied(chatId, nowIso);
}

module.exports = { isIgnoredChat, resolveContactName, handleIncomingMessage, handleOutgoingMessage };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/whatsappHandlers.test.js`
Expected: PASS, `# pass 10`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/whatsappHandlers.js test/whatsappHandlers.test.js
git commit -m "Add pure WhatsApp message-handling logic for SLA tracking"
```

---

### Task 7: Scheduler (cron-driven SLA check)

**Files:**
- Create: `src/scheduler.js`

**Interfaces:**
- Consumes: `db.getPendingContacts()` (Task 3), `parseThresholds`/`classifyPending` (Task 4), `sendReport` (Task 5), `node-cron` directly.
- Produces:
  - `runSlaCheck(db, smtpConfig, thresholds, errorLogPath, nowIso = new Date().toISOString())` → `Promise<boolean>`, same return semantics as `sendReport` — fetches pending contacts, classifies them, and sends if non-empty.
  - `scheduleSlaCheck(cronExpression, db, smtpConfig, thresholds, errorLogPath)` → registers `node-cron`'s `cron.schedule(cronExpression, () => runSlaCheck(...))` and returns the scheduled task handle. Used only by `index.js`.

This task has no dedicated unit test file: `runSlaCheck` is a thin composition of already-tested Tasks 3–5 (verified manually in Task 8's end-to-end smoke test), and `scheduleSlaCheck` is direct `node-cron` wiring with no branching logic of its own.

- [ ] **Step 1: Write the implementation**

```javascript
// src/scheduler.js
const cron = require('node-cron');
const { classifyPending } = require('./slaClassifier');
const { sendReport } = require('./mailer');

async function runSlaCheck(db, smtpConfig, thresholds, errorLogPath, nowIso = new Date().toISOString()) {
  const pending = db.getPendingContacts();
  const ranges = classifyPending(pending, thresholds, nowIso);
  return sendReport(smtpConfig, ranges, errorLogPath);
}

function scheduleSlaCheck(cronExpression, db, smtpConfig, thresholds, errorLogPath) {
  return cron.schedule(cronExpression, () => {
    runSlaCheck(db, smtpConfig, thresholds, errorLogPath).catch(() => {
      // sendReport/runSlaCheck already log failures via logError; nothing else to do here.
    });
  });
}

module.exports = { runSlaCheck, scheduleSlaCheck };
```

- [ ] **Step 2: Sanity-check the module loads and exports the expected functions**

Run:
```bash
node -e "const s = require('./src/scheduler'); console.log(typeof s.runSlaCheck, typeof s.scheduleSlaCheck)"
```
Expected output: `function function`

- [ ] **Step 3: Commit**

```bash
git add src/scheduler.js
git commit -m "Add cron-driven SLA check scheduler"
```

---

### Task 8: Wire everything together in `index.js`, add README

**Files:**
- Create: `index.js`
- Create: `README.md`

**Interfaces:**
- Consumes: `initDb` (Task 3), `parseThresholds` (Task 4), `isIgnoredChat`/`handleIncomingMessage`/`handleOutgoingMessage` (Task 6), `scheduleSlaCheck` (Task 7), `logError` (Task 2), plus real `whatsapp-web.js`, `qrcode-terminal`, `dotenv`.
- Produces: the runnable entry point (`npm start`). No further tasks depend on this one.

- [ ] **Step 1: Write `index.js`**

```javascript
// index.js
require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const { initDb } = require('./src/db');
const { logError } = require('./src/logger');
const { parseThresholds } = require('./src/slaClassifier');
const { handleIncomingMessage, handleOutgoingMessage } = require('./src/whatsappHandlers');
const { scheduleSlaCheck } = require('./src/scheduler');

const DB_PATH = process.env.DB_PATH || './data/contacts.db';
const ERROR_LOG_PATH = process.env.ERROR_LOG_PATH || './logs/errors.log';
const CRON_SCHEDULE = process.env.CRON_SCHEDULE || '0 9 * * *';
const SLA_THRESHOLDS = parseThresholds(process.env.SLA_THRESHOLDS || '3,5,15');

const smtpConfig = {
  transport: {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 465),
    secure: String(process.env.SMTP_SECURE || 'true') === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  },
  to: process.env.EMAIL_TO,
};

const db = initDb(DB_PATH, ERROR_LOG_PATH);

const client = new Client({
  authStrategy: new LocalAuth(),
});

client.on('qr', (qr) => {
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  console.log('WhatsApp client conectado e pronto.');
});

client.on('auth_failure', (msg) => {
  logError(ERROR_LOG_PATH, 'WHATSAPP_AUTH_FAILURE', msg);
  console.error('Falha de autenticação no WhatsApp:', msg);
});

client.on('disconnected', (reason) => {
  logError(ERROR_LOG_PATH, 'WHATSAPP_DISCONNECTED', reason);
  console.error('WhatsApp desconectado:', reason);
});

client.on('message', async (msg) => {
  try {
    const chat = await msg.getChat();
    const contact = await msg.getContact();
    handleIncomingMessage(
      {
        chatId: chat.id._serialized,
        isGroup: chat.isGroup,
        fromMe: msg.fromMe,
        contact: { name: contact.name, pushname: contact.pushname, number: contact.number },
        groupName: chat.isGroup ? chat.name : undefined,
      },
      db,
      new Date().toISOString(),
    );
  } catch (err) {
    logError(ERROR_LOG_PATH, 'DB_WRITE_ERROR', err.message);
  }
});

client.on('message_create', async (msg) => {
  if (!msg.fromMe) return;
  try {
    const chat = await msg.getChat();
    handleOutgoingMessage(
      { chatId: chat.id._serialized, fromMe: msg.fromMe },
      db,
      new Date().toISOString(),
    );
  } catch (err) {
    logError(ERROR_LOG_PATH, 'DB_WRITE_ERROR', err.message);
  }
});

client.initialize();

scheduleSlaCheck(CRON_SCHEDULE, db, smtpConfig, SLA_THRESHOLDS, ERROR_LOG_PATH);

process.on('unhandledRejection', (err) => {
  logError(ERROR_LOG_PATH, 'UNHANDLED_REJECTION', err instanceof Error ? err.message : String(err));
  console.error('Unhandled rejection:', err);
});
```

- [ ] **Step 2: Write `README.md`**

```markdown
# Monitor de SLA de Atendimento via WhatsApp

Bot somente-leitura que monitora conversas do WhatsApp Web e envia um e-mail
diário com clientes (DM ou grupo) que estão há 3+, 5+ ou 15+ dias sem resposta.

## Instalação

1. Instale as dependências:
   \`\`\`bash
   npm install
   \`\`\`

2. Copie o arquivo de configuração e preencha com suas credenciais:
   \`\`\`bash
   cp .env.example .env
   \`\`\`
   - `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`: credenciais do serviço de e-mail (para Gmail, use uma "senha de app", não a senha normal da conta).
   - `EMAIL_TO`: quem recebe o relatório.
   - `CRON_SCHEDULE`: quando rodar a verificação (formato cron; padrão `0 9 * * *` = todo dia às 09:00).
   - `SLA_THRESHOLDS`: dias que iniciam cada faixa de alerta (padrão `3,5,15`).
   - `DB_PATH`: onde o SQLite é salvo (padrão `./data/contacts.db`).
   - `ERROR_LOG_PATH`: onde os erros são registrados (padrão `./logs/errors.log`).

3. Rode os testes automatizados (opcional, mas recomendado):
   \`\`\`bash
   npm test
   \`\`\`

## Rodando

\`\`\`bash
npm start
\`\`\`

Na primeira execução, um QR Code aparece no terminal — escaneie com o
WhatsApp do celular (Aparelhos conectados → Conectar um aparelho). A sessão
fica salva localmente (pasta `.wwebjs_auth/`), então não pede QR Code de novo
nas próximas execuções, a menos que você saia da sessão no celular.

O bot roda em segundo plano, escutando mensagens (sem nunca responder por
conta própria) e disparando o relatório por e-mail no horário configurado.

## O que ele NÃO faz

- Não envia nenhuma mensagem pelo WhatsApp, para clientes ou grupos.
- Não filtra mensagens de grupo por relevância (toda mensagem de não-fromMe
  conta como pendência) — melhoria futura.
- Não tem lista de grupos monitorados — todos os grupos entram no
  monitoramento hoje — melhoria futura.
```

- [ ] **Step 3: Verify the app boots (manual smoke test)**

Run: `npm start`
Expected: a QR Code prints in the terminal (or, if `.wwebjs_auth/` already has a session, it connects directly) and logs `WhatsApp client conectado e pronto.` — confirms `index.js` wires all modules without runtime errors. Stop with `Ctrl+C` once confirmed.

- [ ] **Step 4: Run the full test suite one last time**

Run: `npm test`
Expected: all suites from Tasks 2–6 pass, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add index.js README.md
git commit -m "Wire WhatsApp client, DB, and scheduler together in entry point"
```
