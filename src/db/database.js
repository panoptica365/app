/**
 * Panoptica — MySQL Database Module
 * Connection pool + query helpers.
 *
 * Reliability P0 (2026-06-12):
 *   - Finite queue (config.db.queueLimit, env DB_QUEUE_LIMIT, default 200) —
 *     under a DB stall, excess getConnection calls fail fast ("Queue limit
 *     reached.") instead of queueing unboundedly.
 *   - Acquire deadline: mysql2@3.x has NO pool acquire-timeout option
 *     (verified in node_modules/mysql2/lib/base/pool.js — a queued waiter
 *     waits until a connection frees or the pool closes; the only bound is
 *     queueLimit). The deadline is therefore enforced HERE, app-level, with
 *     a leak-free race: if the timer wins, the late-arriving connection is
 *     released straight back to the pool, never stranded.
 *   - Slow-query log: queries over DB_SLOW_QUERY_MS (default 2000) log the
 *     first 120 chars of SQL + duration. Parameter values are NEVER logged —
 *     they can carry UPNs and tenant data.
 */

const mysql = require('mysql2/promise');
const config = require('../../config/default');

let pool = null;

const ACQUIRE_TIMEOUT_MS = parseInt(process.env.DB_ACQUIRE_TIMEOUT_MS, 10) || 15000;
const SLOW_QUERY_MS = parseInt(process.env.DB_SLOW_QUERY_MS, 10) || 2000;

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
 * pool.getConnection with an app-level acquire deadline (see header — mysql2
 * has no native option for this). Leak-free: when the deadline wins the race,
 * the eventually-acquired connection is immediately released back to the
 * pool rather than stranded on an abandoned promise.
 */
function getConnectionWithTimeout() {
  const p = getPool();
  return new Promise((resolve, reject) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      reject(new Error(`DB connection acquire timed out after ${ACQUIRE_TIMEOUT_MS}ms (pool exhausted or MySQL stalled)`));
    }, ACQUIRE_TIMEOUT_MS);
    if (timer.unref) timer.unref();
    p.getConnection().then(
      (conn) => {
        if (timedOut) { try { conn.release(); } catch (_) { /* ignore */ } return; }
        clearTimeout(timer);
        resolve(conn);
      },
      (err) => {
        if (timedOut) return;
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

/**
 * Execute a query and return [rows, fields].
 *
 * Goes through getConnectionWithTimeout (bounded acquire) + a duration timer
 * (slow-query log). conn.execute is the same prepared-statement path
 * pool.execute used — statements stay cached per connection.
 */
async function query(sql, params = []) {
  const conn = await getConnectionWithTimeout();
  const t0 = Date.now();
  try {
    return await conn.execute(sql, params);
  } finally {
    conn.release();
    const ms = Date.now() - t0;
    if (ms >= SLOW_QUERY_MS) {
      const preview = String(sql).replace(/\s+/g, ' ').trim().slice(0, 120);
      console.warn(`[DB] Slow query (${ms}ms): ${preview}`);
    }
  }
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
 * Run `fn` inside a single transaction on a dedicated pooled connection.
 *
 * `fn` receives the raw mysql2 connection — use `conn.execute(sql, params)`
 * which returns `[result]` (result.insertId for inserts, result.affectedRows
 * for updates). Commits if `fn` resolves; rolls back and re-throws if it
 * rejects. The connection is always released. Use for multi-statement
 * operations that must be atomic (e.g. the alert roll-up: insert parent +
 * resolve children must both land or neither). Added 2026-06-05 for the
 * Alert Merge feature — the codebase previously had no transaction helper
 * because every prior mutation was a single statement.
 */
async function withTransaction(fn) {
  const conn = await getConnectionWithTimeout();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    try { await conn.rollback(); } catch (_) { /* rollback best-effort */ }
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Health check — ping the database.
 */
async function ping() {
  const conn = await getConnectionWithTimeout();
  try {
    await conn.ping();
  } finally {
    conn.release();
  }
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
  withTransaction,
  ping,
  close,
};
