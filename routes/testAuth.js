const express = require('express');
const router = express.Router();

router.get('/login-as-admin', (req, res) => {
  // Simulate logging in by setting req.user manually
  req.session.passport = { user: { id: 999, email: 'adminuser@example.com', name: 'Admin User', role: 'admin' } };
  res.json({ message: 'Logged in as admin (simulated)' });
});

module.exports = router;