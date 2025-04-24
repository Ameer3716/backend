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
const { saveCallLog } = require('./db/callLogs'); // Import saveCallLog

// Import routes
const webhookRoutes = require('./routes/webhook');
const inboundWebhookRoutes = require('./routes/inboundWebhook');
const authRoutes = require('./routes/auth');
const subscriptionRoutes = require('./routes/subscriptions');
const stripeRoutes = require('./routes/stripe');
const callLogsRoutes = require('./routes/callLogs');
const adminRoutes = require('./routes/admin');

const app = express();

// --- Essential Middleware ---
app.set('trust proxy', 1);

// --- Centralized CORS Configuration ---
const allowedOrigins = [
    process.env.FRONTEND_URL,
    "http://localhost:5174"
].filter(Boolean);

const corsOptions = {
    origin: function (origin, callback) {
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
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// --- Session Middleware ---
app.use(session({
    secret: process.env.SESSION_SECRET || 'please_set_a_strong_secret_in_env',
    resave: false,
    saveUninitialized: false,
    cookie: {
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production', // Corrected: Set true ONLY in production
        maxAge: 1000 * 60 * 60 * 24
    }
}));

// --- Passport Middleware ---
app.use(passport.initialize());
app.use(passport.session());

// --- Body Parsers ---
app.use('/webhook', webhookRoutes); // Stripe raw body handled inside
app.use(express.json());

// --- Mount Application Routes ---
app.use('/webhook/inbound', inboundWebhookRoutes);
app.use('/auth', authRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/stripe', stripeRoutes);
app.use('/api/call-logs', callLogsRoutes); // For DB logs
app.use('/api/admin', adminRoutes);

// --- Application-Specific Routes ---
app.get('/dashboard', isAuthenticated, (req, res) => {
    res.json({ message: `Welcome, ${req.user.name}` });
});

app.get('/api/user', isAuthenticated, async (req, res) => {
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
            role: req.user.role || 'user'
        });
    } catch (error) {
        console.error('Error fetching subscription status:', error);
        res.status(500).json({ error: 'Internal server error fetching subscription' });
    }
});

// --- Server and Socket.IO Setup ---
const serverInstance = createServer(app);
const io = new Server(serverInstance, {
    cors: corsOptions,
    path: "/socket.io"
});

// --- VAPI Client Setup ---
const VAPI_API_KEY = process.env.VAPI_API_KEY;
const vapi = axios.create({
    baseURL: "https://api.vapi.ai",
    headers: { Authorization: `Bearer ${VAPI_API_KEY}` }
});

// --- Real-time Call Handling Logic ---
// Use a Map for potentially slightly better performance on lookups/updates by ID
let callLogsMap = new Map(); // Use Map instead of Array
let activeCalls = 0;

const updateActiveCalls = () => {
    activeCalls = Array.from(callLogsMap.values()).filter(call => call.status === "ongoing").length;
    // Emit to all for now, frontend will filter
    io.emit("activeCalls", activeCalls);
};

const notifyClients = (call) => {
    // Emit to all connected clients. Frontend needs to filter based on user.
    // A more advanced setup would involve socket rooms per user.
    io.emit("callUpdate", call);
    console.log(`Emitted callUpdate for call ID: ${call?.id}, User: ${call?.user_email}, Status: ${call?.status}`);
};

io.on("connection", (socket) => {
    console.log(`Socket client connected: ${socket.id}`);
    // Optionally associate socket with user if needed for targeted emits
    // const userId = socket.handshake.session?.passport?.user; // Requires session middleware for socket.io
    // if (userId) { socket.join(userId); } // Example joining a user-specific room
    socket.emit("activeCalls", activeCalls);
    socket.on('disconnect', () => {
        console.log(`Socket client disconnected: ${socket.id}`);
    });
});

// Expose Map getter (read-only view) if needed elsewhere
global.getCallLogById = (id) => callLogsMap.get(id);
global.getAllCallLogs = () => Array.from(callLogsMap.values());
// Expose Map directly - USE WITH CAUTION (allows modification)
// global.callLogsMap = callLogsMap;

// --- VAPI API Routes ---

// GET endpoint for *in-memory* call logs (filtered for user)
app.get("/api/calls", isAuthenticated, (req, res) => {
    const userEmail = req.user.email;
    const userRole = req.user.role || 'user';
    const allLogs = Array.from(callLogsMap.values()).sort((a, b) => new Date(b.startTime) - new Date(a.startTime)); // Sort by time desc

    if (userRole.toLowerCase() === 'admin') {
        // Admin sees all *in-memory* calls
        res.json(allLogs);
    } else {
        // Regular user sees only their *in-memory* calls
        const userLogs = allLogs.filter(call => call.user_email === userEmail);
        res.json(userLogs);
    }
});

app.get('/api/calls/:id', isAuthenticated, (req, res) => {
    const callId = req.params.id;
    const call = callLogsMap.get(callId); // Get from Map
    // Add permission check: Ensure user can only get their own call unless admin
    if (call && (call.user_email === req.user.email || (req.user.role && req.user.role.toLowerCase() === 'admin'))) {
        res.json(call);
    } else if (!call) {
        res.status(404).json({ error: 'In-memory call log not found' });
    } else {
        res.status(403).json({ error: 'Forbidden' }); // User trying to access someone else's call
    }
});

// Start Outbound Call - Associates with logged-in user
app.post("/api/calls/start", isAuthenticated, async (req, res) => {
    try {
        const { phoneNumber } = req.body;
        if (!phoneNumber) {
            return res.status(400).json({ error: "phoneNumber is required" });
        }
        const userEmail = req.user.email; // Get user email from session
        console.log(`User ${userEmail} attempting to start outbound call to: ${phoneNumber}`);

        const response = await vapi.post("/call/phone", {
            phoneNumberId: process.env.VAPI_PHONE_NUMBER_ID,
            assistantId: process.env.OUTBOUND_VAPI_ASSISTANT_ID,
            customer: { number: phoneNumber }
        });

        console.log("Vapi response for start call:", response.data);

        const newCall = {
            // Essential Vapi data
            id: response.data.id,
            type: response.data.type,
            status: response.data.status || "queued", // Initial status
            orgId: response.data.orgId,
            phoneNumberId: response.data.phoneNumberId,
            assistantId: response.data.assistantId,
            customer: response.data.customer,
            createdAt: response.data.createdAt || new Date().toISOString(),
            updatedAt: response.data.updatedAt || new Date().toISOString(),
            // Our custom/added fields
            direction: "outbound",
            startTime: new Date(response.data.createdAt || Date.now()), // Use createdAt if available
            duration: 0,
            user_email: userEmail, // Associate call with logged-in user
            from: response.data.customer?.number, // Capture 'from' number if available
            // We need monitor object later for controlUrl if Vapi provides it on creation
            monitor: response.data.monitor // Store monitor object if returned
        };

        callLogsMap.set(newCall.id, newCall); // Add to Map
        // updateActiveCalls(); // Vapi webhook should update status to 'ongoing'
        notifyClients(newCall); // Notify frontend (frontend will filter)

        res.status(200).json(newCall);
    } catch (error) {
        console.error("Error starting call:", error.response?.data || error.message);
        res.status(500).json({ error: error.response?.data?.message || "Failed to start call" });
    }
});


// --- VAPI Webhook Handling (Example for updating call status) ---
// Assuming '/webhook/inbound' handles VAPI events
// This needs to be fleshed out based on VAPI webhook payload structure
// Example: Update call status and potentially store monitor object
// Inside routes/inboundWebhook.js or similar:
/*
router.post('/', express.json(), async (req, res) => {
    console.log('--- VAPI Webhook Received ---');
    // TODO: Add signature verification if VAPI provides it

    const event = req.body; // Assuming direct event object
    const callData = event.call; // Assuming call data is nested

    if (callData && callData.id) {
        const existingCall = callLogsMap.get(callData.id);
        if (existingCall) {
            console.log(`Updating call ${callData.id} from VAPI webhook. Status: ${callData.status}`);
            // Update relevant fields
            existingCall.status = callData.status;
            existingCall.duration = callData.duration || existingCall.duration;
            existingCall.endTime = callData.endedAt ? new Date(callData.endedAt) : existingCall.endTime;
            existingCall.updatedAt = callData.updatedAt || new Date().toISOString();
            // CRITICAL: Store the monitor object if it arrives later
            if (callData.monitor && !existingCall.monitor) {
                 existingCall.monitor = callData.monitor;
                 console.log(`Stored monitor object for call ${callData.id}`);
            }
            // Update the map
            callLogsMap.set(callData.id, existingCall);
            notifyClients(existingCall); // Notify frontend of the update
            updateActiveCalls(); // Update active count based on new status

            // Save final state to DB if call completed
            if (callData.status === 'completed' || callData.status === 'ended') {
                 try {
                     const dbData = { ...existingCall, call_id: existingCall.id, start_time: existingCall.startTime, phone_number: existingCall.from };
                     await saveCallLog(dbData);
                     console.log(`Saved completed call ${callData.id} to DB from VAPI webhook.`);
                 } catch (dbError) {
                     console.error(`Error saving call ${callData.id} to DB from VAPI webhook:`, dbError);
                 }
            }

        } else {
             // Optional: Handle webhook for a call not in memory? Maybe create it?
             console.log(`Received VAPI webhook for call ${callData.id} not found in memory.`);
             // Consider creating a partial record or logging it
        }
    } else {
        console.log("Received VAPI webhook with no call data or ID.");
    }

    res.status(200).json({ received: true });
});
*/


// Answer Inbound Call Endpoint - No change needed here, logic seems okay
app.post("/api/calls/answer/:callId", isAuthenticated, async (req, res) => {
    try {
        const { callId } = req.params;
        const call = callLogsMap.get(callId); // Get from Map
        if (!call) {
            return res.status(404).json({ error: "Call not found in active memory" });
        }
        // Permission Check (optional, depends on who can answer)
        // if (call.user_email !== req.user.email && req.user.role !== 'admin') {
        //     return res.status(403).json({ error: "Forbidden" });
        // }
        if (call.direction !== "inbound") { return res.status(400).json({ error: "Not an inbound call" }); }
        if (call.status !== 'ringing') { return res.status(400).json({ error: `Call status is ${call.status}, cannot answer.` }); }
        if (!call.monitor?.controlUrl) { return res.status(404).json({ error: "No control URL available for this call yet." }); }

        const inboundAssistantId = process.env.VAPI_INBOUND_ASSISTANT_ID;
        console.log(`User ${req.user.email} answering inbound call ${callId} using assistant ID ${inboundAssistantId}`);
        await axios.post(
            call.monitor.controlUrl,
            { type: "control", control: "answer-call", assistantId: inboundAssistantId },
            { headers: { Authorization: `Bearer ${VAPI_API_KEY}`, "Content-Type": "application/json" } }
        );
        // Vapi webhook should confirm status change to 'ongoing'
        // We can optimistically update here, but webhook is source of truth
        call.status = "answering"; // intermediate state
        callLogsMap.set(callId, call);
        notifyClients(call);
        console.log(`Answer request sent for call ${callId}`);
        return res.json({ message: "Answer request sent", call });
    } catch (error) {
        console.error("Error answering call:", error.response?.data || error.message);
        res.status(500).json({ error: error.response?.data?.message || "Failed to answer call" });
    }
});

// Reject Inbound Call Endpoint - No change needed here, logic seems okay
app.post("/api/calls/reject/:callId", isAuthenticated, async (req, res) => {
    try {
        const { callId } = req.params;
        const call = callLogsMap.get(callId);
        if (!call) { return res.status(404).json({ error: "Call not found in active memory" }); }
        // Permission Check (optional)
        // if (call.user_email !== req.user.email && req.user.role !== 'admin') { ... }
        if (call.direction !== "inbound") { return res.status(400).json({ error: "Not an inbound call" }); }
        if (call.status !== 'ringing') { return res.status(400).json({ error: `Call status is ${call.status}, cannot reject.` }); }
        if (!call.monitor?.controlUrl) { return res.status(404).json({ error: "No control URL available for this call yet." }); }

        console.log(`User ${req.user.email} rejecting inbound call ${callId}`);
        await axios.post(
            call.monitor.controlUrl,
            { type: "end-call", reason: "rejected" },
            { headers: { Authorization: `Bearer ${VAPI_API_KEY}`, "Content-Type": "application/json" } }
        );
        // Vapi webhook should confirm status change to 'completed'/'ended'
        // Optimistically update
        call.status = "rejecting"; // Intermediate state
        callLogsMap.set(callId, call);
        notifyClients(call);
        console.log(`Reject request sent for call ${callId}`);
        return res.json({ message: "Call reject request sent", call });
    } catch (error) {
        console.error("Error rejecting call:", error.response?.data || error.message);
        res.status(500).json({ error: error.response?.data?.message || "Failed to reject call" });
    }
});

// End Call (Generic) - *** UPDATED ***
app.post("/api/calls/end/:callId", isAuthenticated, async (req, res) => {
    const { callId } = req.params;
    const userEmail = req.user.email;
    const userRole = req.user.role || 'user';
    let call; // Define call variable in the outer scope

    console.log(`User ${userEmail} attempting to end call: ${callId}`);

    try {
        // --- Find the call and check permissions ---
        call = callLogsMap.get(callId); // Assign to outer scope variable

        if (!call) {
            console.error(`End Call Error: Call ${callId} not found in active memory.`);
            return res.status(404).json({ error: "Call not found in active memory" });
        }

        if (call.user_email !== userEmail && userRole.toLowerCase() !== 'admin') {
            console.warn(`Forbidden: User ${userEmail} attempted to end call ${callId} owned by ${call.user_email}`);
            return res.status(403).json({ error: "Forbidden: You cannot end this call." });
        }

        if (call.status === 'completed' || call.status === 'ended') {
            console.log(`Call ${callId} is already completed/ended.`);
            return res.status(200).json({ message: "Call already ended", call });
        }

        // --- Attempt to end via Vapi Control URL ---
        let vapiEndAttempted = false;
        let vapiEndFailed = false;

        if (call.monitor?.controlUrl) {
            vapiEndAttempted = true;
            try {
                console.log(`Attempting to end call ${callId} via Vapi control URL: ${call.monitor.controlUrl}`);
                await axios.post(
                    call.monitor.controlUrl,
                    { type: "end-call" },
                    { headers: { Authorization: `Bearer ${VAPI_API_KEY}`, "Content-Type": "application/json" } }
                );
                console.log(`Vapi end call command sent successfully for ${callId}. Waiting for webhook confirmation.`);

                // Optimistic UI update to 'ending' state
                call.status = "ending";
                callLogsMap.set(callId, call);
                notifyClients(call);

                // Respond immediately after sending command to Vapi
                // Let webhook handle final state and DB save
                return res.status(200).json({ message: "End call request sent to Vapi", call });

            } catch (vapiError) {
                console.error(`Error sending end command via Vapi control URL for call ${callId}:`, vapiError.response?.data || vapiError.message);
                vapiEndFailed = true;
                // Check if the specific error is that the call already ended
                if (vapiError.response?.data?.message?.includes('Call has already ended')) {
                     console.log(`Vapi reported call ${callId} already ended (during end attempt).`);
                     // Fall through to local cleanup/DB save if webhook might have been missed
                } else {
                    // If Vapi request failed for another reason, we might still proceed to local fallback
                    console.warn(`Vapi control URL failed for call ${callId}. Proceeding with local fallback.`);
                }
            }
        } else {
            console.warn(`No Vapi control URL found for call ${callId}. Proceeding directly with local fallback.`);
            vapiEndFailed = true; // Treat missing URL as a failure to use Vapi control
        }

        // --- Fallback Logic: End locally if Vapi control failed or wasn't available ---
        // This code runs ONLY if:
        // 1. controlUrl was missing.
        // 2. The axios.post to controlUrl failed (for reasons other than already ended, or even if it was).
        if (vapiEndFailed) {
            console.log(`Executing local fallback for ending call ${callId}`);
            call.status = "completed"; // Mark as completed locally
            call.duration = Math.floor((Date.now() - (call.startTime ? new Date(call.startTime) : Date.now())) / 1000);
            call.endTime = new Date(); // Set end time locally
            call.updatedAt = new Date().toISOString();

            console.log(`Locally marked call ${callId} as completed. Duration: ${call.duration}s.`);
            callLogsMap.set(callId, call); // Update map with final local state
            updateActiveCalls();
            notifyClients(call); // Notify frontend of completion

            // Attempt to save this final state to DB as a fallback
            const callData = {
                call_id: call.id,
                user_email: call.user_email || userEmail, // Use call's email or current user
                direction: call.direction,
                phone_number: call.from || call.customer?.number || "N/A", // Get phone number
                status: call.status,
                start_time: call.startTime ? new Date(call.startTime) : new Date(Date.now() - (call.duration*1000)), // Estimate start time if missing
                duration: call.duration,
                agent_id: call.agentId || call.assistantId || null, // Get agent/assistant ID
                notes: call.notes || null
            };

            try {
                await saveCallLog(callData);
                console.log(`Fallback: Saved completed call ${callId} to DB.`);
                return res.status(200).json({ message: "Call ended locally (Vapi control failed or unavailable)", call });
            } catch (dbError) {
                console.error(`Fallback: Error saving call ${callId} to DB:`, dbError);
                // Still return success to frontend, but log the DB error
                return res.status(500).json({ error: "Call ended locally, but failed to save log to database." });
            }
        }

    } catch (error) { // Catch errors before Vapi attempt (finding call, permissions)
        console.error(`Outer error ending call ${callId}:`, error.message);
        res.status(500).json({ error: "An unexpected error occurred while trying to end the call." });
    }
});


// --- Global Error Handler ---
app.use((err, req, res, next) => {
    console.error("Global Error Handler:", err.stack);
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