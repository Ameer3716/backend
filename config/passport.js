// config/passport.js
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
// Ensure the path to your db/users file is correct relative to this config file
const { findUserByGoogleId, createUser, findUserById } = require('../db/users');

if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !process.env.GOOGLE_CALLBACK_URL) {
    console.error("🔴 FATAL ERROR: Missing Google OAuth environment variables (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_CALLBACK_URL).");
    // Optionally exit if these are absolutely critical for startup
    // process.exit(1);
} else {
    console.log("ℹ️ Google OAuth config loaded."); // Confirm vars are present at load time
}


passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: process.env.GOOGLE_CALLBACK_URL // Reads from .env
},
// This is the verify callback function that runs after Google authenticates the user
async (accessToken, refreshToken, profile, done) => {
  try {
    // Log 1: Attempting to find the user
    console.log(`🔵 Passport Verify: Attempting to find user by Google ID: ${profile.id}`);

    let user = await findUserByGoogleId(profile.id);

    if (!user) {
      // Log 2: User not found, attempting creation
      console.log(`🟡 Passport Verify: User NOT found with Google ID ${profile.id}. Attempting to create user.`);

      // Prepare user data, ensuring email exists
      const userEmail = profile.emails?.[0]?.value; // Safely get the primary email
      if (!userEmail) {
          const errMsg = `Cannot create user - email not found in Google profile for ID ${profile.id}`;
          console.error(`🔴 Passport Verify Error: ${errMsg}`);
          // Signal error to Passport, preventing login
          return done(new Error(errMsg), null);
      }

      const newUserDetails = {
        googleId: profile.id,
        email: userEmail,
        name: profile.displayName || 'User', // Use display name or a default
        phone: null // Phone is usually not included in basic Google scopes
      };

      console.log(`🟡 Passport Verify: Calling createUser with data:`, { googleId: newUserDetails.googleId, email: newUserDetails.email, name: newUserDetails.name });

      // Call the createUser function from db/users.js
      user = await createUser(newUserDetails);

      // Log 3: User creation function finished
      console.log(`🟢 Passport Verify: createUser function finished. DB User object:`, {id: user?.id, email: user?.email}); // Log only essential info

    } else {
      // Log 4: User was found
      console.log(`🟢 Passport Verify: User FOUND in DB. ID: ${user.id}, Email: ${user.email}`);
    }

    // Pass the final user object (either found or newly created) to Passport's done callback
    // This user object will be attached to req.user
    done(null, user);

  } catch (err) {
    // Log 5: Catch any unexpected errors during the process
    console.error(`🔴 Passport Verify Strategy Error: An error occurred for Google ID ${profile?.id}`, err);
    // Signal error to Passport
    done(err, null);
  }
}));

// --- Serialization and Deserialization ---

// Determines which data of the user object should be stored in the session.
// Called once after successful authentication. Storing only the user ID is common.
passport.serializeUser((user, done) => {
  if (!user || typeof user.id === 'undefined') {
       console.error('🔴 Passport Serialize Error: Invalid user object received.', user);
       return done(new Error('Invalid user object for serialization'), null);
  }
  console.log(`🔵 Passport Serialize: Storing user ID in session: ${user.id}`);
  done(null, user.id); // Store only the user's unique database ID in the session
});

// Retrieves user data from the database based on the ID stored in the session.
// Called on subsequent requests when Passport tries to populate req.user.
passport.deserializeUser(async (id, done) => {
  try {
    console.log(`🔵 Passport Deserialize: Looking up user ID from session: ${id}`);
    const user = await findUserById(id); // Fetch user details using the ID from the session
    if (!user) {
         console.warn(`🟡 Passport Deserialize Warning: User not found for ID: ${id}. Session might be stale.`);
         return done(null, false); // Indicate user not found for this session ID
    }
    console.log(`🟢 Passport Deserialize: User found and attached to req.user:`, {id: user.id, email: user.email});
    done(null, user); // Attach the full user object to req.user
  } catch (err) {
    console.error(`🔴 Passport Deserialize Error for ID ${id}:`, err);
    done(err, null);
  }
});

module.exports = passport;