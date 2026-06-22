const mysql = require('mysql2/promise');
const env = require('./env');

// DATABASE_URL looks like: mysql://user:password@host:port/dbname
// Railway gives you this exact string in your database service's "Connect" tab.
const separator = env.databaseUrl.includes('?') ? '&' : '?';
const pool = mysql.createPool(env.databaseUrl + separator + 'dateStrings=true', {
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

module.exports = pool;
