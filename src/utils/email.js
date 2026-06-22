const nodemailer = require('nodemailer');
const env = require('../config/env');

let transporter = null;
function getTransporter() {
  if (!env.smtp.host || !env.smtp.user || !env.smtp.pass) {
    return null; // SMTP not configured yet - calls below will no-op safely.
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.port === 465,
      auth: { user: env.smtp.user, pass: env.smtp.pass },
      connectionTimeout: 10000, // 10s to establish the connection
      greetingTimeout: 10000,   // 10s to hear back from the server
      socketTimeout: 15000,     // 15s of inactivity before giving up
    });
  }
  return transporter;
}

async function sendMail({ to, subject, html, attachments }) {
  const t = getTransporter();
  if (!t || !to) {
    console.log(`[email skipped - SMTP not configured] to=${to} subject="${subject}"`);
    return { skipped: true };
  }
  try {
    const info = await t.sendMail({
      from: `"${env.smtp.fromName}" <${env.smtp.user}>`,
      to,
      subject,
      html,
      attachments,
    });
    return { sent: true, info };
  } catch (err) {
    // Don't let a bad SMTP password or a down mail server break the
    // request that triggered this email (tenant creation, payment
    // confirmation, etc). Log it clearly so it's easy to spot, and move on.
    console.error(`[email FAILED] to=${to} subject="${subject}" - ${err.message}`);
    return { sent: false, error: err.message };
  }
}

async function sendWelcomeEmail({ to, tenantName, flatCode, loginUsername, tempPassword }) {
  const loginUrl = `${env.appBaseUrl}/login`;
  const html = `
    <p>Dear ${tenantName},</p>
    <p>Welcome! Your flat <strong>${flatCode}</strong> is ready, and your tenant account has been created.</p>
    <p>
      <strong>Login link:</strong> <a href="${loginUrl}">${loginUrl}</a><br/>
      <strong>Username (Flat Code):</strong> ${loginUsername}<br/>
      <strong>Temporary password:</strong> ${tempPassword}
    </p>
    <p>Please log in and change your password. From your portal you can view your agreement,
    pay rent, raise maintenance requests, and check your police verification status.</p>
    <p>Regards,<br/>${env.company.representativeName || env.company.name}</p>
  `;
  return sendMail({ to, subject: `Your login for flat ${flatCode}`, html });
}

async function sendReceiptEmail({ to, tenantName, flatCode, receiptNo, amount, forMonth, pdfBuffer }) {
  const html = `
    <p>Dear ${tenantName},</p>
    <p>We've received your rent payment for <strong>${forMonth}</strong> (Flat ${flatCode}).
    Receipt <strong>${receiptNo}</strong> is attached.</p>
    <p>Amount confirmed: <strong>\u20B9${amount}</strong></p>
    <p>Regards,<br/>${env.company.representativeName || env.company.name}</p>
  `;
  return sendMail({
    to,
    subject: `Rent receipt ${receiptNo} - Flat ${flatCode}`,
    html,
    attachments: pdfBuffer
      ? [{ filename: `${receiptNo}.pdf`, content: pdfBuffer }]
      : [],
  });
}

module.exports = { sendMail, sendWelcomeEmail, sendReceiptEmail };