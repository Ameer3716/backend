const express = require('express');
const router = express.Router();
const pool = require('../db/db');
const { saveCallLog } = require('../db/callLogs');

// For production, you would use the raw body parser with signature verification
// For testing (and development), we use express.json() and skip signature verification.
router.post('/', express.json(), async (req, res) => {
  console.log('--- Inbound Webhook Received ---');
  console.log('Raw body:', JSON.stringify(req.body, null, 2));

  // Try to extract the call object from the payload.
  let callEvent;
  if (req.body.data && req.body.data.object) {
    callEvent = req.body.data.object;
  } else if (req.body.call) {
    callEvent = req.body.call;
  } else {
    console.error("No call data provided in webhook payload");
    return res.status(400).json({ error: "No call data provided" });
  }

  console.log('Processing call event:', JSON.stringify(callEvent, null, 2));

  // Construct a new call object based on the event data.
  const newCall = {
    id: callEvent.id,
    direction: callEvent.direction,
    from: (callEvent.customer && callEvent.customer.number) ? callEvent.customer.number : "N/A",
    startTime: callEvent.createdAt ? new Date(callEvent.createdAt) : new Date(),
    status: callEvent.status,
    duration: callEvent.duration || 0,
    // In this simple version, we cannot map a user so we default to "N/A".
    user_email: "N/A"
  };

  console.log("Constructed newCall object:", newCall);

  // Add newCall to the in-memory global array (for real-time notifications)
  const index = global.callLogs.findIndex(c => c.id === newCall.id);
  if (index > -1) {
    global.callLogs[index] = newCall;
    console.log("Updated existing call in global.callLogs");
  } else {
    global.callLogs.unshift(newCall);
    console.log("Added new call to global.callLogs");
  }

  // Update active calls and notify connected clients
  global.updateActiveCalls();
  global.notifyClients(newCall);

  // Save the call log to the DB with additional logging
  try {
    const callData = {
      call_id: newCall.id,
      user_email: newCall.user_email,
      direction: newCall.direction,
      phone_number: newCall.from,
      status: newCall.status,
      start_time: newCall.startTime,
      duration: newCall.duration,
      agent_id: null,
      notes: null
    };

    console.log("Attempting to save inbound call log to DB:", callData);
    await saveCallLog(callData);
    console.log("Inbound call log saved successfully to DB.");
  } catch (error) {
    console.error("Error saving inbound call log:", error);
    // In production, you might choose to notify an alert service here.
  }

  res.status(200).json({ received: true });
});

module.exports = router;
