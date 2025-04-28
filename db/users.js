// db/users.js
const pool = require('./db'); // Ensure your db.js exports your MySQL connection pool
const ghl = require('../utils/gohighlevel'); // <-- Import GHL helper
require('dotenv').config(); // Load .env variables for GHL_API_KEY check

/**
 * Finds a user by their Google ID.
 * @param {string} googleId - The user's Google Profile ID.
 * @returns {Promise<object|undefined>} The user object or undefined if not found.
 */
async function findUserByGoogleId(googleId) {
  const sql = 'SELECT * FROM users WHERE google_id = ?';
  const [rows] = await pool.execute(sql, [googleId]);
  return rows[0];
}

/**
 * Creates a new user in the database and syncs to GoHighLevel.
 * @param {object} userData - Object containing user details (googleId, email, name, phone?).
 * @returns {Promise<object>} The newly created user object from the database.
 * @throws {Error} If database insertion fails.
 */
async function createUser(userData) {
  const { googleId, email, name, phone } = userData; // Expect phone potentially
  // Ensure your 'users' table schema includes 'phone' and 'role' columns
  const sql = 'INSERT INTO users (google_id, email, name, phone, role) VALUES (?, ?, ?, ?, ?)';
  const role = 'user'; // Default role
  let result;

  // --- Create user in local DB ---
  try {
       [result] = await pool.execute(sql, [googleId, email, name, phone || null, role]);
  } catch (dbError) {
       console.error(`Database error creating user ${email}:`, dbError);
       throw dbError; // Re-throw DB error to be handled by caller
  }

  const newUser = { id: result.insertId, googleId, email, name, phone, role };
  console.log(`User created in DB: ID=${newUser.id}, Email=${newUser.email}`);

  // --- Sync to GHL (Asynchronously - doesn't block the function return) ---
  if (process.env.GHL_API_KEY) { // Only run if API key is set
      console.log(`GHL Sync: Attempting to upsert contact for new user ${newUser.email}`);
      const ghlContactData = {
          email: newUser.email,
          firstName: newUser.name?.split(' ')[0] || '', // Basic split
          lastName: newUser.name?.split(' ').slice(1).join(' ') || '', // Basic split
          name: newUser.name, // Full name
          phone: newUser.phone, // Pass phone if available
          tags: ['CallEase Signup', 'Lead'], // Example initial tags
          source: 'CallEase App Signup' // Example source tracking
      };

      ghl.createOrUpdateContact(ghlContactData)
          .then(ghlContact => { // Using .then for async background task
              if (ghlContact && ghlContact.id) {
                  console.log(`GHL Sync: Synced new user ${newUser.email} to GHL contact ${ghlContact.id}`);
              } else {
                  // Log error but don't crash the main app flow
                  console.error(`GHL Sync Error: Failed to sync new user ${newUser.email} to GHL or invalid response received.`);
              }
          })
          .catch(err => {
              // Log error from the promise
              console.error(`GHL Sync Exception (User Create for ${newUser.email}):`, err);
          });
  } else {
       console.log("GHL Sync: Skipped for new user (GHL_API_KEY not set).");
  }
  // --- End GHL Send ---

  return newUser; // Return the user created in *our* DB
}

/**
 * Finds a user by their internal database ID.
 * @param {number} id - The user's database ID.
 * @returns {Promise<object|undefined>} The user object or undefined if not found.
 */
async function findUserById(id) {
  const sql = 'SELECT * FROM users WHERE id = ?';
  const [rows] = await pool.execute(sql, [id]);
  return rows[0];
}

module.exports = { findUserByGoogleId, createUser, findUserById };