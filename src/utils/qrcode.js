const QRCode = require('qrcode');
const env = require('../config/env');

// Builds a standard UPI deep link. Any UPI app (GPay, PhonePe, Paytm...)
// recognizes this format and pre-fills the amount when the QR is scanned.
function buildUpiLink({ amount, note }) {
  const params = new URLSearchParams({
    pa: env.payment.upiId,
    pn: env.payment.upiPayeeName || env.company.name,
    cu: 'INR',
  });
  if (amount) params.set('am', String(amount));
  if (note) params.set('tn', note);
  return `upi://pay?${params.toString()}`;
}

async function buildUpiQrPngBuffer({ amount, note }) {
  const link = buildUpiLink({ amount, note });
  return QRCode.toBuffer(link, { width: 280, margin: 1 });
}

module.exports = { buildUpiLink, buildUpiQrPngBuffer };
