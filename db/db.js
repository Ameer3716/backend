// db/db.js
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: 'localhost',
  user: 'admin',
  password: '3GQ-e-QF6s2JsZR',
  database: 'chatbot',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

async function testConnection() {
  try {
    const connection = await pool.getConnection();
    console.log('Connected to MySQL successfully!');
    const [rows] = await connection.query('SELECT 1 + 1 AS result');
    console.log('Query result:', rows);
    connection.release();
  } catch (error) {
    console.error('Error connecting to MySQL:', error);
  }
}

testConnection();

module.exports = pool;
