const express = require('express');
const router = express.Router();
const { buildUpiQrPngBuffer } = require('../utils/qrcode');

// GET /api/payment-qr.png?amount=12000&note=Flat%20E-1001
// Returns a PNG QR code for the UPI ID configured in .env, with the
// amount pre-filled so the tenant just has to scan and confirm.
router.get('/payment-qr.png', async (req, res) => {
  try {
    const { amount, note } = req.query;
    const buffer = await buildUpiQrPngBuffer({ amount, note });
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'no-store');
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).send('Could not generate QR code.');
  }
});

module.exports = router;
