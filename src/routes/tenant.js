const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const env = require('../config/env');
const { requireTenant } = require('../middleware/auth');
const { calculateLateFee, currentMonthKey, monthLabel, formatINR } = require('../utils/money');

router.use(requireTenant);

async function getTenantByUserId(userId) {
  const [[tenant]] = await pool.query(
    `SELECT t.*, f.flat_code, f.tower, f.floor, f.unit, f.rent_amount, f.society_name
     FROM tenants t JOIN flats f ON f.id = t.flat_id
     WHERE t.user_id = ? AND t.is_active = 1 LIMIT 1`,
    [userId]
  );
  return tenant;
}

router.get('/dashboard', async (req, res) => {
  const tenant = await getTenantByUserId(req.user.id);
  if (!tenant) return res.status(404).send('No active tenancy found for this account.');

  const month = currentMonthKey();
  const [[thisMonthPayment]] = await pool.query(
    'SELECT * FROM payments WHERE tenant_id = ? AND for_month = ?',
    [tenant.id, month]
  );

  res.render('tenant/dashboard', {
    tenant,
    thisMonthPayment,
    monthLabel: monthLabel(month),
    formatINR,
    company: env.company,
  });
});

router.get('/payments', async (req, res) => {
  const tenant = await getTenantByUserId(req.user.id);
  if (!tenant) return res.status(404).send('No active tenancy found for this account.');

  const [payments] = await pool.query(
    'SELECT * FROM payments WHERE tenant_id = ? ORDER BY for_month DESC',
    [tenant.id]
  );
  const month = currentMonthKey();
  const [[thisMonthPayment]] = await pool.query(
    'SELECT * FROM payments WHERE tenant_id = ? AND for_month = ?',
    [tenant.id, month]
  );

  res.render('tenant/payments', {
    tenant,
    payments,
    thisMonthPayment,
    monthLabel: monthLabel(month),
    currentMonth: month,
    formatINR,
    payment: env.payment,
  });
});

router.post('/payments', async (req, res) => {
  const tenant = await getTenantByUserId(req.user.id);
  if (!tenant) return res.status(404).send('No active tenancy found for this account.');

  const { for_month, amount_paid, payment_date, mode, reference_no } = req.body;

  const [[existing]] = await pool.query(
    'SELECT * FROM payments WHERE tenant_id = ? AND for_month = ?',
    [tenant.id, for_month]
  );

  if (existing) {
    await pool.query(
      `UPDATE payments SET amount_paid = ?, payment_date = ?, mode = ?, reference_no = ?, status = 'pending'
       WHERE id = ?`,
      [amount_paid, payment_date, mode, reference_no, existing.id]
    );
  } else {
    await pool.query(
      `INSERT INTO payments (tenant_id, for_month, rent_due, amount_paid, payment_date, mode, reference_no, status)
       VALUES (?,?,?,?,?,?,?,'pending')`,
      [tenant.id, for_month, tenant.rent_amount, amount_paid, payment_date, mode, reference_no]
    );
  }

  res.redirect('/tenant/payments');
});

router.get('/maintenance', async (req, res) => {
  const tenant = await getTenantByUserId(req.user.id);
  if (!tenant) return res.status(404).send('No active tenancy found for this account.');

  const [requests] = await pool.query(
    'SELECT * FROM maintenance_requests WHERE tenant_id = ? ORDER BY created_at DESC',
    [tenant.id]
  );
  res.render('tenant/maintenance', { tenant, requests });
});

router.post('/maintenance', async (req, res) => {
  const tenant = await getTenantByUserId(req.user.id);
  if (!tenant) return res.status(404).send('No active tenancy found for this account.');

  const { issue_type, description, priority } = req.body;
  await pool.query(
    'INSERT INTO maintenance_requests (tenant_id, issue_type, description, priority) VALUES (?,?,?,?)',
    [tenant.id, issue_type, description, priority || 'medium']
  );
  res.redirect('/tenant/maintenance');
});

router.get('/agreement', async (req, res) => {
  const tenant = await getTenantByUserId(req.user.id);
  if (!tenant) return res.status(404).send('No active tenancy found for this account.');
  res.render('tenant/agreement-print', { tenant, company: env.company, formatINR });
});

router.get('/request-vacate', async (req, res) => {
  const tenant = await getTenantByUserId(req.user.id);
  if (!tenant) return res.status(404).send('No active tenancy found for this account.');
  res.render('tenant/request-vacate', { tenant, error: null });
});

router.post('/request-vacate', async (req, res) => {
  const tenant = await getTenantByUserId(req.user.id);
  if (!tenant) return res.status(404).send('No active tenancy found for this account.');

  const { requested_vacate_date, reason } = req.body;
  
  if (!requested_vacate_date) {
    return res.status(400).send('Vacate date is required.');
  }

  const vacateDate = new Date(requested_vacate_date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Must give at least 1 month notice
  const oneMonthLater = new Date(today);
  oneMonthLater.setMonth(oneMonthLater.getMonth() + 1);

  if (vacateDate < oneMonthLater) {
    return res.status(400).send('Vacate date must be at least 1 month from today.');
  }

  // Check if vacate date is within agreement period
  if (tenant.agreement_end && vacateDate > new Date(tenant.agreement_end)) {
    return res.status(400).send('Vacate date cannot exceed agreement end date.');
  }

  // Update tenant with vacate request
  await pool.query(
    `UPDATE tenants 
     SET vacate_requested_date = ?, vacate_reason = ?, vacate_status = 'requested'
     WHERE id = ?`,
    [requested_vacate_date, reason || null, tenant.id]
  );

  res.redirect('/tenant/dashboard');
});

module.exports = router;
