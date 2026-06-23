// Run with: npm run migrate
// Creates all tables (if they don't already exist) and seeds the first
// admin login from ADMIN_EMAIL / ADMIN_PASSWORD in .env.
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const env = require('../config/env');

async function run() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const statements = sql
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);

  console.log(`Running ${statements.length} schema statements...`);
  for (const statement of statements) {
    await pool.query(statement);
  }
  console.log('Tables ready.');

  if (!env.admin.email || !env.admin.password) {
    console.log('ADMIN_EMAIL / ADMIN_PASSWORD not set in .env - skipping admin seed.');
  } else {
    const [existing] = await pool.query(
      'SELECT id FROM users WHERE username = ? AND role = "admin"',
      [env.admin.email]
    );
    if (existing.length) {
      console.log('Admin user already exists, leaving it as is.');
    } else {
      const hash = await bcrypt.hash(env.admin.password, 10);
      await pool.query(
        'INSERT INTO users (role, username, password_hash, must_change_password) VALUES ("admin", ?, ?, 1)',
        [env.admin.email, hash]
      );
      console.log(`Admin user created: ${env.admin.email}`);
    }
  }

  console.log('Migration complete.');
  process.exit(0);
}

run().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
