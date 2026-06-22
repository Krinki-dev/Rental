const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { verifyPassword, hashPassword } = require('../utils/password');
const { issueToken } = require('../middleware/auth');
const env = require('../config/env');

async function getTenantLifecycleByUserId(userId) {
  const [rows] = await pool.query(
    `SELECT id, lifecycle_status, is_active
     FROM tenants
     WHERE user_id = ?
     ORDER BY id DESC
     LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

router.get('/', (req, res) => {
  if (req.user && req.user.role === 'admin') return res.redirect('/admin/dashboard');
  if (req.user && req.user.role === 'tenant') return res.redirect('/tenant/dashboard');
  return res.redirect('/login');
});

router.get('/login', (req, res) => {
  res.render('login', { error: null, company: env.company });
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    const [rows] = await pool.query(
      'SELECT * FROM users WHERE username = ? LIMIT 1',
      [(username || '').trim()]
    );

    const user = rows[0];
    if (!user) {
      return res.render('login', {
        error: 'No account found for that login.',
        company: env.company,
      });
    }

    const ok = await verifyPassword(password || '', user.password_hash);
    if (!ok) {
      return res.render('login', {
        error: 'Incorrect password.',
        company: env.company,
      });
    }

    if (user.role === 'tenant') {
      const tenancy = await getTenantLifecycleByUserId(user.id);
      if (!tenancy || !tenancy.is_active) {
        return res.render('login', {
          error: 'No active tenancy is linked to this account.',
          company: env.company,
        });
      }

      const allowedStates = ['move_in_confirmed', 'active'];
      if (tenancy.lifecycle_status && !allowedStates.includes(tenancy.lifecycle_status)) {
        return res.render('login', {
          error: 'Login will be active after move-in confirmation by admin.',
          company: env.company,
        });
      }
    }

    const token = issueToken({
      id: user.id,
      role: user.role,
      username: user.username,
    });

    res.cookie('token', token, {
      httpOnly: true,
      maxAge: 30 * 24 * 60 * 60 * 1000,
      sameSite: 'lax',
      secure: env.nodeEnv === 'production',
    });

    if (user.must_change_password) {
      return res.redirect('/change-password');
    }

    return res.redirect(user.role === 'admin' ? '/admin/dashboard' : '/tenant/dashboard');
  } catch (err) {
    console.error(err);
    return res.render('login', {
      error: 'Something went wrong. Please try again.',
      company: env.company,
    });
  }
});

router.get('/change-password', (req, res) => {
  if (!req.user) return res.redirect('/login');
  return res.render('change-password', { error: null, company: env.company });
});

router.post('/change-password', async (req, res) => {
  if (!req.user) return res.redirect('/login');

  const { new_password, confirm_password } = req.body;

  if (!new_password || new_password.length < 6) {
    return res.render('change-password', {
      error: 'Password must be at least 6 characters.',
      company: env.company,
    });
  }

  if (new_password !== confirm_password) {
    return res.render('change-password', {
      error: 'Passwords do not match.',
      company: env.company,
    });
  }

  try {
    const hash = await hashPassword(new_password);
    await pool.query(
      'UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?',
      [hash, req.user.id]
    );

    return res.redirect(req.user.role === 'admin' ? '/admin/dashboard' : '/tenant/dashboard');
  } catch (err) {
    console.error(err);
    return res.render('change-password', {
      error: 'Could not update password. Please try again.',
      company: env.company,
    });
  }
});

router.get('/logout', (req, res) => {
  res.clearCookie('token');
  return res.redirect('/login');
});

module.exports = router;