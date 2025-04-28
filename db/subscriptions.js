// db/subscriptions.js
const pool = require('./db');
const ghl = require('../utils/gohighlevel'); // <-- Import GHL helper
require('dotenv').config(); // Load .env variables for GHL_API_KEY check

/**
 * Saves or updates subscription details in the local database and syncs status to GoHighLevel.
 * @param {object} subscriptionData - Object containing subscription details.
 */
async function saveSubscriptionToDb(subscriptionData) {
  const { email, subscriptionId, plan, status, price, stripeEventId, expiryDate } = subscriptionData;

  // --- Prevent duplicate processing based on Stripe Event ID ---
  if (stripeEventId) { // Only check if stripeEventId is provided
    const selectEventSql = 'SELECT id FROM subscriptions WHERE stripe_event_id = ? LIMIT 1';
    const [existingEvents] = await pool.execute(selectEventSql, [stripeEventId]);
    if (existingEvents.length > 0) {
      console.log(`Event ${stripeEventId} already processed. Skipping DB insert/update and GHL sync.`);
      return; // Exit function early
    }
  } else {
      console.warn(`Subscription data for ${email} received without a stripeEventId. Duplicate processing possible.`);
  }

  // --- Save/Update Subscription in Local DB ---
  let dbSuccess = false;
  let operationType = ''; // To track if it was insert or update
  try {
    const selectByEmailSql = 'SELECT id FROM subscriptions WHERE email = ? LIMIT 1'; // Select only ID for existence check
    const [rows] = await pool.execute(selectByEmailSql, [email]);

    if (rows.length > 0) {
      // Update existing subscription
      operationType = 'update';
      const updateSql = `
        UPDATE subscriptions
        SET subscription_id = ?, plan = ?, status = ?, price = ?, expiry_date = ?, stripe_event_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE email = ?
      `;
      await pool.execute(updateSql, [subscriptionId, plan, status, price, expiryDate || null, stripeEventId, email]);
      console.log(`Subscription updated in DB for ${email}`);
    } else {
      // Insert new subscription
      operationType = 'insert';
      const insertSql = `
        INSERT INTO subscriptions (email, subscription_id, plan, status, price, expiry_date, stripe_event_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `;
      await pool.execute(insertSql, [email, subscriptionId, plan, status, price, expiryDate || null, stripeEventId]);
      console.log(`Subscription saved to DB for ${email}`);
    }
    dbSuccess = true;
  } catch (dbError) {
    console.error(`Database error during subscription ${operationType || 'save'} for ${email}:`, dbError);
    // Continue to GHL sync attempt even if DB fails? Optional based on requirements.
    // If you want to stop on DB error, uncomment the next line:
    // return; // Or throw dbError;
  }

  // --- Sync Subscription Status to GHL (Asynchronously) ---
  if (process.env.GHL_API_KEY) { // Only run if API key is set
    console.log(`GHL Sync: Attempting update for subscription change (${status}) for ${email}`);

    // Prepare data for GHL - focus on tags or custom fields
    const ghlContactData = {
        email: email, // Primary identifier
        // Using tags is simpler initially
        tags: [`Plan: ${plan}`, `Subscription Status: ${status}`],
        // Example using custom fields (requires setup in GHL & getting field IDs)
        //  customFields: [
        //     { id: process.env.GHL_PLAN_FIELD_ID, value: plan },
        //     { id: process.env.GHL_STATUS_FIELD_ID, value: status },
        //     { id: process.env.GHL_EXPIRY_FIELD_ID, value: expiryDate ? new Date(expiryDate).toISOString() : '' } // Send ISO string date
        //  ],
    };

    // Use createOrUpdateContact which handles finding/updating based on email
    ghl.createOrUpdateContact(ghlContactData)
        .then(ghlContact => {
            if (ghlContact && ghlContact.id) {
                console.log(`GHL Sync: Updated GHL contact ${ghlContact.id} for subscription event (${status}) for ${email}`);
                // Optional: Add more specific tags if needed after update
                // ghl.addTagsToContact(ghlContact.id, ['Subscription Processed']);
            } else {
                console.error(`GHL Sync Error: Failed to update GHL contact for subscription event: ${email}`);
            }
        })
        .catch(err => {
            console.error(`GHL Sync Exception (Subscription ${status} for ${email}):`, err);
        });
  } else {
      console.log(`GHL Sync: Skipped for subscription ${status} (GHL_API_KEY not set).`);
  }
  // --- End GHL Send ---
}

module.exports = { saveSubscriptionToDb };