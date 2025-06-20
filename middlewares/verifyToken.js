const jwt = require('jsonwebtoken');
const User = require('../schemas/userSchema');
const mongoose = require('mongoose'); 
const SECRET_KEY = process.env.SECRET_KEY;

async function verifyToken(req, res, next) { 
  console.log('[VERIFY_TOKEN_DEBUG] Middleware entered. Path:', req.originalUrl);
  const authHeader = req.headers['authorization'];
  const tokenFromHeader = authHeader && authHeader.split(' ')[1];
  const tokenFromCookie = req.cookies && req.cookies.token;
  const token = tokenFromHeader || tokenFromCookie;

  console.log('[VERIFY_TOKEN_DEBUG] Token from header:', tokenFromHeader);
  console.log('[VERIFY_TOKEN_DEBUG] Token from cookie:', tokenFromCookie);
  console.log('[VERIFY_TOKEN_DEBUG] Final token:', token);
  console.log('[VERIFY_TOKEN_DEBUG] SECRET_KEY used:', SECRET_KEY ? 'Exists' : 'MISSING or undefined!');

  if (!token) {
    console.log('[VERIFY_TOKEN_DEBUG] No token found. Path:', req.originalUrl, '. Redirecting to /login.');
    return res.redirect('/login');
  }

  console.log('[VERIFY_TOKEN_DEBUG] Token found. Attempting to verify...');
  jwt.verify(token, SECRET_KEY, async (err, decoded) => { 
    if (err) {
      console.error('[VERIFY_TOKEN_DEBUG] JWT verify error:', err.message, '| Token was:', token, '| Path:', req.originalUrl);
      console.log('[VERIFY_TOKEN_DEBUG] Clearing cookie and redirecting to /login due to JWT error.');
      return res.clearCookie('token').redirect('/login');
    }
    console.log('[VERIFY_TOKEN_DEBUG] JWT verification successful. Decoded:', decoded);

    if (!decoded || !decoded.id) { 
        console.error('[VERIFY_TOKEN_DEBUG] JWT decoded payload is missing id (uuid). Decoded:', decoded, '| Path:', req.originalUrl);
        console.log('[VERIFY_TOKEN_DEBUG] Clearing cookie and redirecting to /login due to missing id in token payload.');
        return res.clearCookie('token').redirect('/login');
    }
    try {
      let user = null;
  
      if (mongoose.Types.ObjectId.isValid(decoded.id)) {
        console.log('[VERIFY_TOKEN_DEBUG] Attempting to find user by ObjectId:', decoded.id);
        user = await User.findById(decoded.id).lean();
      }


      if (!user) {
        console.log('[VERIFY_TOKEN_DEBUG] User not found by ObjectId, attempting by UUID:', decoded.id);
        user = await User.findOne({ uuid: decoded.id }).lean();
      }
      
      if (!user) {
        console.log('[VERIFY_TOKEN_DEBUG] User not found in DB by either ObjectId or UUID:', decoded.id, '| Path:', req.originalUrl);
        console.log('[VERIFY_TOKEN_DEBUG] Clearing cookie and redirecting to /login.');
        return res.clearCookie('token').redirect('/login');
      }
      req.user = user;
      console.log('[VERIFY_TOKEN_DEBUG] User data loaded from DB. Calling next().');
      next();
    } catch (dbError) {
      console.error('[VERIFY_TOKEN_DEBUG] DB error fetching user:', dbError);
      return res.status(500).send('Internal Server Error');
    }
  });
}

module.exports = verifyToken;
