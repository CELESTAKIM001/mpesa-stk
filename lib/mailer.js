
const nodemailer = require('nodemailer');
function configured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USERNAME && process.env.SMTP_PASSWORD && process.env.SMTP_FROM);
}
async function sendMail({to, subject, text, html, attachments}) {
  if (!configured()) throw new Error('Email is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USERNAME, SMTP_PASSWORD and SMTP_FROM.');
  const port = Number(process.env.SMTP_PORT || 587);
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST, port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USERNAME, pass: process.env.SMTP_PASSWORD },
    requireTLS: String(process.env.SMTP_USE_TLS || 'true').toLowerCase() === 'true' && port !== 465
  });
  return transporter.sendMail({ from: process.env.SMTP_FROM, to, subject, text, html, attachments });
}
module.exports = { sendMail, configured };
