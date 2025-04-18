// server.js
require("dotenv").config(); // Load environment variables first
const express = require("express");
const axios = require("axios");
const { createServer } = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const session = require("express-session");
const passport = require("passport");
const pool = require('./db/db');
const isAuthenticated = require("./middlewares/isAuthenticated");
require("./config/passport"); // Initialize passport configuration
const path = require("path");

// Import routes
const webhookRoutes = require('./routes/webhook');         // Stripe webhook
const inboundWebhookRoutes = require('./routes/inboundWebhook'); // Vapi webhook (if separate)
const authRoutes = require('./routes/auth');
const subscriptionRoutes = require('./routes/subscriptions');
const stripeRoutes = require('./routes/stripe');
const callLogsRoutes = require('./routes/callLogs');
const adminRoutes = require('./routes/admin');

const app = express();

// --- Essential Middleware ---

// Trust proxy headers (e.g., X-Forwarded-For) if behind Nginx/Load Balancer
app.set('trust proxy', 1);

// --- Centralized CORS Configuration ---
const allowedOrigins = [
    process.env.FRONTEND_URL,   // Production frontend URL from .env
    "http://localhost:5174"     // Local development frontend URL
].filter(Boolean); // Removes null/undefined if FRONTEND_URL is not set

const corsOptions = {
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps or curl requests) OR if origin is in the list
        if (!origin || allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            console.warn(`CORS blocked for origin: ${origin}`);
            callback(new Error('Not allowed by CORS'));
        }
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true
};

// Apply CORS globally BEFORE routes
app.use(cors(corsOptions));
// Handle preflight requests for all routes
app.options('*', cors(corsOptions));

// --- Session Middleware ---
app.use(session({
    secret: process.env.SESSION_SECRET || 'please_set_a_strong_secret_in_env', // Strongly recommend setting in .env
    resave: false,
    saveUninitialized: false,
    cookie: {
        sameSite: 'lax', // Good default for preventing CSRF
        secure: process.env.NODE_ENV === 'production', // Send cookie only over HTTPS in production
        maxAge: 1000 * 60 * 60 * 24 // Example: cookie expires in 1 day
    }
}));

// --- Passport Middleware ---
app.use(passport.initialize());
app.use(passport.session());

// --- Body Parsers ---
// IMPORTANT: Stripe webhook needs the raw body, so its route comes BEFORE express.json()
// The express.raw middleware is applied INSIDE routes/webhook.js now.
app.use('/webhook', webhookRoutes);

// Parse JSON bodies for other routes AFTER the raw webhook route
app.use(express.json());

// --- Mount Application Routes ---
app.use('/webhook/inbound', inboundWebhookRoutes); // Assuming Vapi uses this endpoint
app.use('/auth', authRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/stripe', stripeRoutes);
app.use('/api/call-logs', callLogsRoutes);
app.use('/api/admin', adminRoutes);

// --- Application-Specific Routes ---
app.get('/dashboard', isAuthenticated, (req, res) => {
    res.json({ message: `Welcome, ${req.user.name}` });
});

// Added isAuthenticated middleware here
app.get('/api/user', isAuthenticated, async (req, res) => {
    // req.user is guaranteed to exist here because of the middleware
    try {
        const [rows] = await pool.execute(
            'SELECT * FROM subscriptions WHERE email = ? AND status = "active" LIMIT 1',
            [req.user.email]
        );
        const isSubscribed = rows.length > 0;
        res.json({
            email: req.user.email,
            name: req.user.name,
            isSubscribed: isSubscribed,
            role: req.user.role || 'user' // Include role if available in user object
        });
    } catch (error) {
        console.error('Error fetching subscription status:', error);
        res.status(500).json({ error: 'Internal server error fetching subscription' });
    }
});

// --- Server and Socket.IO Setup ---
const serverInstance = createServer(app);
const io = new Server(serverInstance, {
    cors: corsOptions, // Use the same CORS options
    path: "/socket.io"
});

// --- Remove Sensitive Key Logging on Start ---
// console.log("OUTBOUND_ASSISTANT_ID:", process.env.OUTBOUND_VAPI_ASSISTANT_ID);
// console.log("INBOUND_ASSISTANT_ID:", process.env.INBOUND_VAPI_ASSISTANT_ID);
// console.log("VAPI_API_KEY:", process.env.VAPI_API_KEY);
// console.log("VAPI_PHONE_NUMBER_ID:", process.env.VAPI_PHONE_NUMBER_ID);

// --- VAPI Client Setup ---
const VAPI_API_KEY = process.env.VAPI_API_KEY;
const vapi = axios.create({
    baseURL: "https://api.vapi.ai",
    headers: { Authorization: `Bearer ${VAPI_API_KEY}` }
});

// --- Real-time Call Handling Logic ---
// In-memory storage (consider Redis if scaling beyond single VPS)
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
    console.log(`Socket client connected: ${socket.id}`);
    socket.emit("activeCalls", activeCalls); // Send current count on connection
    socket.on('disconnect', () => {
        console.log(`Socket client disconnected: ${socket.id}`);
    });
});

// Make call state globally accessible (if needed by routes/modules)
// Note: Modifying global state can be tricky; ensure careful management.
global.callLogs = callLogs;
global.updateActiveCalls = updateActiveCalls;
global.notifyClients = notifyClients;
global.io = io;

// --- VAPI API Routes ---
app.get("/api/calls", isAuthenticated, (req, res) => { // Added auth middleware
    res.json(callLogs); // Send the in-memory logs (may differ from DB)
});

app.get('/api/calls/:id', isAuthenticated, (req, res) => { // Added auth middleware
    const callId = req.params.id;
    const call = callLogs.find(c => c.id === callId);
    if (call) {
        res.json(call);
    } else {
        res.status(404).json({ error: 'In-memory call log not found' });
    }
});

// Start Outbound Call
app.post("/api/calls/start", isAuthenticated, async (req, res) => { // Added auth middleware
    try {
        const { phoneNumber } = req.body;
        if (!phoneNumber) {
            return res.status(400).json({ error: "phoneNumber is required" });
        }
        console.log(`Attempting to start outbound call to: ${phoneNumber}`);
        const response = await vapi.post("/call/phone", {
            phoneNumberId: process.env.VAPI_PHONE_NUMBER_ID,
            assistantId: process.env.OUTBOUND_VAPI_ASSISTANT_ID,
            customer: { number: phoneNumber }
        });
        console.log("Vapi response for start call:", response.data);
        const newCall = {
            ...response.data,
            direction: "outbound",
            status: "queued", // Vapi calls often start as 'queued' or similar
            startTime: new Date(),
            duration: 0,
            user_email: req.user.email // Associate call with logged-in user
        };
        callLogs.unshift(newCall);
        updateActiveCalls(); // This likely won't increment yet
        notifyClients(newCall);
        res.status(200).json(newCall);
    } catch (error) {
        console.error("Error starting call:", error.response?.data || error.message);
        res.status(500).json({ error: error.response?.data?.message || "Failed to start call" });
    }
});

// Answer Inbound Call Endpoint
app.post("/api/calls/answer/:callId", isAuthenticated, async (req, res) => { // Added auth middleware (admin?)
    // Consider adding isAdmin middleware if only admins can answer?
    try {
        const { callId } = req.params;
        const call = callLogs.find(c => c.id === callId);
        // ... (rest of your existing logic) ...
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

        // Update call status (Vapi webhook might do this too, be mindful of race conditions)
        call.status = "ongoing";
        console.log(`Call ${callId} status updated to 'ongoing'`);
        notifyClients(call);

        return res.json({ message: "Call answered", call });
    } catch (error) {
        console.error("Error answering call:", error.response?.data || error.message);
        res.status(500).json({ error: error.response?.data?.message || "Failed to answer call" });
    }
});

// Reject Inbound Call Endpoint
app.post("/api/calls/reject/:callId", isAuthenticated, async (req, res) => { // Added auth middleware (admin?)
    // Consider adding isAdmin middleware if only admins can reject?
    try {
        const { callId } = req.params;
        const call = callLogs.find(c => c.id === callId);
         // ... (rest of your existing logic) ...
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

        call.status = "completed"; // Update local status
        call.duration = Math.floor((Date.now() - (call.startTime ? new Date(call.startTime) : Date.now())) / 1000);
        console.log(`Call ${callId} rejected. Duration: ${call.duration} seconds.`);
        updateActiveCalls(); // Update count
        notifyClients(call); // Notify clients

        // Note: Webhook from Vapi might also send completion event. DB save might be better there.

        return res.json({ message: "Call rejected", call });
    } catch (error) {
        console.error("Error rejecting call:", error.response?.data || error.message);
        res.status(500).json({ error: error.response?.data?.message || "Failed to reject call" });
    }
});

// End Call (Generic - usually for outbound or already answered inbound)
app.post("/api/calls/end/:callId", isAuthenticated, async (req, res) => { // Added auth middleware
    try {
        const { callId } = req.params;
        const call = callLogs.find(c => c.id === callId);
         // ... (rest of your existing logic) ...
        if (!call || !call.monitor?.controlUrl) {
          return res.status(404).json({ error: "Call not found or no control URL available" });
        }
        console.log(`Attempting to end call ${callId} via control URL`);
        await axios.post(call.monitor.controlUrl, { type: "end-call" }, {
          headers: { Authorization: `Bearer ${VAPI_API_KEY}`, "Content-Type": "application/json" }
        });

        // Update local state - Vapi webhook is primary source of truth for final state
        call.status = "completed";
        call.duration = Math.floor((Date.now() - (call.startTime ? new Date(call.startTime) : Date.now())) / 1000);
        console.log(`Call ${callId} ended via API. Duration: ${call.duration} seconds.`);

        updateActiveCalls();
        notifyClients(call);

        // Save log attempt - Note: Vapi webhook event is likely better place for final DB save
        const callData = {
          call_id: call.id,
          user_email: call.user_email || (req.user ? req.user.email : "N/A"), // Prefer user email associated earlier if available
          direction: call.direction,
          phone_number: call.from || "N/A",
          status: call.status,
          start_time: call.startTime ? new Date(call.startTime) : new Date(),
          duration: call.duration,
          agent_id: call.agentId || null,
          notes: call.notes || null
        };

        console.log("Attempting to save call log after API end:", callData);
        // Use try-catch if calling saveCallLog here
        try {
            await require('./db/callLogs').saveCallLog(callData);
            console.log("Call log potentially saved/updated via API end.");
        } catch(dbError) {
            console.error("Error saving call log after API end:", dbError);
        }

        res.json({ message: "Call end request sent", call });
    } catch (error) {
        console.error("Error ending call:", error.response?.data || error.message);
        res.status(500).json({ error: error.response?.data?.message || "Failed to end call" });
    }
});


// --- Global Error Handler (Keep at the end) ---
app.use((err, req, res, next) => {
    console.error("Global Error Handler:", err.stack);
    // Avoid sending stack trace in production
    const errorResponse = process.env.NODE_ENV === 'production'
        ? { error: "Something went wrong!" }
        : { error: err.message || "Something went wrong!", stack: err.stack };
    res.status(err.status || 500).json(errorResponse);
});

// --- Start Server ---
const PORT = process.env.PORT || 3001;
serverInstance.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});