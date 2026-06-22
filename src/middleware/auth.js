const jwt = require('jsonwebtoken');
const env = require('../config/env');

function issueToken(payload) {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: '30d' });
}

// Reads the "token" cookie, verifies it, and attaches req.user.
// Does not block the request if missing/invalid - that's left to the
// requireAdmin / requireTenant guards below, so public pages still load.
function loadUser(req, res, next) {
  const token = req.cookies && req.cookies.token;
  if (token) {
    try {
      req.user = jwt.verify(token, env.jwtSecret);
    } catch (e) {
      req.user = null;
    }
  } else {
    req.user = null;
  }
  res.locals.user = req.user;
  next();
}

function requireAdmin(req, res, next) {
  if (req.user && req.user.role === 'admin') return next();
  return res.redirect('/login');
}

function requireTenant(req, res, next) {
  if (req.user && req.user.role === 'tenant') return next();
  return res.redirect('/login');
}

module.exports = { issueToken, loadUser, requireAdmin, requireTenant };
