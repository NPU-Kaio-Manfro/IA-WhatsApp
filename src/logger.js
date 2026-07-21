const fs = require('node:fs');
const path = require('node:path');

function logError(logPath, code, message) {
  const line = `[${new Date().toISOString()}] [${code}] ${message}\n`;
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, line);
  } catch (err) {
    console.error(`Failed to write error log (${logPath}):`, err);
    console.error(line.trim());
  }
}

module.exports = { logError };
