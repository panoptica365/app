/**
 * Panoptica — Database Schema Initializer
 * Run: npm run db:init
 * Creates tables and seeds alert policies if empty.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

async function initSchema() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT, 10) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    multipleStatements: true,
  });

  console.log('[DB] Connected to MySQL');

  // Run schema
  const schemaSQL = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await connection.query(schemaSQL);
  console.log('[DB] Schema applied');

  // Check if policies already seeded
  const [rows] = await connection.query('SELECT COUNT(*) AS cnt FROM panoptica.alert_policies');
  if (rows[0].cnt === 0) {
    const seedSQL = fs.readFileSync(path.join(__dirname, 'seed-policies.sql'), 'utf8');
    await connection.query(seedSQL);
    console.log('[DB] Seeded 20 alert policies');
  } else {
    console.log(`[DB] Alert policies already exist (${rows[0].cnt} rows) — skipping seed`);
  }

  await connection.end();
  console.log('[DB] Done');
}

initSchema().catch(err => {
  console.error('[DB] Init failed:', err.message);
  process.exit(1);
});
