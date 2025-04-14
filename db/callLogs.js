// db/callLogs.js
const pool = require('./db'); // Uses your MySQL pool from db/db.js

async function saveCallLog(callData) {
  console.log("Attempting to save call log:", callData);
  const { call_id, user_email, direction, phone_number, status, start_time, duration, agent_id, notes } = callData;

  try {
    const updateSql = `
      UPDATE call_logs 
      SET direction = ?, user_email = ?, phone_number = ?, status = ?, start_time = ?, duration = ?, agent_id = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
      WHERE call_id = ?
    `;
    const [updateResult] = await pool.execute(updateSql, [
      direction,
      user_email,
      phone_number,
      status,
      start_time,
      duration,
      agent_id,
      notes,
      call_id
    ]);

    if (updateResult.affectedRows === 0) {
      const insertSql = `
        INSERT INTO call_logs (call_id, user_email, direction, phone_number, status, start_time, duration, agent_id, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      await pool.execute(insertSql, [
        call_id,
        user_email,
        direction,
        phone_number,
        status,
        start_time,
        duration,
        agent_id,
        notes
      ]);
      console.log("Call log inserted successfully.");
    } else {
      console.log("Call log updated successfully.");
    }
  } catch (error) {
    console.error("Error saving call log:", error);
    throw error;
  }
}

// Get call logs; if userEmail is provided, filter by that email
async function getCallLogs(userEmail) {
  let sql, params = [];
  if (userEmail) {
    sql = 'SELECT * FROM call_logs WHERE user_email = ? ORDER BY start_time DESC';
    params = [userEmail];
  } else {
    // For admin: fetch all logs
    sql = 'SELECT * FROM call_logs ORDER BY start_time DESC';
  }
  const [rows] = await pool.execute(sql, params);
  return rows;
}

module.exports = { saveCallLog, getCallLogs };
