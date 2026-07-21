const fs = require('node:fs');
const path = require('node:path');

function logError(logPath, code, message) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const line = `[${new Date().toISOString()}] [${code}] ${message}\n`;
  fs.appendFileSync(logPath, line);
}

module.exports = { logError };
