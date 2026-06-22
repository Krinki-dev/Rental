const crypto = require('crypto');
const nodemailer = require('nodemailer');
const env = require('../config/env');

let transporter = null;
const recentEmailKeys = new Map();
const DEDUPE_WINDOW_MS = 2 * 60 * 1000;

function getTransporter() {
  if (!env.smtp.host || !env.smtp.user || !env.smtp.pass) {
    return null;
  }

  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.port === 465,
      auth: {
        user: env.smtp.user,
        pass: env.smtp.pass,
      },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    });
  }

  return transporter;
}

function cleanupRecentKeys() {
  const now = Date.now();
  for (const [key, ts] of recentEmailKeys.entries()) {
    if (now - ts > DEDUPE_WINDOW_MS) recentEmailKeys.delete(key);
  }
}

function shouldSkipDuplicateEmail(key) {
  cleanupRecentKeys();
  if (!key) return false;
  if (recentEmailKeys.has(key)) return true;
  recentEmailKeys.set(key, Date.now());
  return false;
}

async function sendMail({ to, subject, html, attachments = [], dedupeKey = null }) {
  const t = getTransporter();
  if (!t || !to) {
    console.log(`[email skipped - SMTP not configured] to=${to} subject="${subject}"`);
    return { skipped: true };
  }

  if (shouldSkipDuplicateEmail(dedupeKey)) {
    console.warn(`[email deduped] to=${to} subject="${subject}" key=${dedupeKey}`);
    return { skipped: true, duplicate: true };
  }

  try {
    const info = await t.sendMail({
      from: `"${env.smtp.fromName || env.company.name}" <${env.smtp.user}>`,
      to,
      subject,
      html,
      attachments,
    });
    return { sent: true, info };
  } catch (err) {
    console.error(`[email FAILED] to=${to} subject="${subject}" - ${err.message}`);
    return { sent: false, error: err.message };
  }
}

function basicHtmlLayout(title, bodyHtml) {
  return `
    <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.6; max-width: 640px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 12px; background: #ffffff;">
      <h2 style="margin: 0 0 16px;">${title}</h2>
      <div>${bodyHtml}</div>
      <p style="margin-top: 24px;">Regards,<br><strong>${env.company.representativeName || env.company.name}</strong></p>
    </div>
  `;
}

async function sendWelcomeEmail({ to, tenantName, flatCode, loginUsername, tempPassword }) {
  const loginUrl = `${env.appBaseUrl}/login`;
  const subject = `Tenant account created for Flat ${flatCode}`;
  const html = basicHtmlLayout(
    'Welcome to the tenant portal',
    `
      <p>Dear ${tenantName},</p>
      <p>Your tenant account for <strong>Flat ${flatCode}</strong> has been created.</p>
      <p>
        <strong>Login URL:</strong> <a href="${loginUrl}">${loginUrl}</a><br>
        <strong>Username:</strong> ${loginUsername}<br>
        <strong>Temporary password:</strong> ${tempPassword}
      </p>
      <p>Please log in and change your password after first sign-in.</p>
    `
  );

  return sendMail({
    to,
    subject,
    html,
    dedupeKey: crypto.createHash('sha256').update(`welcome|${to}|${flatCode}|${loginUsername}`).digest('hex'),
  });
}

async function sendReceiptEmail({ to, tenantName, flatCode, receiptNo, amount, forMonth, pdfBuffer }) {
  const subject = `Receipt ${receiptNo} for Flat ${flatCode}`;
  const html = basicHtmlLayout(
    'Payment receipt confirmed',
    `
      <p>Dear ${tenantName},</p>
      <p>Your payment for <strong>${forMonth}</strong> has been confirmed.</p>
      <p>
        <strong>Flat:</strong> ${flatCode}<br>
        <strong>Receipt No:</strong> ${receiptNo}<br>
        <strong>Amount:</strong> Rs. ${Number(amount || 0).toFixed(2)}
      </p>
      <p>Your receipt PDF is attached to this email.</p>
    `
  );

  return sendMail({
    to,
    subject,
    html,
    attachments: pdfBuffer
      ? [{ filename: `${receiptNo}.pdf`, content: pdfBuffer, contentType: 'application/pdf' }]
      : [],
    dedupeKey: crypto.createHash('sha256').update(`receipt|${to}|${receiptNo}|${amount}|${forMonth}`).digest('hex'),
  });
}

module.exports = {
  sendMail,
  sendWelcomeEmail,
  sendReceiptEmail,
};