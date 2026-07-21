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
    try {
      handleIncomingMessage(
        {
          chatId: chat.id._serialized,
          isGroup: chat.isGroup,
          fromMe: msg.fromMe,
          contact: { name: contact.name, pushname: contact.pushname, number: contact.number },
          groupName: chat.isGroup ? chat.name : undefined,
        },
        db,
        new Date(msg.timestamp * 1000).toISOString(),
      );
    } catch (err) {
      logError(ERROR_LOG_PATH, 'DB_WRITE_ERROR', err.message);
    }
  } catch (err) {
    logError(ERROR_LOG_PATH, 'WHATSAPP_MESSAGE_ERROR', err.message);
  }
});

client.on('message_create', async (msg) => {
  if (!msg.fromMe) return;
  try {
    const chat = await msg.getChat();
    try {
      handleOutgoingMessage(
        { chatId: chat.id._serialized, fromMe: msg.fromMe },
        db,
        new Date(msg.timestamp * 1000).toISOString(),
      );
    } catch (err) {
      logError(ERROR_LOG_PATH, 'DB_WRITE_ERROR', err.message);
    }
  } catch (err) {
    logError(ERROR_LOG_PATH, 'WHATSAPP_MESSAGE_ERROR', err.message);
  }
});

client.initialize();

scheduleSlaCheck(CRON_SCHEDULE, db, smtpConfig, SLA_THRESHOLDS, ERROR_LOG_PATH);

process.on('unhandledRejection', (err) => {
  logError(ERROR_LOG_PATH, 'UNHANDLED_REJECTION', err instanceof Error ? err.message : String(err));
  console.error('Unhandled rejection:', err);
});
