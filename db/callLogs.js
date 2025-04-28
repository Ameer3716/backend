// db/callLogs.js
const pool = require('./db');
const ghl = require('../utils/gohighlevel'); // <-- IMPORT GHL HELPER
require('dotenv').config(); // Load .env variables for GHL_API_KEY check

/**
 * Saves or updates a call log in the database and syncs info (tags/notes) to GoHighLevel.
 * @param {object} callData - Object containing call details.
 * @throws {Error} If database operation fails (optional, depends on outer handling).
 */
async function saveCallLog(callData) {
  console.log("Attempting to save call log:", callData);
  const { call_id, user_email, direction, phone_number, status, start_time, duration, agent_id, notes } = callData;
  let dbSuccess = false;
  let operationType = '';

  if (!call_id) {
      console.error("Error saving call log: Missing call_id");
      return; // Cannot save without a call_id
  }

  // --- Save/Update Call Log in Local DB ---
  try {
    // Use TIMESTAMP for start_time if it's a Date object, otherwise pass as is
    const startTimeForDb = start_time instanceof Date ? start_time.toISOString().slice(0, 19).replace('T', ' ') : start_time;

    const updateSql = `
      UPDATE call_logs
      SET direction = ?, user_email = ?, phone_number = ?, status = ?, start_time = ?, duration = ?, agent_id = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
      WHERE call_id = ?
    `;
    const updateParams = [ direction, user_email, phone_number, status, startTimeForDb, duration, agent_id || null, notes || null, call_id ];
    const [updateResult] = await pool.execute(updateSql, updateParams);

    if (updateResult.affectedRows === 0) {
      // Insert if update didn't affect any rows (call_id didn't exist)
      operationType = 'insert';
      const insertSql = `
        INSERT INTO call_logs (call_id, user_email, direction, phone_number, status, start_time, duration, agent_id, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      const insertParams = [ call_id, user_email, direction, phone_number, status, startTimeForDb, duration, agent_id || null, notes || null ];
      await pool.execute(insertSql, insertParams);
      console.log(`Call log ${call_id} inserted successfully.`);
    } else {
      operationType = 'update';
      console.log(`Call log ${call_id} updated successfully.`);
    }
    dbSuccess = true;
  } catch (error) {
    console.error(`Database error during call log ${operationType || 'save'} for ${call_id}:`, error);
    // Decide if you want to stop GHL sync if DB fails
    // return; // Or throw error;
  }

  // --- Sync Call Info to GHL (Asynchronously) ---
  // Check if GHL key is set AND if there's an email to associate the call with
  if (process.env.GHL_API_KEY && user_email && user_email !== 'N/A') {
      console.log(`GHL Sync: Processing call log update for ${user_email}, Call ID: ${call_id}`);

      // Prepare contact data for lookup/creation
      const contactLookupData = {
          email: user_email,
          phone: phone_number // Include phone, GHL might use it for matching/enrichment
      };

      // Find/create the contact first
      ghl.createOrUpdateContact(contactLookupData)
          .then(ghlContact => {
              if (ghlContact && ghlContact.id) {
                  console.log(`GHL Sync: Found/created contact ${ghlContact.id} for call log update.`);

                  // Option 1: Add Tags
                  const callDate = start_time instanceof Date ? start_time.toLocaleDateString() : 'Unknown Date';
                  const tagsToAdd = [
                      `Call Log: ${callDate}`, // General tag indicating a call happened
                      `Call ${direction} (${status})`, // Combine direction and status
                  ];
                  if (status === 'completed' || status === 'ended') {
                       tagsToAdd.push('Call Completed'); // Specific tag for completion
                  }
                  ghl.addTagsToContact(ghlContact.id, tagsToAdd)
                     .then(tagSuccess => {
                         if(tagSuccess) console.log(`GHL Sync: Tags added for call ${call_id} to contact ${ghlContact.id}`);
                         else console.error(`GHL Sync Error: Failed to add tags for call ${call_id} to contact ${ghlContact.id}`);
                     });


                  // Option 2: Add a Note with more detail
                  if (status === 'completed' || status === 'ended') { // Only add note for completed calls? Optional.
                    const noteBody = `CallEase Log - Call ID: ${call_id}\nDirection: ${direction}\nNumber: ${phone_number || 'N/A'}\nStatus: ${status}\nDuration: ${duration || 0}s\nTime: ${start_time instanceof Date ? start_time.toLocaleString() : 'N/A'}\nNotes: ${notes || 'None'}`;
                    ghl.createNoteForContact(ghlContact.id, noteBody)
                       .then(note => {
                           if(note) console.log(`GHL Sync: Note added for call ${call_id} to contact ${ghlContact.id}`);
                           else console.error(`GHL Sync Error: Failed to add note for call ${call_id} to contact ${ghlContact.id}`);
                       });
                  }

              } else {
                  console.warn(`GHL Sync Warning: Could not find/create GHL contact for call log associated with ${user_email}`);
              }
          })
          .catch(err => {
              console.error(`GHL Sync Exception (Call Log for ${user_email}, Call ${call_id}):`, err);
          });
  } else {
       if (!process.env.GHL_API_KEY) {
           console.log("GHL Sync: Skipped for call log (GHL_API_KEY not set).");
       } else if (!user_email || user_email === 'N/A') {
            console.log(`GHL Sync: Skipped for call log ${call_id} (No user email associated).`);
       }
  }
  // --- End GHL Send ---
}

/**
 * Gets call logs from the database, optionally filtered by user email.
 * @param {string} [userEmail] - Optional email to filter logs for. If null/undefined, gets all logs.
 * @returns {Promise<Array>} An array of call log objects.
 */
async function getCallLogs(userEmail) {
  let sql, params = [];
  // This function retrieves from YOUR DB, not GHL
  if (userEmail) {
    // Non-admins only see their own logs
    sql = 'SELECT * FROM call_logs WHERE user_email = ? ORDER BY start_time DESC';
    params = [userEmail];
    console.log(`Fetching DB call logs for user: ${userEmail}`);
  } else {
    // If userEmail is explicitly null/undefined, assume admin wants all logs
    sql = 'SELECT * FROM call_logs ORDER BY start_time DESC';
    console.log("Fetching all DB call logs (admin view)");
  }
  try {
      const [rows] = await pool.execute(sql, params);
      return rows;
  } catch (dbError) {
      console.error("Database error fetching call logs:", dbError);
      return []; // Return empty array on error
  }
}

module.exports = { saveCallLog, getCallLogs };