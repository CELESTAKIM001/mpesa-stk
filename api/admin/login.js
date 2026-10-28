const { jwt, setSession, clearSession } = require('../../lib/auth');
const crypto = require('crypto');
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET') {
    clearSession(res);
    return res.status(200).json({ ok: true, message: 'Admin authentication endpoint' });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { email, password, action } = req.body || {};
  if (action === 'logout') { clearSession(res); return res.status(200).json({ ok: true }); }
  const expectedEmail = process.env.ADMIN_EMAIL || '';
  const expectedPassword = process.env.ADMIN_PASSWORD || '';
  const safeEqual = (a, b) => {
    const aa = Buffer.from(String(a || ''));
    const bb = Buffer.from(String(b || ''));
    return aa.length === bb.length && aa.length > 0 && crypto.timingSafeEqual(aa, bb);
  };
  if (!expectedEmail || !expectedPassword || !process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    return res.status(500).json({ error: 'Admin environment variables are not configured.' });
  }
  if (!safeEqual(String(email || '').toLowerCase(), expectedEmail.toLowerCase()) || !safeEqual(password, expectedPassword)) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }
  const token = jwt.sign({ role: 'admin', email: expectedEmail }, process.env.SESSION_SECRET, {
    algorithm: 'HS256', expiresIn: '8h', issuer: 'geopram'
  });
  setSession(res, token);
  return res.status(200).json({ ok: true, email: expectedEmail });
};