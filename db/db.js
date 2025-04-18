// db/db.js
const mysql = require('mysql2/promise');
require('dotenv').config(); // Ensure env vars are loaded if run standalone

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost', // Default to localhost if not set
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306, // Add port, default 3306
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});


module.exports = pool;