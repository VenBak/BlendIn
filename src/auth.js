const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { User } = require('./models');

const COOKIE = 'bi_session';
let SECRET = process.env.JWT_SECRET;
if (!SECRET) {
  SECRET = crypto.randomBytes(32).toString('hex');
  console.warn('[auth] JWT_SECRET is not set; using a random one, so sessions reset on every restart.');
}
const secure = process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : process.env.NODE_ENV === 'production';

function setSession(res, user) {
  const token = jwt.sign({ sub: String(user._id) }, SECRET, { expiresIn: '30d' });
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure, maxAge: 30 * 864e5 });
}
function clearSession(res) {
  res.clearCookie(COOKIE, { httpOnly: true, sameSite: 'lax', secure });
}
async function userFromRequest(req) {
  const token = req.cookies && req.cookies[COOKIE];
  if (!token) return null;
  try {
    const { sub } = jwt.verify(token, SECRET);
    return await User.findById(sub);
  } catch {
    return null;
  }
}
module.exports = { setSession, clearSession, userFromRequest };
