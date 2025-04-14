// server.js
require("dotenv").config();
const express = require("express");
const axios = require("axios");
const { createServer } = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const session = require("express-session");
const passport = require("passport");
const pool = require('./db/db');
const isAuthenticated = require("./middlewares/isAuthenticated");
require("./config/passport");
const path = require("path");
// Import routes
const webhookRoutes = require('./routes/webhook');
const inboundWebhookRoutes = require('./routes/inboundWebhook');
const authRoutes = require('./routes/auth');
const subscriptionRoutes = require('./routes/subscriptions');
const stripeRoutes = require('./routes/stripe');
const callLogsRoutes = require('./routes/callLogs');
const adminRoutes = require('./routes/admin');console.log("Server running on port 3001");
console.log("OUTBOUND_ASSISTANT_ID:", process.env.OUTBOUND_VAPI_ASSISTANT_ID);
console.log("INBOUND_ASSISTANT_ID:", process.env.INBOUND_VAPI_ASSISTANT_ID);
console.log("VAPI_API_KEY:", process.env.VAPI_API_KEY);
console.log("VAPI_PHONE_NUMBER_ID:", process.env.VAPI_PHONE_NUMBER_ID);
const app = express();


// Setup session middleware
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { sameSite: 'lax', secure: false }
}));

// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());

// Mount routes
app.use('/webhook', webhookRoutes);
app.use('/webhook/inbound', inboundWebhookRoutes);
app.use('/auth', authRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/stripe', stripeRoutes);
app.use('/api/call-logs', callLogsRoutes);
app.use('/api/admin', adminRoutes);
// Global CORS settings
app.use(cors({
  origin: "http://localhost:5174",
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true
}));

app.use(express.json());
app.options("*", cors());

app.get('/dashboard', isAuthenticated, (req, res) => {
  res.json({ message: `Welcome, ${req.user.name}` });
});

app.get('/api/user', async (req, res) => {
  if (req.isAuthenticated && req.isAuthenticated()) {
    try {
      const [rows] = await pool.execute(
        'SELECT * FROM subscriptions WHERE email = ? AND status = "active" LIMIT 1',
        [req.user.email]
      );
      const isSubscribed = rows.length > 0;
      
      res.json({
        email: req.user.email,
        name: req.user.name,
        isSubscribed
      });
    } catch (error) {
      console.error('Error fetching subscription status:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  } else {
    res.status(401).json({ error: 'Unauthorized. Please log in.' });
  }
});

// Create HTTP server and setup Socket.IO
const serverInstance = createServer(app);
const io = new Server(serverInstance, {
  cors: {
    origin: "http://localhost:5174",
    methods: ["GET", "POST"],
    credentials: true
  },
  path: "/socket.io"
});

console.log("OUTBOUND_ASSISTANT_ID:", process.env.OUTBOUND_VAPI_ASSISTANT_ID);
console.log("INBOUND_ASSISTANT_ID:", process.env.INBOUND_VAPI_ASSISTANT_ID);
console.log("VAPI_API_KEY:", process.env.VAPI_API_KEY);
console.log("VAPI_PHONE_NUMBER_ID:", process.env.VAPI_PHONE_NUMBER_ID);

const VAPI_API_KEY = process.env.VAPI_API_KEY;
const vapi = axios.create({
  baseURL: "https://api.vapi.ai",
  headers: { Authorization: `Bearer ${process.env.VAPI_API_KEY}` }
});

// In-memory storage for call logs (for real-time notifications only)
let callLogs = [];
let activeCalls = 0;

const updateActiveCalls = () => {
  activeCalls = callLogs.filter(call => call.status === "ongoing").length;
  io.emit("activeCalls", activeCalls);
};

const notifyClients = (call) => {
  io.emit("callUpdate", call);
};

io.on("connection", (socket) => {
  console.log("Client connected");
  socket.emit("activeCalls", activeCalls);
});
global.callLogs = callLogs;
global.updateActiveCalls = updateActiveCalls;
global.notifyClients = notifyClients;
global.io = io;
// Retrieve all calls (for debugging)
app.get("/api/calls", (req, res) => {
  res.json(callLogs);
});
app.get('/api/calls/:id', (req, res) => {
  const callId = req.params.id;
  const call = callLogs.find(c => c.id === callId);
  if (call) {
    res.json(call);
  } else {
    res.status(404).json({ error: 'Call not found' });
  }
});

// **Start Outbound Call**
app.post("/api/calls/start", async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    const response = await vapi.post("/call/phone", {
      phoneNumberId: process.env.VAPI_PHONE_NUMBER_ID,
      assistantId: process.env.OUTBOUND_VAPI_ASSISTANT_ID,
      customer: { number: phoneNumber }
    });
    const newCall = {
      ...response.data,
      direction: "outbound",
      status: "ongoing",
      startTime: new Date(),
      duration: 0
    };
    callLogs.unshift(newCall);
    updateActiveCalls();
    notifyClients(newCall);
    res.status(200).json(newCall);
  } catch (error) {
    console.error("Error starting call:", error.response?.data || error.message);
    res.status(500).json({ error: error.response?.data?.error || error.message });
  }
});

// **Answer Inbound Call Endpoint**
app.post("/api/calls/answer/:callId", async (req, res) => {
  try {
    const { callId } = req.params;
    const call = callLogs.find(c => c.id === callId);
    if (!call) {
      console.error(`Answer Call: No call found with id ${callId}`);
      return res.status(404).json({ error: "Call not found" });
    }
    if (call.direction !== "inbound") {
      console.error(`Answer Call: Call ${callId} is not inbound`);
      return res.status(400).json({ error: "Not an inbound call" });
    }
    if (!call.monitor || !call.monitor.controlUrl) {
      console.error(`Answer Call: No control URL available for call ${callId}`);
      return res.status(404).json({ error: "No control URL available for this call" });
    }

    const inboundAssistantId = process.env.VAPI_INBOUND_ASSISTANT_ID;
    console.log(`Answering inbound call ${callId} using assistant ID ${inboundAssistantId} at ${call.monitor.controlUrl}`);
    
    const response = await axios.post(
      call.monitor.controlUrl,
      { type: "control", control: "answer-call", assistantId: inboundAssistantId },
      { headers: { Authorization: `Bearer ${VAPI_API_KEY}`, "Content-Type": "application/json" } }
    );
    console.log(`Control response for answering call ${callId}:`, response.data);

    // Update call status
    call.status = "ongoing";
    console.log(`Call ${callId} status updated to 'ongoing'`);
    notifyClients(call);
    
    return res.json({ message: "Call answered", call });
  } catch (error) {
    console.error("Error answering call:", error.response?.data || error.message);
    return res.status(500).json({ error: error.response?.data?.error || error.message });
  }
});


// **Reject Inbound Call Endpoint**
app.post("/api/calls/reject/:callId", async (req, res) => {
  try {
    const { callId } = req.params;
    const call = callLogs.find(c => c.id === callId);
    if (!call) {
      console.error(`Reject Call: No call found with id ${callId}`);
      return res.status(404).json({ error: "Call not found" });
    }
    if (call.direction !== "inbound") {
      console.error(`Reject Call: Call ${callId} is not inbound`);
      return res.status(400).json({ error: "Not an inbound call" });
    }
    if (!call.monitor || !call.monitor.controlUrl) {
      console.error(`Reject Call: No control URL available for call ${callId}`);
      return res.status(404).json({ error: "No control URL available for this call" });
    }
    
    console.log(`Rejecting inbound call ${callId} at ${call.monitor.controlUrl}`);
    
    const response = await axios.post(
      call.monitor.controlUrl,
      { type: "end-call", reason: "rejected" },
      { headers: { Authorization: `Bearer ${VAPI_API_KEY}`, "Content-Type": "application/json" } }
    );
    console.log(`Control response for rejecting call ${callId}:`, response.data);
    
    call.status = "completed";
    call.duration = Math.floor((Date.now() - new Date(call.startTime)) / 1000);
    console.log(`Call ${callId} rejected. Duration: ${call.duration} seconds.`);
    notifyClients(call);
    
    return res.json({ message: "Call rejected", call });
  } catch (error) {
    console.error("Error rejecting call:", error.response?.data || error.message);
    return res.status(500).json({ error: error.response?.data?.error || error.message });
  }
});

// **End Call**
app.post("/api/calls/end/:callId", async (req, res) => {
  try {
    const { callId } = req.params;
    const call = callLogs.find(c => c.id === callId);
    if (!call || !call.monitor?.controlUrl) {
      return res.status(404).json({ error: "Call not found or no control URL available" });
    }
    await axios.post(call.monitor.controlUrl, { type: "end-call" }, {
      headers: { Authorization: `Bearer ${VAPI_API_KEY}`, "Content-Type": "application/json" }
    });
    call.status = "completed";
    call.duration = Math.floor((Date.now() - new Date(call.startTime)) / 1000);
    
    // Update active calls and notify clients
    updateActiveCalls();
    notifyClients(call);
    
    // Prepare call log data and include the authenticated user's email if available
    const callData = {
      call_id: call.id,
      user_email: req.user ? req.user.email : "N/A",
      direction: call.direction,
      phone_number: call.from || "N/A",
      status: call.status,
      start_time: new Date(call.startTime),
      duration: call.duration,
      agent_id: call.agentId || null,
      notes: call.notes || null
    };
    
    console.log("Attempting to save call log:", callData);
    await require('./db/callLogs').saveCallLog(callData);
    console.log("Call log saved successfully to DB.");
    res.json({ message: "Call ended", call });
  } catch (error) {
    console.error("Error ending call:", error.response?.data || error.message);
    res.status(500).json({ error: error.response?.data?.error || error.message });
  }
});

// **Webhook for Inbound Calls**
app.post("/webhook", (req, res) => {
  try {
    const event = req.body;
    // For inbound calls via webhook, attempt to map the caller’s phone number to a user.
    let userEmail = "N/A";
    if (event.call.customer && event.call.customer.number) {
      // Query the users table (assuming users table has a "phone" column)
      pool.execute("SELECT email FROM users WHERE phone = ?", [event.call.customer.number])
        .then(([users]) => {
          if (users.length > 0) {
            userEmail = users[0].email;
          }
          const newCall = {
            id: event.call.id,
            user_email: userEmail,
            direction: event.call.direction,
            from: event.call.customer.number,
            startTime: event.call.createdAt ? new Date(event.call.createdAt) : new Date(),
            status: event.call.status,
            duration: event.call.duration || 0,
            monitor: event.call.monitor // contains controlUrl and listenUrl
          };
          const index = callLogs.findIndex(c => c.id === newCall.id);
          if (index > -1) {
            callLogs[index] = newCall;
          } else {
            callLogs.unshift(newCall);
          }
          updateActiveCalls();
          notifyClients(newCall);
          res.status(200).end();
        })
        .catch(err => {
          console.error("Error mapping user by phone:", err);
          // If the lookup fails, still store the log with "N/A"
          const newCall = {
            id: event.call.id,
            user_email: "N/A",
            direction: event.call.direction,
            from: event.call.customer.number,
            startTime: event.call.createdAt ? new Date(event.call.createdAt) : new Date(),
            status: event.call.status,
            duration: event.call.duration || 0,
            monitor: event.call.monitor
          };
          const index = callLogs.findIndex(c => c.id === newCall.id);
          if (index > -1) {
            callLogs[index] = newCall;
          } else {
            callLogs.unshift(newCall);
          }
          updateActiveCalls();
          notifyClients(newCall);
          res.status(200).end();
        });
    } else {
      // If no customer number is provided, store with default values.
      const newCall = {
        id: event.call.id,
        user_email: "N/A",
        direction: event.call.direction,
        from: "N/A",
        startTime: event.call.createdAt ? new Date(event.call.createdAt) : new Date(),
        status: event.call.status,
        duration: event.call.duration || 0,
        monitor: event.call.monitor
      };
      const index = callLogs.findIndex(c => c.id === newCall.id);
      if (index > -1) {
        callLogs[index] = newCall;
      } else {
        callLogs.unshift(newCall);
      }
      updateActiveCalls();
      notifyClients(newCall);
      res.status(200).end();
    }
  } catch (error) {
    console.error("Webhook processing error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Global error handler
app.use((err, req, res, next) => {
  console.error("Global Error Handler:", err.stack);
  res.status(500).json({ error: "Something went wrong!" });
});

serverInstance.listen(3001, () => {
  console.log("Server running on port 3001");
});
