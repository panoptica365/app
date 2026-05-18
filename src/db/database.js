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
  ping,
  close,
};
