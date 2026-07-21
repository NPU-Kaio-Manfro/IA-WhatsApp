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
