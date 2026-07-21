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

test('buildReportHtml escapes HTML in contact names and chat IDs to prevent injection', () => {
  const ranges = [
    {
      label: 'Test <script>alert("xss")</script>',
      min: 1,
      max: 2,
      contacts: [
        {
          chatId: '5511999999999@c.us<img src=x onerror=alert(1)>',
          contactName: '<img src=x onerror=alert(1)>',
          isGroup: false,
          days: 1,
        },
      ],
    },
  ];

  const html = buildReportHtml(ranges);

  // Verify that raw HTML tags are escaped (not present as-is)
  assert.doesNotMatch(html, /<img src=x onerror=alert\(1\)>/);
  assert.doesNotMatch(html, /<script>alert/);

  // Verify that escaped forms are present in the output
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /&lt;script&gt;alert\(&quot;xss&quot;\)&lt;\/script&gt;|&lt;script&gt;alert\("xss"\)&lt;\/script&gt;/);
});

test('buildReportHtml escapes double and single quotes in contact names', () => {
  const ranges = [
    {
      label: '3-4 dias',
      min: 3,
      max: 4,
      contacts: [
        {
          chatId: 'a@c.us',
          contactName: `Say "hi" it's me`,
          isGroup: false,
          days: 3,
        },
      ],
    },
  ];

  const html = buildReportHtml(ranges);

  assert.doesNotMatch(html, /Say "hi" it's me/);
  assert.match(html, /Say &quot;hi&quot; it&#39;s me/);
});
