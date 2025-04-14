// db/subscriptions.js
const pool = require('./db');

async function saveSubscriptionToDb(subscriptionData) {
  const { email, subscriptionId, plan, status, price, stripeEventId, expiryDate } = subscriptionData;
  
  // Check if the event has already been processed
  const selectSql = 'SELECT * FROM subscriptions WHERE stripe_event_id = ?';
  const [existingEvents] = await pool.execute(selectSql, [stripeEventId]);
  
  if (existingEvents.length > 0) {
    console.log(`Event ${stripeEventId} already processed. Skipping insert/update.`);
    return;
  }
  
  // Check if the user already has a subscription (by email)
  const selectByEmailSql = 'SELECT * FROM subscriptions WHERE email = ?';
  const [rows] = await pool.execute(selectByEmailSql, [email]);

  if (rows.length > 0) {
    // Update the existing subscription record (including expiry_date)
    const updateSql = `
      UPDATE subscriptions
      SET subscription_id = ?, plan = ?, status = ?, price = ?, expiry_date = ?, stripe_event_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE email = ?
    `;
    await pool.execute(updateSql, [subscriptionId, plan, status, price, expiryDate || null, stripeEventId, email]);
    console.log('Subscription updated in DB');
  } else {
    // Insert new subscription including the expiry_date
    const insertSql = `
      INSERT INTO subscriptions (email, subscription_id, plan, status, price, expiry_date, stripe_event_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
    await pool.execute(insertSql, [email, subscriptionId, plan, status, price, expiryDate || null, stripeEventId]);
    console.log('Subscription saved to DB');
  }
}

module.exports = { saveSubscriptionToDb };
