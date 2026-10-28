const { requireAdmin } = require('../../lib/auth');
module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!requireAdmin(req, res)) return;
  return res.status(200).json({ ok: true, email: process.env.ADMIN_EMAIL });
};