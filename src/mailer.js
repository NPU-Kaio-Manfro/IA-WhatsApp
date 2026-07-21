const nodemailer = require('nodemailer');
const { logError } = require('./logger');

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
      from: smtpConfig.from,
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
