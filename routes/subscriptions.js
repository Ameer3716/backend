// routes/subscriptions.js
const express = require('express');
const router = express.Router();
const pool = require('../db/db'); // Using the pool from db.js

router.post('/add-subscription', async (req, res) => {
  const { email, subscriptionId, plan, status, price } = req.body;
  
  try {
    const connection = await pool.getConnection();
    const sql = `
      INSERT INTO subscriptions (email, subscription_id, plan, status, price)
      VALUES (?, ?, ?, ?, ?)
    `;
    await connection.execute(sql, [email, subscriptionId, plan, status, price]);
    connection.release();
    res.status(200).json({ message: 'Subscription added successfully' });
  } catch (error) {
    console.error('Error adding subscription:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// New GET endpoint to fetch current user's subscription
router.get('/me', async (req, res) => {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return res.status(401).json({ error: 'Unauthorized. Please log in.' });
  }
  const email = req.user.email;
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM subscriptions WHERE email = ? AND status = "active" LIMIT 1',
      [email]
    );
    if (rows.length > 0) {
      // Attach the user's name from the session to the subscription record
      const subscription = rows[0];
      subscription.name = req.user.name;
      res.json(subscription);
    } else {
      res.status(404).json({ error: 'No active subscription found for this user' });
    }
  } catch (error) {
    console.error('Error fetching subscription:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
