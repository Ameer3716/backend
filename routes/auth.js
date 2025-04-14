// routes/auth.js
const express = require('express');
const passport = require('passport');
const router = express.Router();

// Start Google OAuth login
router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

// Callback URL after Google authentication
router.get('/google/callback',
  passport.authenticate('google', { failureRedirect: 'http://localhost:5174/login' }),
  (req, res) => {
    // Successful authentication; redirect to your dashboard or home page.
    res.redirect('http://localhost:5174/dashboard');
  }
);

// Logout route
router.get('/logout', (req, res, next) => {
  req.logout(err => {
    if (err) { return next(err); }
    res.redirect('/');
  });
});

module.exports = router;
