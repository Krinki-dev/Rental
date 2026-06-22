const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const pool = require('../config/db');
const env = require('../config/env');
const { requireTenant } = require('../middleware/auth');
const { currentMonthKey, monthLabel, formatINR } = require('../utils/money');

router.use(requireTenant);

function parseAmount(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function normalizeOptional(value) {
  if (value === undefined || value === null) return null;
  const v = String(value).trim();
  return v ? v : null;
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

function buildIdempotencyKey(tenantId, forMonth, paymentDate, amount, referenceNo) {
  return crypto
    .createHash('sha256')
    .update([tenantId, forMonth, paymentDate || '', amount || 0, referenceNo || ''].join('|'))
    .digest('hex');
}

async function safeQuery(sql, params = [], fallback = []) {
  try {
    const [rows] = await pool.query(sql, params);
    return rows;
  } catch (_) {
    return fallback;
  }
}

async function getTenantByUserId(userId) {
  const [[tenant]] = await pool.query(
    `SELECT t.*, f.flat_code, f.tower, f.floor, f.unit, f.rent_amount, f.society_name
     FROM tenants t
     JOIN flats f ON f.id = t.flat_id
     WHERE t.user_id = ? AND t.is_active = 1 LIMIT 1`,
    [userId]
  );
  return tenant;
}

function ensureTenantCanLogin(tenant, res) {
  const allowedStates = ['move_in_confirmed', 'active'];
  if (!tenant) {
    res.status(404).send('No active tenancy found for this account.');
    return false;
  }
  if (tenant.lifecycle_status && !allowedStates.includes(tenant.lifecycle_status)) {
    res.status(403).send('Your tenancy login will be active after move-in confirmation.');
    return false;
  }
  return true;
}

router.get('/dashboard', async (req, res) => {
  const tenant = await getTenantByUserId(req.user.id);
  if (!ensureTenantCanLogin(tenant, res)) return;

  const month = currentMonthKey();
  const [[thisMonthPayment]] = await pool.query(
    'SELECT * FROM payments WHERE tenant_id = ? AND for_month = ? ORDER BY created_at DESC LIMIT 1',
    [tenant.id, month]
  );

  const dues = await safeQuery(
    `SELECT * FROM dues WHERE tenant_id = ? ORDER BY
      FIELD(status, 'overdue', 'current', 'upcoming', 'paid'),
      due_date IS NULL, due_date ASC, created_at DESC`,
    [tenant.id],
    []
  );

  const electricityRows = await safeQuery(
    `SELECT * FROM electricity_readings WHERE tenant_id = ? ORDER BY for_month DESC LIMIT 6`,
    [tenant.id],
    []
  );

  const waterRows = await safeQuery(
    `SELECT * FROM water_bills WHERE tenant_id = ? ORDER BY for_month DESC LIMIT 6`,
    [tenant.id],
    []
  );

  const securitySummary = await safeQuery(
    `SELECT
      COALESCE(SUM(CASE WHEN txn_type IN ('collected','adjusted') THEN amount ELSE 0 END),0)
      - COALESCE(SUM(CASE WHEN txn_type IN ('used','refunded') THEN amount ELSE 0 END),0) AS balance,
      COALESCE(SUM(CASE WHEN txn_type='collected' THEN amount ELSE 0 END),0) AS collected,
      COALESCE(SUM(CASE WHEN txn_type='refunded' THEN amount ELSE 0 END),0) AS refunded,
      COALESCE(SUM(CASE WHEN txn_type='used' THEN amount ELSE 0 END),0) AS used_amount
     FROM security_deposit_ledger WHERE tenant_id = ?`,
    [tenant.id],
    [{ balance: 0, collected: 0, refunded: 0, used_amount: 0 }]
  );

  res.render('tenant/dashboard', {
    tenant,
    thisMonthPayment,
    dues,
    electricityRows,
    waterRows,
    securitySummary: securitySummary[0] || { balance: 0, collected: 0, refunded: 0, used_amount: 0 },
    monthLabel: monthLabel(month),
    formatINR,
    company: env.company,
  });
});

router.get('/payments', async (req, res) => {
  const tenant = await getTenantByUserId(req.user.id);
  if (!ensureTenantCanLogin(tenant, res)) return;

  const [payments] = await pool.query(
    'SELECT * FROM payments WHERE tenant_id = ? ORDER BY created_at DESC, for_month DESC',
    [tenant.id]
  );
  const month = currentMonthKey();
  const [[thisMonthPayment]] = await pool.query(
    'SELECT * FROM payments WHERE tenant_id = ? AND for_month = ? ORDER BY created_at DESC LIMIT 1',
    [tenant.id, month]
  );

  const dues = await safeQuery(
    `SELECT * FROM dues WHERE tenant_id = ? ORDER BY
      FIELD(status, 'overdue', 'current', 'upcoming', 'paid'),
      due_date IS NULL, due_date ASC, created_at DESC`,
    [tenant.id],
    []
  );

  const paymentItemsMap = {};
  if (payments.length) {
    const [items] = await pool.query(
      `SELECT pi.* FROM payment_items pi
       WHERE pi.payment_id IN (${payments.map(() => '?').join(',')})
       ORDER BY pi.id ASC`,
      payments.map((p) => p.id)
    );
    for (const item of items) {
      if (!paymentItemsMap[item.payment_id]) paymentItemsMap[item.payment_id] = [];
      paymentItemsMap[item.payment_id].push(item);
    }
  }

  res.render('tenant/payments', {
    tenant,
    payments,
    paymentItemsMap,
    dues,
    thisMonthPayment,
    monthLabel: monthLabel(month),
    currentMonth: month,
    formatINR,
    payment: env.payment,
  });
});

router.post('/payments', async (req, res) => {
  const tenant = await getTenantByUserId(req.user.id);
  if (!ensureTenantCanLogin(tenant, res)) return;

  const { for_month, amount_paid, payment_date, mode, reference_no, notes } = req.body;
  const purposes = toArray(req.body.item_purpose);
  const labels = toArray(req.body.item_label);
  const amounts = toArray(req.body.item_amount);

  const totalAmount = parseAmount(amount_paid);
  if (!for_month || !payment_date || !mode || totalAmount <= 0) {
    return res.status(400).send('Month, payment date, mode, and paid amount are required.');
  }

  const idempotencyKey = buildIdempotencyKey(tenant.id, for_month, payment_date, totalAmount, normalizeOptional(reference_no));
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const [[existingKey]] = await conn.query(
      'SELECT id FROM payments WHERE idempotency_key = ? LIMIT 1',
      [idempotencyKey]
    );
    if (existingKey) {
      await conn.rollback();
      return res.redirect('/tenant/payments');
    }

    const [[existing]] = await conn.query(
      'SELECT * FROM payments WHERE tenant_id = ? AND for_month = ? AND status = "pending" ORDER BY id DESC LIMIT 1 FOR UPDATE',
      [tenant.id, for_month]
    );

    let paymentId;
    if (existing) {
      await conn.query(
        `UPDATE payments
         SET rent_due = ?, amount_paid = ?, payment_date = ?, mode = ?, reference_no = ?, notes = ?,
             status = 'pending', payment_source = 'tenant', created_by_user_id = ?, updated_by_user_id = ?,
             updated_at = NOW(), idempotency_key = ?
         WHERE id = ?`,
        [
          tenant.rent_amount,
          totalAmount,
          payment_date,
          mode,
          normalizeOptional(reference_no),
          normalizeOptional(notes),
          req.user.id,
          req.user.id,
          idempotencyKey,
          existing.id,
        ]
      );
      await conn.query('DELETE FROM payment_items WHERE payment_id = ?', [existing.id]);
      paymentId = existing.id;
    } else {
      const [result] = await conn.query(
        `INSERT INTO payments
         (tenant_id, idempotency_key, for_month, rent_due, amount_paid, payment_date, mode, reference_no, notes, status, payment_source, created_by_user_id, updated_by_user_id)
         VALUES (?,?,?,?,?,?,?,?,?,'pending','tenant',?,?,?)`,
        [
          tenant.id,
          idempotencyKey,
          for_month,
          tenant.rent_amount,
          totalAmount,
          payment_date,
          mode,
          normalizeOptional(reference_no),
          normalizeOptional(notes),
          req.user.id,
          req.user.id,
          req.user.id,
        ]
      );
      paymentId = result.insertId;
    }

    let insertedItemTotal = 0;
    for (let i = 0; i < Math.max(purposes.length, amounts.length); i += 1) {
      const purpose = normalizeOptional(purposes[i]) || 'rent';
      const label = normalizeOptional(labels[i]);
      const amount = parseAmount(amounts[i]);
      if (amount <= 0) continue;
      insertedItemTotal += amount;
      await conn.query(
        `INSERT INTO payment_items (payment_id, purpose, custom_label, amount)
         VALUES (?,?,?,?)`,
        [paymentId, purpose, label, amount]
      );
    }

    if (insertedItemTotal <= 0) {
      await conn.query(
        `INSERT INTO payment_items (payment_id, purpose, custom_label, amount)
         VALUES (?, 'rent', NULL, ?)`,
        [paymentId, totalAmount]
      );
    }

    await conn.commit();
    res.redirect('/tenant/payments');
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).send('Could not submit payment details.');
  } finally {
    conn.release();
  }
});

router.get('/maintenance', async (req, res) => {
  const tenant = await getTenantByUserId(req.user.id);
  if (!ensureTenantCanLogin(tenant, res)) return;

  const [requests] = await pool.query(
    'SELECT * FROM maintenance_requests WHERE tenant_id = ? ORDER BY created_at DESC',
    [tenant.id]
  );
  res.render('tenant/maintenance', { tenant, requests });
});

router.post('/maintenance', async (req, res) => {
  const tenant = await getTenantByUserId(req.user.id);
  if (!ensureTenantCanLogin(tenant, res)) return;

  const { issue_type, description, priority } = req.body;
  await pool.query(
    'INSERT INTO maintenance_requests (tenant_id, issue_type, description, priority) VALUES (?,?,?,?)',
    [tenant.id, issue_type, description, priority || 'medium']
  );
  res.redirect('/tenant/maintenance');
});

router.get('/agreement', async (req, res) => {
  const tenant = await getTenantByUserId(req.user.id);
  if (!ensureTenantCanLogin(tenant, res)) return;
  res.render('tenant/agreement-print', {
    tenant,
    company: env.company,
    formatINR,
    watermarkText: 'DRAFT ONLY',
    showWatermark: true,
    isAdminPrint: false,
  });
});

router.get('/agreement-print/:tenantId', async (req, res) => {
  const tenantId = req.params.tenantId;
  const [[tenant]] = await pool.query(
    `SELECT t.*, f.flat_code, f.tower, f.floor, f.unit, f.rent_amount, f.society_name
     FROM tenants t
     JOIN flats f ON f.id = t.flat_id
     WHERE t.id = ? LIMIT 1`,
    [tenantId]
  );
  if (!tenant) return res.status(404).send('Tenant not found');

  res.render('tenant/agreement-print', {
    tenant,
    company: env.company,
    formatINR,
    watermarkText: req.query.adminPrint === '1' ? '' : 'DRAFT ONLY',
    showWatermark: req.query.adminPrint !== '1',
    isAdminPrint: req.query.adminPrint === '1',
  });
});

module.exports = router;
