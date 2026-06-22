const PDFDocument = require('pdfkit');
const env = require('../config/env');

function inr(value) {
  return `Rs. ${Number(value || 0).toFixed(2)}`;
}

function buildReceiptPdf({
  receiptNo,
  date,
  tenantName,
  flatCode,
  forMonth,
  rentDue,
  lateFee,
  amountPaid,
  mode,
  referenceNo,
  items = [],
  previousBalance = 0,
  currentBalance = 0,
  tenantPhone = '-',
  propertyName,
  stampText,
  gstInvoiceNo,
  tenantGstin,
}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const finalStamp = stampText || (Number(currentBalance || 0) <= 0 ? 'PAID' : Number(amountPaid || 0) > 0 ? 'PARTIALLY PAID' : 'UNPAID');
    const breakdown = items.length ? items : [{ purpose: 'rent', custom_label: null, amount: amountPaid }];
    const property = propertyName || env.company?.name || 'Rental Management';

    doc.save();
    doc.rotate(-25, { origin: [280, 360] });
    doc.fontSize(52).fillColor('#d1d5db').opacity(0.25).text(finalStamp, 120, 280, { align: 'center', width: 350 });
    doc.restore();
    doc.opacity(1).fillColor('#000');

    doc.fontSize(18).text(env.company?.name || 'Rental Management', { align: 'center' });
    if (env.company?.registeredAddress) {
      doc.moveDown(0.2);
      doc.fontSize(9).fillColor('#555').text(env.company.registeredAddress, { align: 'center' });
    }
    if (env.company?.gstin) {
      doc.moveDown(0.1);
      doc.fontSize(9).text(`GSTIN: ${env.company.gstin}`, { align: 'center' });
    }

    doc.moveDown(0.6);
    doc.fillColor('#000').fontSize(14).text('RENT RECEIPT', { align: 'center', underline: true });
    doc.moveDown(1);

    const label = (x, y, key, value) => {
      doc.font('Helvetica-Bold').fontSize(10).text(`${key}:`, x, y, { continued: true });
      doc.font('Helvetica').text(` ${value}`);
    };

    let y = doc.y;
    label(40, y, 'Receipt No', receiptNo || '-');
    label(320, y, 'Date', date || '-');
    y += 18;
    label(40, y, 'Property', property);
    label(320, y, 'Flat', flatCode || '-');
    y += 18;
    label(40, y, 'Tenant', tenantName || '-');
    label(320, y, 'Phone', tenantPhone || '-');
    y += 18;
    label(40, y, 'For Month', forMonth || '-');
    label(320, y, 'Mode', mode || '-');
    y += 18;
    label(40, y, 'Reference / UTR', referenceNo || '-');
    if (gstInvoiceNo) label(320, y, 'GST Invoice', gstInvoiceNo);
    y += 18;
    if (tenantGstin) label(40, y, 'Tenant GSTIN', tenantGstin);

    doc.moveDown(2);
    doc.font('Helvetica-Bold').fontSize(11).text('Monthly Breakdown');
    doc.moveDown(0.5);

    const tableX = 40;
    const tableWidth = 515;
    const col1 = 330;
    const col2 = 120;
    const rowHeight = 22;
    let tableY = doc.y;

    doc.rect(tableX, tableY, tableWidth, rowHeight).fill('#111827');
    doc.fillColor('#fff').fontSize(10).text('Particulars', tableX + 10, tableY + 6, { width: col1 - 20 });
    doc.text('Amount', tableX + col1 + 10, tableY + 6, { width: col2 - 20, align: 'right' });
    doc.fillColor('#000');
    tableY += rowHeight;

    breakdown.forEach((item, index) => {
      const title = item.custom_label || String(item.purpose || 'rent').replace(/_/g, ' ');
      if (index % 2 === 0) {
        doc.rect(tableX, tableY, tableWidth, rowHeight).fill('#f9fafb');
        doc.fillColor('#000');
      }
      doc.text(title, tableX + 10, tableY + 6, { width: col1 - 20 });
      doc.text(inr(item.amount), tableX + col1 + 10, tableY + 6, { width: col2 - 20, align: 'right' });
      tableY += rowHeight;
    });

    const summaryRows = [
      ['Rent Due', inr(rentDue)],
      ['Late Fee', inr(lateFee)],
      ['Previous Balance', inr(previousBalance)],
      ['Amount Paid', inr(amountPaid)],
      ['Current Balance', inr(currentBalance)],
    ];

    tableY += 10;
    summaryRows.forEach(([k, v], i) => {
      if (i % 2 === 0) {
        doc.rect(tableX, tableY, tableWidth, rowHeight).fill('#f3f4f6');
        doc.fillColor('#000');
      }
      doc.font('Helvetica-Bold').text(k, tableX + 10, tableY + 6, { width: col1 - 20 });
      doc.font('Helvetica').text(v, tableX + col1 + 10, tableY + 6, { width: col2 - 20, align: 'right' });
      tableY += rowHeight;
    });

    doc.moveTo(tableX, tableY + 8).lineTo(tableX + tableWidth, tableY + 8).strokeColor('#d1d5db').stroke();
    doc.moveDown(2);
    doc.y = tableY + 20;

    doc.font('Helvetica-Bold').text(`Status: ${finalStamp}`);
    doc.font('Helvetica').moveDown(0.4);
    doc.text('This is a system-generated receipt and is valid without physical signature unless otherwise required.');
    doc.moveDown(1.5);
    doc.text('Authorized Signatory', { align: 'right' });
    doc.text(`For ${env.company?.name || 'Rental Management'}`, { align: 'right' });

    doc.end();
  });
}

module.exports = { buildReceiptPdf };