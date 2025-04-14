// middlewares/isAuthenticated.js
function isAuthenticated(req, res, next) {
    if (req.isAuthenticated && req.isAuthenticated()) {
      return next();
    }
    res.status(401).json({ error: 'Unauthorized. Please log in.' });
  }
  
  module.exports = isAuthenticated;
  