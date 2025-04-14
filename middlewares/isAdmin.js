// middlewares/isAdmin.js
function isAdmin(req, res, next) {
  // Assuming your user object includes a "role" property
  if (req.isAuthenticated && req.isAuthenticated() && req.user.role === "admin") {
    return next();
  }
  res.status(403).json({ error: "Forbidden. Admins only." });
}

module.exports = isAdmin;
