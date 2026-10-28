const { getDb } = require('../../lib/db');
const { requireAdmin } = require('../../lib/auth');
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!requireAdmin(req, res)) return;
  try {
    const db = await getDb();
    const rows = await db.collection('transactions').find({}).sort({ createdAt: -1 }).limit(250).toArray();
    return res.status(200).json({ transactions: rows.map(x => ({ ...x, _id: x._id.toString() })) });
  } catch (e) {
    console.error('Transactions read error:', e.message);
    return res.status(500).json({ error: 'Unable to load transactions. Check database configuration.' });
  }
};