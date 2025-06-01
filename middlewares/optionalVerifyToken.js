const jwt = require('jsonwebtoken');
const User = require('../schemas/userSchema');
const mongoose = require('mongoose');
const SECRET_KEY = process.env.SECRET_KEY;

async function optionalVerifyToken(req, res, next) {
  console.log('[OPTIONAL_VERIFY_TOKEN_DEBUG] Middleware entered. Path:', req.originalUrl);
  const authHeader = req.headers['authorization'];
  const tokenFromHeader = authHeader && authHeader.split(' ')[1];
  const tokenFromCookie = req.cookies && req.cookies.token;
  const token = tokenFromHeader || tokenFromCookie;

  console.log('[OPTIONAL_VERIFY_TOKEN_DEBUG] Token from header:', tokenFromHeader);
  console.log('[OPTIONAL_VERIFY_TOKEN_DEBUG] Token from cookie:', tokenFromCookie);
  console.log('[OPTIONAL_VERIFY_TOKEN_DEBUG] Final token:', token);

  if (!token) {
    console.log('[OPTIONAL_VERIFY_TOKEN_DEBUG] No token found. Proceeding without user.');
    return next();
  }

  console.log('[OPTIONAL_VERIFY_TOKEN_DEBUG] Token found. Attempting to verify...');
  jwt.verify(token, SECRET_KEY, async (err, decoded) => { 
    if (err) {
      console.error('[OPTIONAL_VERIFY_TOKEN_DEBUG] JWT verify error:', err.message, '| Token was:', token);
      console.log('[OPTIONAL_VERIFY_TOKEN_DEBUG] Proceeding without user due to JWT error.');
    } else {
      console.log('[OPTIONAL_VERIFY_TOKEN_DEBUG] JWT verification successful. Decoded:', decoded);
    
      if (decoded && decoded.id) {
        try {
          let user = null;
          
          if (mongoose.Types.ObjectId.isValid(decoded.id)) {
            console.log('[OPTIONAL_VERIFY_TOKEN_DEBUG] Attempting to find user by ObjectId:', decoded.id);
            user = await User.findById(decoded.id).lean();
          }

         
          if (!user) {
            console.log('[OPTIONAL_VERIFY_TOKEN_DEBUG] User not found by ObjectId, attempting by UUID:', decoded.id);
            user = await User.findOne({ uuid: decoded.id }).lean();
          }

          if (user) {
            req.user = user;
            console.log('[OPTIONAL_VERIFY_TOKEN_DEBUG] User data loaded from DB.');
          } else {
            console.log('[OPTIONAL_VERIFY_TOKEN_DEBUG] User not found in DB by either ObjectId or UUID:', decoded.id, '. Proceeding without user.');
          }
        } catch (dbError) {
          console.error('[OPTIONAL_VERIFY_TOKEN_DEBUG] DB error fetching user:', dbError);
        }
      } else {
        console.log('[OPTIONAL_VERIFY_TOKEN_DEBUG] JWT decoded payload is missing id. Proceeding without user. Decoded:', decoded);
      }
    }
    console.log('[OPTIONAL_VERIFY_TOKEN_DEBUG] Calling next().');
    next();
  });
}

module.exports = optionalVerifyToken;