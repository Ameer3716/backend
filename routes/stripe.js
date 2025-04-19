// routes/stripe.js
const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5174';
// async function testStripe() {
//   try {
//     const prices = await stripe.prices.list({ limit: 3 });
//     console.log(prices);
//   } catch (error) {
//     console.error('Stripe API Error:', error);
//   }
// }

// testStripe();

// Map your planId to Stripe Price IDs (update these with your real Stripe Price IDs)
const planPrices = {
  starter: "price_1R5b8BHrl8FAmdkYtODHPJcF",
  pro: "price_1R5b9nHrl8FAmdkY051fcwxw",
  growth: "price_1R5b98Hrl8FAmdkYYLMdMUGg",
  agency: "price_1R5bA7Hrl8FAmdkYsCqSAwgm"
};

function getPriceIdForPlan(planId) {
  console.log(`Received planId: ${planId}`);
  console.log(`Mapped priceId: ${planPrices[planId]}`);
  return planPrices[planId] || null;
}

router.post('/create-checkout-session', async (req, res) => {
    const { planId, email } = req.body;
    const priceId = getPriceIdForPlan(planId);
    
    if (!priceId) {
      console.error(`Invalid plan ID received: ${planId}`);
      return res.status(400).json({ error: "Invalid plan ID" });
    }
   
    try {
      console.log(`Creating session for ${email} with priceId ${priceId}`);
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        mode: 'subscription',
        customer_email: email,
        billing_address_collection: 'auto',  // This helps avoid forcing postal address collection
        line_items: [{ price: priceId, quantity: 1 }],
        metadata: { plan: planId },
        success_url: `${frontendUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${frontendUrl}/cancel`,
      });
    
      console.log("Session created:", session.id);
      res.json({ sessionId: session.id });
    
    } catch (error) {
      console.error("Error creating checkout session:", error);
      res.status(500).json({ error: error.message });
    }
  });

module.exports = router;
    