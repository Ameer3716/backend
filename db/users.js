// db/users.js
const pool = require('./db'); // Ensure your db.js exports your MySQL connection pool

async function findUserByGoogleId(googleId) {
  const sql = 'SELECT * FROM users WHERE google_id = ?';
  const [rows] = await pool.execute(sql, [googleId]);
  return rows[0];
}

async function createUser(userData) {
  const { googleId, email, name } = userData;
  const sql = 'INSERT INTO users (google_id, email, name) VALUES (?, ?, ?)';
  const [result] = await pool.execute(sql, [googleId, email, name]);
  return { id: result.insertId, googleId, email, name };
}

async function findUserById(id) {
  const sql = 'SELECT * FROM users WHERE id = ?';
  const [rows] = await pool.execute(sql, [id]);
  return rows[0];
}

module.exports = { findUserByGoogleId, createUser, findUserById };
