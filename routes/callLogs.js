// routes/callLogs.js
const express = require('express');
const router = express.Router();
const { getCallLogs } = require('../db/callLogs');
const isAuthenticated = require('../middlewares/isAuthenticated');

router.get('/', isAuthenticated, async (req, res) => {
  try {
    let logs;
    // If the authenticated user is an admin, return all logs; otherwise, filter by user's email
    if (req.user && req.user.role && req.user.role.toLowerCase() === 'admin') {
      logs = await getCallLogs(); // No parameter returns all logs
    } else {
      logs = await getCallLogs(req.user.email);
    }
    res.json(logs);
  } catch (error) {
    console.error("Error fetching call logs:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
