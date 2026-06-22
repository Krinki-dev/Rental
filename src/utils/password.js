const bcrypt = require('bcryptjs');

// Generates an easy-to-type random password for new tenant accounts,
// e.g. "Rk4-Wp92". Avoids confusing characters like 0/O, 1/l/I.
function generateTempPassword() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 8; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out.slice(0, 4) + '-' + out.slice(4);
}

function hashPassword(plain) {
  return bcrypt.hash(plain, 10);
}

function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

module.exports = { generateTempPassword, hashPassword, verifyPassword };
