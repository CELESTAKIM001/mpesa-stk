const jwt = require('jsonwebtoken');
const COOKIE = 'geopram_admin';
function cookieOptions() {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `Path=/; HttpOnly; SameSite=Strict; Max-Age=28800${secure}`;
}
function setSession(res, token) {
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; ${cookieOptions()}`);
}
function clearSession(res) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`);
}
function tokenFrom(req) {
  const cookies = (req.headers.cookie || '').split(';').map(v => v.trim());
  const entry = cookies.find(v => v.startsWith(COOKIE + '='));
  return entry ? entry.slice(COOKIE.length + 1) : '';
}
function requireAdmin(req, res) {
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    res.status(500).json({ error: 'Admin session is not configured securely.' }); return false;
  }
  try {
    const payload = jwt.verify(tokenFrom(req), process.env.SESSION_SECRET, { algorithms: ['HS256'], issuer: 'geopram' });
    if (payload.role !== 'admin' || payload.email !== process.env.ADMIN_EMAIL) throw new Error('invalid role');
    return true;
  } catch {
    res.status(401).json({ error: 'Please sign in to continue.' }); return false;
  }
}
module.exports = { jwt, setSession, clearSession, requireAdmin };