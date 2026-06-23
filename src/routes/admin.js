const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const env = require('../config/env');
const { requireAdmin } = require('../middleware/auth');
const { generateTempPassword, hashPassword } = require('../utils/password');
const { sendWelcomeEmail, sendReceiptEmail } = require('../utils/email');
const { buildReceiptPdf } = require('../utils/receiptPdf');
const { calculateLateFee, currentMonthKey, monthLabel, formatINR } = require('../utils/money');

router.use(requireAdmin);

// ---------- Dashboard ----------
router.get('/dashboard', async (req, res) => {
  const [[{ totalFlats }]] = await pool.query('SELECT COUNT(*) AS totalFlats FROM flats');
  const [[{ occupied }]] = await pool.query("SELECT COUNT(*) AS occupied FROM flats WHERE status = 'occupied'");
  const month = currentMonthKey();
  const [[{ collected }]] = await pool.query(
    "SELECT COALESCE(SUM(amount_paid),0) AS collected FROM payments WHERE for_month = ? AND status = 'confirmed'",
    [month]
  );
  const [[{ pendingCount }]] = await pool.query(
    "SELECT COUNT(*) AS pendingCount FROM payments WHERE for_month = ? AND status = 'pending'",
    [month]
  );
  const [pvPending] = await pool.query(
    "SELECT t.full_name, f.flat_code FROM tenants t JOIN flats f ON f.id = t.flat_id WHERE t.is_active = 1 AND t.police_verification_status != 'verified'"
  );
  const [openMaint] = await pool.query(
    "SELECT m.id, m.issue_type, m.priority, t.full_name, f.flat_code FROM maintenance_requests m JOIN tenants t ON t.id = m.tenant_id JOIN flats f ON f.id = t.flat_id WHERE m.status != 'resolved' ORDER BY m.created_at DESC LIMIT 10"
  );

  res.render('admin/dashboard', {
    totalFlats,
    occupied,
    vacant: totalFlats - occupied,
    collected,
    pendingCount,
    monthLabel: monthLabel(month),
    pvPending,
    openMaint,
    formatINR,
  });
});

// ---------- Flats ----------
router.get('/flats', async (req, res) => {
  const [flats] = await pool.query(
    `SELECT f.*, t.full_name, t.id AS tenant_id
     FROM flats f LEFT JOIN tenants t ON t.flat_id = f.id AND t.is_active = 1
     ORDER BY f.flat_code`
  );
  res.render('admin/flats', { flats, formatINR });
});

router.get('/flats/new', (req, res) => {
  res.render('admin/flat-new', { error: null });
});

router.post('/flats', async (req, res) => {
  const { flat_code, tower, floor, unit, rent_amount } = req.body;
  try {
    await pool.query(
      'INSERT INTO flats (flat_code, tower, floor, unit, rent_amount, status) VALUES (?,?,?,?,?,"vacant")',
      [flat_code.trim(), tower, floor, unit, Number(rent_amount || 0)]
    );
    res.redirect('/admin/flats');
  } catch (err) {
    res.render('admin/flat-new', { error: 'Could not save - is that flat code already in use?' });
  }
});

router.get('/flats/:id', async (req, res) => {
  const flatId = req.params.id;
  const [[flat]] = await pool.query('SELECT * FROM flats WHERE id = ?', [flatId]);
  if (!flat) return res.status(404).send('Flat not found');

  const [[tenant]] = await pool.query(
    'SELECT * FROM tenants WHERE flat_id = ? AND is_active = 1 LIMIT 1',
    [flatId]
  );

  let payments = [];
  let maintenance = [];
  if (tenant) {
    [payments] = await pool.query(
      'SELECT * FROM payments WHERE tenant_id = ? ORDER BY for_month DESC',
      [tenant.id]
    );
    [maintenance] = await pool.query(
      'SELECT * FROM maintenance_requests WHERE tenant_id = ? ORDER BY created_at DESC',
      [tenant.id]
    );
  }

  res.render('admin/flat-detail', {
    flat,
    tenant,
    payments,
    maintenance,
    formatINR,
    appBaseUrl: env.appBaseUrl,
  });
});

// Add or replace the tenant on a flat - creates login + emails it.
router.post('/flats/:id/tenant', async (req, res) => {
  const flatId = req.params.id;
  const {
    full_name, father_husband_name, phone, alt_phone, email,
    permanent_address, aadhaar_number, pan_number,
    agreement_start, agreement_end, security_deposit,
  } = req.body;

  const [[flat]] = await pool.query('SELECT * FROM flats WHERE id = ?', [flatId]);
  if (!flat) return res.status(404).send('Flat not found');

  const tempPassword = generateTempPassword();
  const hash = await hashPassword(tempPassword);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    
    // Check if user with this flat code already exists (from previous tenant)
    const [[existingUser]] = await conn.query(
      'SELECT id FROM users WHERE username = ? AND role = "tenant" LIMIT 1',
      [flat.flat_code]
    );
    
    let userId;
    if (existingUser) {
      // Reuse existing user, just update password
      await conn.query(
        'UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?',
        [hash, existingUser.id]
      );
      userId = existingUser.id;
    } else {
      // Create new user
      const [userResult] = await conn.query(
        'INSERT INTO users (role, username, password_hash, must_change_password) VALUES ("tenant", ?, ?, 1)',
        [flat.flat_code, hash]
      );
      userId = userResult.insertId;
    }
    
    await conn.query(
      `INSERT INTO tenants
        (flat_id, user_id, full_name, father_husband_name, phone, alt_phone, email,
         permanent_address, aadhaar_number, pan_number, agreement_start, agreement_end, security_deposit)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [flatId, userId, full_name, father_husband_name, phone, alt_phone, email,
        permanent_address, aadhaar_number, pan_number,
        agreement_start || null, agreement_end || null, Number(security_deposit || 0)]
    );
    await conn.query('UPDATE flats SET status = "occupied" WHERE id = ?', [flatId]);
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    console.error(err);
    return res.status(500).send('Could not save tenant - please check the details and try again.');
  } finally {
    conn.release();
  }

  await sendWelcomeEmail({
    to: email,
    tenantName: full_name,
    flatCode: flat.flat_code,
    loginUsername: flat.flat_code,
    tempPassword,
  });

  res.redirect(`/admin/flats/${flatId}`);
});

router.post('/flats/:id/police-verification', async (req, res) => {
  const { tenant_id, status, ack_no, date } = req.body;
  await pool.query(
    'UPDATE tenants SET police_verification_status = ?, police_verification_ack_no = ?, police_verification_date = ? WHERE id = ?',
    [status, ack_no || null, date || null, tenant_id]
  );
  res.redirect(`/admin/flats/${req.params.id}`);
});

router.post('/flats/:id/drive-link', async (req, res) => {
  const { tenant_id, drive_folder_link } = req.body;
  await pool.query('UPDATE tenants SET drive_folder_link = ? WHERE id = ?', [drive_folder_link, tenant_id]);
  res.redirect(`/admin/flats/${req.params.id}`);
});

router.post('/flats/:id/vacate', async (req, res) => {
  const { tenant_id } = req.body;
  await pool.query('UPDATE tenants SET is_active = 0 WHERE id = ?', [tenant_id]);
  await pool.query('UPDATE flats SET status = "vacant" WHERE id = ?', [req.params.id]);
  res.redirect(`/admin/flats/${req.params.id}`);
});

// ---------- Payments ----------
router.get('/payments', async (req, res) => {
  const [payments] = await pool.query(
    `SELECT p.*, t.full_name, f.flat_code
     FROM payments p
     JOIN tenants t ON t.id = p.tenant_id
     JOIN flats f ON f.id = t.flat_id
     ORDER BY p.created_at DESC LIMIT 200`
  );
  res.render('admin/payments', { payments, formatINR });
});

router.post('/payments/:id/confirm', async (req, res) => {
  const paymentId = req.params.id;
  const [[payment]] = await pool.query('SELECT * FROM payments WHERE id = ?', [paymentId]);
  if (!payment) return res.status(404).send('Payment not found');

  const [[tenant]] = await pool.query(
    `SELECT t.*, f.flat_code FROM tenants t JOIN flats f ON f.id = t.flat_id WHERE t.id = ?`,
    [payment.tenant_id]
  );

  const lateFee = calculateLateFee(payment.for_month, payment.payment_date);
  const receiptNo = 'R' + Date.now().toString().slice(-8);

  await pool.query(
    'UPDATE payments SET status = "confirmed", late_fee = ?, receipt_no = ?, confirmed_at = NOW() WHERE id = ?',
    [lateFee, receiptNo, paymentId]
  );

  const pdfBuffer = await buildReceiptPdf({
    receiptNo,
    date: new Date().toLocaleDateString('en-IN'),
    tenantName: tenant.full_name,
    flatCode: tenant.flat_code,
    forMonth: monthLabel(payment.for_month),
    rentDue: payment.rent_due,
    lateFee,
    amountPaid: payment.amount_paid,
    mode: payment.mode,
    referenceNo: payment.reference_no,
  });

  await sendReceiptEmail({
    to: tenant.email,
    tenantName: tenant.full_name,
    flatCode: tenant.flat_code,
    receiptNo,
    amount: payment.amount_paid,
    forMonth: monthLabel(payment.for_month),
    pdfBuffer,
  });

  res.redirect('/admin/payments');
});

// ---------- Maintenance ----------
router.get('/maintenance', async (req, res) => {
  const [requests] = await pool.query(
    `SELECT m.*, t.full_name, f.flat_code
     FROM maintenance_requests m
     JOIN tenants t ON t.id = m.tenant_id
     JOIN flats f ON f.id = t.flat_id
     ORDER BY m.created_at DESC`
  );
  res.render('admin/maintenance', { requests });
});

router.post('/maintenance/:id/status', async (req, res) => {
  const { status } = req.body;
  const resolvedAt = status === 'resolved' ? new Date() : null;
  await pool.query('UPDATE maintenance_requests SET status = ?, resolved_at = ? WHERE id = ?', [
    status,
    resolvedAt,
    req.params.id,
  ]);
  res.redirect('/admin/maintenance');
});

module.exports = router;
