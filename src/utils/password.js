const bcrypt = require('bcryptjs');

// Generates first password in format: FirstName@FlatNo
// e.g. "Krishan@0309"
function generateTempPassword(firstName, flatCode) {
  const name = String(firstName || '').trim().replace(/[^a-zA-Z]/g, '');
  const flat = String(flatCode || '').trim();
  if (!name || !flat) {
    // Fallback to random password if inputs missing
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let out = '';
    for (let i = 0; i < 8; i++) {
      out += chars[Math.floor(Math.random() * chars.length)];
    }
    return out.slice(0, 4) + '-' + out.slice(4);
  }
  return `${name}@${flat}`;
}

function hashPassword(plain) {
  return bcrypt.hash(plain, 10);
}

function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

module.exports = { generateTempPassword, hashPassword, verifyPassword };
