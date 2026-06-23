const PDFDocument = require('pdfkit');
const env = require('../config/env');

// Builds a simple one-page receipt PDF in memory and returns it as a Buffer.
function buildReceiptPdf({ receiptNo, date, tenantName, flatCode, forMonth, rentDue, lateFee, amountPaid, mode, referenceNo }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A5', margin: 36 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(14).text(env.company.name, { align: 'center' });
    if (env.company.gstin) {
      doc.fontSize(9).fillColor('#555').text(`GSTIN: ${env.company.gstin}`, { align: 'center' });
    }
    doc.moveDown(0.5);
    doc.fillColor('#000').fontSize(12).text('RENT RECEIPT', { align: 'center', underline: true });
    doc.moveDown(1);

    doc.fontSize(10);
    const row = (label, value) => {
      doc.text(`${label}: ${value}`);
      doc.moveDown(0.3);
    };
    row('Receipt No', receiptNo);
    row('Date', date);
    row('Tenant', tenantName);
    row('Flat', flatCode);
    row('For month', forMonth);
    row('Rent due', `Rs. ${rentDue}`);
    if (Number(lateFee) > 0) row('Late fee', `Rs. ${lateFee}`);
    row('Amount paid', `Rs. ${amountPaid}`);
    row('Mode', mode || '-');
    row('Reference / UTR No', referenceNo || '-');

    doc.moveDown(2);
    doc.text('Authorized Signatory', { align: 'right' });
    doc.text(`For ${env.company.name}`, { align: 'right' });

    doc.end();
  });
}

module.exports = { buildReceiptPdf };
