// Run with: npm run migrate
// Creates all tables from schema.sql and seeds the first admin user
// from ADMIN_EMAIL / ADMIN_PASSWORD in .env.
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const env = require('../config/env');

function splitSqlStatements(sql) {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => !s.startsWith('--'));
}

async function ensureAdminUser() {
  if (!env.admin.email || !env.admin.password) {
    console.log('ADMIN_EMAIL / ADMIN_PASSWORD not set in .env - skipping admin seed.');
    return;
  }

  const [existing] = await pool.query(
    'SELECT id FROM users WHERE username = ? AND role = "admin" LIMIT 1',
    [env.admin.email]
  );

  if (existing.length) {
    console.log('Admin user already exists, leaving it as is.');
    return;
  }

  const hash = await bcrypt.hash(env.admin.password, 10);
  await pool.query(
    'INSERT INTO users (role, username, password_hash, must_change_password) VALUES ("admin", ?, ?, 1)',
    [env.admin.email, hash]
  );
  console.log(`Admin user created: ${env.admin.email}`);
}

async function run() {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  const statements = splitSqlStatements(sql);

  console.log(`Running ${statements.length} schema statements...`);
  for (const statement of statements) {
    await pool.query(statement);
  }

  console.log('Tables ready.');
  await ensureAdminUser();
  console.log('Migration complete.');
  process.exit(0);
}

run().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});