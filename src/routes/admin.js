const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const pool = require('../config/db');
const env = require('../config/env');
const { requireAdmin } = require('../middleware/auth');
const { hashPassword } = require('../utils/password');
const { sendWelcomeEmail, sendReceiptEmail } = require('../utils/email');
const { buildReceiptPdf } = require('../utils/receiptPdf');
const { calculateLateFee, currentMonthKey, monthLabel, formatINR } = require('../utils/money');

router.use(requireAdmin);

function flatDefaultPassword(flatCode) {
  return `Rental@${String(flatCode || '').trim()}`;
}

function normalizeOptional(value) {
  if (value === undefined || value === null) return null;
  const v = String(value).trim();
  return v ? v : null;
}

function parseAmount(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function buildTransactionHash(payment) {
  const payload = [
    payment.tenant_id,
    payment.for_month,
    payment.amount_paid,
    payment.payment_date || '',
    payment.reference_no || '',
    payment.mode || '',
  ].join('|');
  return crypto.createHash('sha256').update(payload).digest('hex');
}

async function safeQuery(sql, params = [], fallback = []) {
  try {
    const [rows] = await pool.query(sql, params);
    return rows;
  } catch (_) {
    return fallback;
  }
}

async function safeSingleValue(sql, params = [], key, defaultValue = 0) {
  try {
    const [rows] = await pool.query(sql, params);
    return rows?.[0]?.[key] ?? defaultValue;
  } catch (_) {
    return defaultValue;
  }
}

async function writeAuditLog({ tableName, recordId, action, changedBy, changedByRole = 'admin', oldValues = null, newValues = null, ipAddress = null }) {
  try {
    await pool.query(
      `INSERT INTO audit_log
      (table_name, record_id, action, changed_by, changed_by_role, old_values, new_values, ip_address)
      VALUES (?,?,?,?,?,?,?,?)`,
      [
        tableName,
        recordId,
        action,
        changedBy || null,
        changedByRole,
        oldValues ? JSON.stringify(oldValues) : null,
        newValues ? JSON.stringify(newValues) : null,
        ipAddress || null,
      ]
    );
  } catch (_) {
  }
}

async function ensureOccupancyHistory(conn, flatId, tenantId, moveInDate) {
  if (!moveInDate) return;
  await conn.query(
    `INSERT INTO occupancy_history (flat_id, tenant_id, move_in_date)
     VALUES (?,?,?)`,
    [flatId, tenantId, moveInDate]
  );
}

// ---------- Dashboard ----------
router.get('/dashboard', async (req, res) => {
  const month = currentMonthKey();
  const [[{ totalFlats }]] = await pool.query('SELECT COUNT(*) AS totalFlats FROM flats');
  const [[{ occupied }]] = await pool.query("SELECT COUNT(*) AS occupied FROM flats WHERE status = 'occupied'");
  const [[{ collected }]] = await pool.query(
    "SELECT COALESCE(SUM(amount_paid),0) AS collected FROM payments WHERE for_month = ? AND status = 'confirmed'",
    [month]
  );
  const [[{ pendingCount }]] = await pool.query(
    "SELECT COUNT(*) AS pendingCount FROM payments WHERE for_month = ? AND status = 'pending'",
    [month]
  );

  const securityHeld = await safeSingleValue(
    `SELECT COALESCE(SUM(CASE WHEN txn_type IN ('collected','adjusted') THEN amount ELSE 0 END),0)
      - COALESCE(SUM(CASE WHEN txn_type IN ('used','refunded') THEN amount ELSE 0 END),0) AS balance
     FROM security_deposit_ledger`,
    [],
    'balance',
    0
  );

  const securityCollectedThisMonth = await safeSingleValue(
    `SELECT COALESCE(SUM(amount),0) AS total FROM security_deposit_ledger
     WHERE txn_type = 'collected' AND DATE_FORMAT(txn_date, '%Y-%m') = ?`,
    [month],
    'total',
    0
  );

  const securityReturnedThisMonth = await safeSingleValue(
    `SELECT COALESCE(SUM(amount),0) AS total FROM security_deposit_ledger
     WHERE txn_type = 'refunded' AND DATE_FORMAT(txn_date, '%Y-%m') = ?`,
    [month],
    'total',
    0
  );

  const electricityDue = await safeSingleValue(
    `SELECT COALESCE(SUM(amount - paid_amount),0) AS total FROM electricity_readings`,
    [],
    'total',
    0
  );

  const waterDue = await safeSingleValue(
    `SELECT COALESCE(SUM(bill_amount - paid_amount),0) AS total FROM water_bills`,
    [],
    'total',
    0
  );

  const officeExpenseThisMonth = await safeSingleValue(
    `SELECT COALESCE(SUM(amount),0) AS total FROM office_expenses WHERE DATE_FORMAT(expense_date, '%Y-%m') = ?`,
    [month],
    'total',
    0
  );

  const [pvPending] = await pool.query(
    `SELECT t.full_name, f.flat_code
     FROM tenants t
     JOIN flats f ON f.id = t.flat_id
     WHERE t.is_active = 1 AND t.police_verification_status != 'verified'`
  );

  const [openMaint] = await pool.query(
    `SELECT m.id, m.issue_type, m.priority, t.full_name, f.flat_code
     FROM maintenance_requests m
     JOIN tenants t ON t.id = m.tenant_id
     JOIN flats f ON f.id = t.flat_id
     WHERE m.status != 'resolved'
     ORDER BY m.created_at DESC LIMIT 10`
  );

  res.render('admin/dashboard', {
    totalFlats,
    occupied,
    vacant: totalFlats - occupied,
    collected,
    pendingCount,
    monthLabel: monthLabel(month),
    securityHeld,
    securityCollectedThisMonth,
    securityReturnedThisMonth,
    electricityDue,
    waterDue,
    officeExpenseThisMonth,
    pvPending,
    openMaint,
    formatINR,
  });
});

// ---------- Flats ----------
router.get('/flats', async (req, res) => {
  const [flats] = await pool.query(
    `SELECT f.*, t.full_name, t.id AS tenant_id, t.lifecycle_status
     FROM flats f
     LEFT JOIN tenants t ON t.flat_id = f.id AND t.is_active = 1
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
      [flat_code.trim(), tower, floor, unit, parseAmount(rent_amount)]
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
  let occupancyHistory = [];
  if (tenant) {
    [payments] = await pool.query(
      'SELECT * FROM payments WHERE tenant_id = ? ORDER BY created_at DESC, for_month DESC',
      [tenant.id]
    );
    [maintenance] = await pool.query(
      'SELECT * FROM maintenance_requests WHERE tenant_id = ? ORDER BY created_at DESC',
      [tenant.id]
    );
  }

  occupancyHistory = await safeQuery(
    `SELECT oh.*, t.full_name
     FROM occupancy_history oh
     JOIN tenants t ON t.id = oh.tenant_id
     WHERE oh.flat_id = ?
     ORDER BY oh.move_in_date DESC, oh.created_at DESC`,
    [flatId],
    []
  );

  res.render('admin/flat-detail', {
    flat,
    tenant,
    payments,
    maintenance,
    occupancyHistory,
    formatINR,
    appBaseUrl: env.appBaseUrl,
  });
});

router.post('/flats/:id/tenant', async (req, res) => {
  const flatId = req.params.id;
  const {
    full_name, father_husband_name, phone, alt_phone, email,
    permanent_address, aadhaar_number, pan_number,
    agreement_start, agreement_end, security_deposit,
    move_in_date, gst_registered, gstin,
  } = req.body;

  const [[flat]] = await pool.query('SELECT * FROM flats WHERE id = ?', [flatId]);
  if (!flat) return res.status(404).send('Flat not found');

  const [existingActive] = await pool.query(
    'SELECT id FROM tenants WHERE flat_id = ? AND is_active = 1 LIMIT 1',
    [flatId]
  );
  if (existingActive.length) {
    return res.status(400).send('Flat already has an active tenant. Vacate existing tenant first.');
  }

  const [lastOccupancy] = await safeQuery(
    `SELECT move_out_date FROM occupancy_history WHERE flat_id = ? ORDER BY created_at DESC LIMIT 1`,
    [flatId],
    []
  );
  if (lastOccupancy.length && lastOccupancy[0].move_out_date && move_in_date && move_in_date <= lastOccupancy[0].move_out_date) {
    return res.status(400).send('Move-in date must be after previous move-out date.');
  }

  const defaultPassword = flatDefaultPassword(flat.flat_code);
  const hash = await hashPassword(defaultPassword);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [userResult] = await conn.query(
      'INSERT INTO users (role, username, password_hash, must_change_password) VALUES ("tenant", ?, ?, 1)',
      [flat.flat_code, hash]
    );

    const [tenantResult] = await conn.query(
      `INSERT INTO tenants
      (flat_id, user_id, full_name, father_husband_name, phone, alt_phone, email,
      permanent_address, aadhaar_number, pan_number, agreement_start, agreement_end,
      security_deposit, move_in_date, lifecycle_status, gst_registered, gstin)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        flatId,
        userResult.insertId,
        full_name,
        normalizeOptional(father_husband_name),
        phone,
        normalizeOptional(alt_phone),
        normalizeOptional(email),
        normalizeOptional(permanent_address),
        normalizeOptional(aadhaar_number),
        normalizeOptional(pan_number),
        agreement_start || null,
        agreement_end || null,
        parseAmount(security_deposit),
        move_in_date || agreement_start || null,
        'move_in_confirmed',
        gst_registered ? 1 : 0,
        normalizeOptional(gstin),
      ]
    );

    await ensureOccupancyHistory(conn, flatId, tenantResult.insertId, move_in_date || agreement_start || new Date().toISOString().slice(0, 10));

    if (parseAmount(security_deposit) > 0) {
      await conn.query(
        `INSERT INTO security_deposit_ledger (tenant_id, txn_type, amount, notes, txn_date, created_by)
         VALUES (?, 'collected', ?, ?, CURDATE(), ?)`,
        [tenantResult.insertId, parseAmount(security_deposit), 'Initial security deposit', req.user.id]
      );
    }

    await conn.query('UPDATE flats SET status = "occupied" WHERE id = ?', [flatId]);
    await conn.commit();

    await writeAuditLog({
      tableName: 'tenants',
      recordId: tenantResult.insertId,
      action: 'create',
      changedBy: req.user.id,
      newValues: { flat_id: flatId, full_name, move_in_date: move_in_date || agreement_start || null },
      ipAddress: req.ip,
    });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    return res.status(500).send('Could not save tenant - please check the details and try again.');
  } finally {
    conn.release();
  }

  if (email) {
    await sendWelcomeEmail({
      to: email,
      tenantName: full_name,
      flatCode: flat.flat_code,
      loginUsername: flat.flat_code,
      tempPassword: defaultPassword,
    }).catch(() => {});
  }

  res.redirect(`/admin/flats/${flatId}`);
});

router.post('/flats/:id/police-verification', async (req, res) => {
  const { tenant_id, status, ack_no, date } = req.body;
  await pool.query(
    'UPDATE tenants SET police_verification_status = ?, police_verification_ack_no = ?, police_verification_date = ? WHERE id = ?',
    [status, normalizeOptional(ack_no), date || null, tenant_id]
  );
  res.redirect(`/admin/flats/${req.params.id}`);
});

router.post('/flats/:id/drive-link', async (req, res) => {
  const { tenant_id, drive_folder_link } = req.body;
  await pool.query('UPDATE tenants SET drive_folder_link = ? WHERE id = ?', [normalizeOptional(drive_folder_link), tenant_id]);
  res.redirect(`/admin/flats/${req.params.id}`);
});

router.post('/flats/:id/vacate', async (req, res) => {
  const flatId = req.params.id;
  const { tenant_id, move_out_date } = req.body;
  const actualMoveOutDate = move_out_date || new Date().toISOString().slice(0, 10);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `UPDATE tenants
       SET is_active = 0, lifecycle_status = 'vacated', move_out_date = ?
       WHERE id = ?`,
      [actualMoveOutDate, tenant_id]
    );
    await conn.query('UPDATE flats SET status = "vacant" WHERE id = ?', [flatId]);
    await conn.query(
      `UPDATE occupancy_history
       SET move_out_date = ?
       WHERE flat_id = ? AND tenant_id = ? AND move_out_date IS NULL`,
      [actualMoveOutDate, flatId, tenant_id]
    );
    await conn.commit();

    await writeAuditLog({
      tableName: 'tenants',
      recordId: tenant_id,
      action: 'update',
      changedBy: req.user.id,
      newValues: { is_active: 0, lifecycle_status: 'vacated', move_out_date: actualMoveOutDate },
      ipAddress: req.ip,
    });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    return res.status(500).send('Could not vacate tenant.');
  } finally {
    conn.release();
  }

  res.redirect(`/admin/flats/${flatId}`);
});

router.post('/flats/:id/reset-password', async (req, res) => {
  const flatId = req.params.id;
  const { tenant_id, reason } = req.body;
  const [[tenant]] = await pool.query(
    `SELECT t.id, t.user_id, f.flat_code
     FROM tenants t
     JOIN flats f ON f.id = t.flat_id
     WHERE t.id = ? AND t.flat_id = ?`,
    [tenant_id, flatId]
  );

  if (!tenant) return res.status(404).send('Tenant not found');

  const newPassword = flatDefaultPassword(tenant.flat_code);
  const hash = await hashPassword(newPassword);

  await pool.query(
    'UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?',
    [hash, tenant.user_id]
  );

  await safeQuery(
    `INSERT INTO password_reset_log (user_id, reset_by, reason)
     VALUES (?,?,?)`,
    [tenant.user_id, req.user.id, normalizeOptional(reason) || 'Admin reset by flat'],
    []
  );

  await writeAuditLog({
    tableName: 'users',
    recordId: tenant.user_id,
    action: 'update',
    changedBy: req.user.id,
    newValues: { password_reset: true, default_password_pattern: `Rental@${tenant.flat_code}` },
    ipAddress: req.ip,
  });

  res.redirect(`/admin/flats/${flatId}`);
});

// ---------- Payments ----------
router.get('/payments', async (req, res) => {
  const [payments] = await pool.query(
    `SELECT p.*, t.full_name, f.flat_code,
            COALESCE(SUM(pi.amount), p.amount_paid) AS total_from_items
     FROM payments p
     JOIN tenants t ON t.id = p.tenant_id
     JOIN flats f ON f.id = t.flat_id
     LEFT JOIN payment_items pi ON pi.payment_id = p.id
     GROUP BY p.id, t.full_name, f.flat_code
     ORDER BY p.created_at DESC LIMIT 200`
  );
  res.render('admin/payments', { payments, formatINR });
});

router.post('/payments/:id/confirm', async (req, res) => {
  const paymentId = req.params.id;
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const [[payment]] = await conn.query('SELECT * FROM payments WHERE id = ? FOR UPDATE', [paymentId]);
    if (!payment) {
      await conn.rollback();
      return res.status(404).send('Payment not found');
    }

    if (payment.status === 'confirmed' && payment.receipt_no) {
      await conn.rollback();
      return res.redirect('/admin/payments');
    }

    const [[tenant]] = await conn.query(
      `SELECT t.*, f.flat_code
       FROM tenants t
       JOIN flats f ON f.id = t.flat_id
       WHERE t.id = ?`,
      [payment.tenant_id]
    );

    const [items] = await conn.query(
      'SELECT purpose, custom_label, amount FROM payment_items WHERE payment_id = ? ORDER BY id ASC',
      [paymentId]
    );

    const lateFee = calculateLateFee(payment.for_month, payment.payment_date);
    const transactionHash = payment.transaction_hash || buildTransactionHash(payment);
    const existingByHash = await conn.query(
      'SELECT id, receipt_no FROM payments WHERE transaction_hash = ? AND id != ? LIMIT 1',
      [transactionHash, paymentId]
    );
    if (existingByHash[0].length) {
      await conn.rollback();
      return res.status(409).send('Duplicate payment detected. Confirmation stopped.');
    }

    const receiptNo = payment.receipt_no || `R${new Date().getFullYear()}${String(paymentId).padStart(6, '0')}`;

    await conn.query(
      `UPDATE payments
       SET status = 'confirmed', late_fee = ?, receipt_no = ?, transaction_hash = ?,
           updated_by_user_id = ?, updated_at = NOW(), confirmed_at = NOW()
       WHERE id = ?`,
      [lateFee, receiptNo, transactionHash, req.user.id, paymentId]
    );

    const itemRows = items.length ? items : [{ purpose: 'rent', custom_label: null, amount: payment.amount_paid }];
    for (const item of itemRows) {
      await conn.query(
        `INSERT INTO ledger (entry_type, category, description, amount, txn_date, tenant_id, payment_id, ref_table, ref_id, created_by)
         VALUES ('income', ?, ?, ?, ?, ?, ?, 'payments', ?, ?)`,
        [
          item.purpose || 'rent',
          `Receipt ${receiptNo}${item.custom_label ? ` - ${item.custom_label}` : ''}`,
          parseAmount(item.amount),
          payment.payment_date || new Date(),
          tenant.id,
          paymentId,
          paymentId,
          req.user.id,
        ]
      );
    }

    await writeAuditLog({
      tableName: 'payments',
      recordId: paymentId,
      action: 'update',
      changedBy: req.user.id,
      oldValues: { status: payment.status, receipt_no: payment.receipt_no || null },
      newValues: { status: 'confirmed', receipt_no: receiptNo, transaction_hash: transactionHash },
      ipAddress: req.ip,
    });

    await conn.commit();

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
      items: itemRows,
      previousBalance: 0,
      currentBalance: Math.max(0, parseAmount(payment.rent_due) + parseAmount(lateFee) - parseAmount(payment.amount_paid)),
    });

    if (tenant.email) {
      await sendReceiptEmail({
        to: tenant.email,
        tenantName: tenant.full_name,
        flatCode: tenant.flat_code,
        receiptNo,
        amount: payment.amount_paid,
        forMonth: monthLabel(payment.for_month),
        pdfBuffer,
      }).catch(() => {});
    }

    res.redirect('/admin/payments');
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).send('Could not confirm payment');
  } finally {
    conn.release();
  }
});

router.post('/payments/:id/update', async (req, res) => {
  const paymentId = req.params.id;
  const { amount_paid, payment_date, reference_no, mode, notes, status } = req.body;
  await pool.query(
    `UPDATE payments
     SET amount_paid = ?, payment_date = ?, reference_no = ?, mode = ?, notes = ?, status = ?,
         payment_source = 'admin', updated_by_user_id = ?, updated_at = NOW()
     WHERE id = ?`,
    [
      parseAmount(amount_paid),
      payment_date || null,
      normalizeOptional(reference_no),
      normalizeOptional(mode),
      normalizeOptional(notes),
      status || 'pending',
      req.user.id,
      paymentId,
    ]
  );

  await writeAuditLog({
    tableName: 'payments',
    recordId: paymentId,
    action: 'update',
    changedBy: req.user.id,
    newValues: { admin_update: true },
    ipAddress: req.ip,
  });

  res.redirect('/admin/payments');
});

router.post('/dues', async (req, res) => {
  const { tenant_id, due_type, custom_label, due_amount, due_date, for_month, notes } = req.body;
  await pool.query(
    `INSERT INTO dues
     (tenant_id, due_type, custom_label, due_amount, due_date, for_month, notes, created_by, status)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [
      tenant_id,
      due_type,
      normalizeOptional(custom_label),
      parseAmount(due_amount),
      due_date || null,
      normalizeOptional(for_month),
      normalizeOptional(notes),
      req.user.id,
      'current',
    ]
  );
  res.redirect('back');
});

router.post('/expenses', async (req, res) => {
  const { category, description, amount, expense_date, payment_mode, reference_no } = req.body;
  const [result] = await pool.query(
    `INSERT INTO office_expenses
     (category, description, amount, expense_date, payment_mode, reference_no, created_by)
     VALUES (?,?,?,?,?,?,?)`,
    [
      category || 'misc',
      normalizeOptional(description),
      parseAmount(amount),
      expense_date || new Date().toISOString().slice(0, 10),
      normalizeOptional(payment_mode),
      normalizeOptional(reference_no),
      req.user.id,
    ]
  );

  await safeQuery(
    `INSERT INTO ledger
     (entry_type, category, description, amount, txn_date, expense_id, ref_table, ref_id, created_by)
     VALUES ('expense', ?, ?, ?, ?, ?, 'office_expenses', ?, ?)`,
    [
      category || 'misc',
      normalizeOptional(description),
      parseAmount(amount),
      expense_date || new Date().toISOString().slice(0, 10),
      result.insertId,
      result.insertId,
      req.user.id,
    ],
    []
  );

  res.redirect('/admin/dashboard');
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
  await pool.query(
    'UPDATE maintenance_requests SET status = ?, resolved_at = ? WHERE id = ?',
    [status, resolvedAt, req.params.id]
  );
  res.redirect('/admin/maintenance');
});

module.exports = router;
