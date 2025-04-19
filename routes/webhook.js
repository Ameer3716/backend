// routes/webhook.js
const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
const { saveSubscriptionToDb } = require('../db/subscriptions');
const { saveCallLog } = require('../db/callLogs');
const pool = require('../db/db'); // to query users table

router.post('/', express.raw({ type: 'application/json' }), async (req, res) => {
  console.log('--- Webhook Received ---');
  console.log('Raw body:', req.body.toString());
  
  const sig = req.headers['stripe-signature'];
  console.log('Stripe-Signature header:', sig);

  let event;
  if (!endpointSecret) {
    console.error("FATAL: STRIPE_WEBHOOK_SECRET is not set in environment variables!");
    return res.status(500).send("Webhook configuration error.");
}
if (!sig) {
    console.error("Webhook Error: Missing stripe-signature header");
    return res.status(400).send("Missing Stripe signature.");
}

  try {
    // VERIFY the event signature
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    console.log('Webhook verified successfully. Event type:', event.type);

  } catch (err) {
    console.error(`Webhook signature verification failed: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // If no event.type but there is a call, assume it's an inbound call event
  if (!event.type && event.call) {
    event.type = 'call.inbound.completed';
  }

  console.log('Webhook event payload:', JSON.stringify(event, null, 2));
  console.log(`Processing event type: ${event.type}`);

  // Process subscription events
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    console.log("Received checkout.session.completed event:", JSON.stringify(session, null, 2));
    
    const plan = (session.metadata && session.metadata.plan) || 'unknown';
    const expiryDate = new Date();
    expiryDate.setMonth(expiryDate.getMonth() + 1);
    const expiryDateString = expiryDate.toISOString().slice(0, 19).replace('T', ' ');
    
    const subscriptionData = {
      email: session.customer_email,
      subscriptionId: session.subscription,
      plan: plan,
      status: 'active',
      price: session.amount_total ? session.amount_total / 100 : 0,
      stripeEventId: event.id,
      expiryDate: expiryDateString
    };
    
    console.log('Extracted subscription data:', subscriptionData);
    
    try {
      await saveSubscriptionToDb(subscriptionData);
      console.log('Subscription saved successfully');
    } catch (error) {
      console.error('Error saving subscription:', error);
    }
  }
  
  // Process inbound call events
  if (event.type === 'call.inbound.completed') {
    const callEvent = event.data.object;
    console.log("Received inbound call event:", JSON.stringify(callEvent, null, 2));
    
    let userEmail = "N/A";
    if (callEvent.customer && callEvent.customer.number) {
      try {
        const [users] = await pool.execute("SELECT email FROM users WHERE phone = ?", [callEvent.customer.number]);
        if (users.length > 0) {
          userEmail = users[0].email;
        }
        console.log(`Mapped phone ${callEvent.customer.number} to email: ${userEmail}`);
      } catch (err) {
        console.error("Error mapping user by phone:", err);
      }
    }
    
    const callData = {
      call_id: callEvent.id,
      user_email: userEmail,
      direction: callEvent.type.includes('inbound') ? 'inbound' : 'outbound',
      phone_number: (callEvent.customer && callEvent.customer.number) || "N/A",
      status: callEvent.status,
      start_time: callEvent.createdAt ? new Date(callEvent.createdAt) : new Date(),
      duration: callEvent.duration || 0,
      agent_id: callEvent.agentId || null,
      notes: null
    };
    
    console.log("Saving inbound call log from webhook:", callData);
    try {
      await saveCallLog(callData);
      console.log("Inbound call log saved successfully.");
    } catch (error) {
      console.error("Error saving inbound call log:", error);
    }
  }
  
  res.json({ received: true });
});

module.exports = router;
