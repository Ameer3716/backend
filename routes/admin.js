// routes/admin.js
const express = require('express');
const router = express.Router();
const pool = require('../db/db');

// (Assume you have an isAdmin middleware that checks the authenticated user's role)
const isAdmin = require('../middlewares/isAdmin');

router.get('/call-logs', isAdmin, async (req, res) => {
  try {
    const sql = 'SELECT * FROM call_logs ORDER BY start_time DESC';
    const [rows] = await pool.execute(sql);
    res.json(rows);
  } catch (error) {
    console.error("Error fetching admin call logs:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
