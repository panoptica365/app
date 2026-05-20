/**
 * Panoptica — MySQL Database Module
 * Connection pool + query helpers.
 */

const mysql = require('mysql2/promise');
const config = require('../../config/default');

let pool = null;

/**
 * Get or create the connection pool.
 */
function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: config.db.host,
      port: config.db.port,
      database: config.db.database,
      user: config.db.user,
      password: config.db.password,
      connectionLimit: config.db.connectionLimit,
      waitForConnections: config.db.waitForConnections,
      queueLimit: config.db.queueLimit,
      // Return dates as strings, not JS Date objects (avoids timezone issues)
      dateStrings: true,
    });
  }
  return pool;
}

/**
 * Execute a query and return [rows, fields].
 */
async function query(sql, params = []) {
  const p = getPool();
  return p.execute(sql, params);
}

/**
 * Execute a query and return just the rows.
 */
async function queryRows(sql, params = []) {
  const [rows] = await query(sql, params);
  return rows;
}

/**
 * Get a single row or null.
 */
async function queryOne(sql, params = []) {
  const rows = await queryRows(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Insert and return the insertId.
 */
async function insert(sql, params = []) {
  const [result] = await query(sql, params);
  return result.insertId;
}

/**
 * Update/delete and return affectedRows.
 */
async function execute(sql, params = []) {
  const [result] = await query(sql, params);
  return result.affectedRows;
}

/**
 * Execute with retry on InnoDB deadlock (MySQL error 1213 / ER_LOCK_DEADLOCK).
 * Use this for boot-time schema migrations that may race against each other
 * (e.g. two modules concurrently ALTERing the same table — see the
 * tenants.mode + ensureTenantCutoverColumns race in api-tenants.js + ual-events.js).
 *
 * On deadlock, MySQL rolls back the losing transaction; we just retry after
 * a short exponential backoff. Up to 5 attempts (100ms, 200ms, 400ms, 800ms).
 *
 * Added May 20, 2026 in response to the Stage 3 GHCR pull smoke test, where
 * concurrent ALTER TABLE statements on `tenants` deadlocked at first-boot
 * on a fresh database.
 */
async function executeWithDeadlockRetry(sql, params = [], maxAttempts = 5) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await execute(sql, params);
    } catch (err) {
      // 1213 = ER_LOCK_DEADLOCK. mysql2 sets both .errno and .code; check both
      // defensively in case future mysql2 versions surface only one.
      const isDeadlock = err.errno === 1213 || err.code === 'ER_LOCK_DEADLOCK';
      if (isDeadlock && attempt < maxAttempts) {
        const backoffMs = 100 * Math.pow(2, attempt - 1);
        await new Promise(resolve => setTimeout(resolve, backoffMs));
        continue;
      }
      throw err;
    }
  }
}

/**
 * Health check — ping the database.
 */
async function ping() {
  const p = getPool();
  const conn = await p.getConnection();
  await conn.ping();
  conn.release();
  return true;
}

/**
 * Graceful shutdown.
 */
async function close() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = {
  getPool,
  query,
  queryRows,
  queryOne,
  insert,
  execute,
  executeWithDeadlockRetry,
  ping,
  close,
};
