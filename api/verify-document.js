const { getDb } = require('../lib/db');
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ valid: false, error: 'Method not allowed' }); }
  const doc = String(req.query?.doc || '').trim().slice(0, 120);
  const token = String(req.query?.token || '').trim().slice(0, 120);
  if (!doc || !token) return res.status(400).json({ valid: false, error: 'Document number and verification token are required.' });
  try {
    const db = await getDb();
    const d = await db.collection('documents').findOne({ documentNumber: doc, verificationToken: token }, { projection: { _id: 0, type: 1, documentNumber: 1, recipient: 1, description: 1, purpose: 1, amount: 1, currency: 1, transactionId: 1, mpesaReceiptNumber: 1, issuedAt: 1, createdAt: 1, status: 1 } });
    if (!d || d.status !== 'issued') return res.status(404).json({ valid: false, error: 'Document not found or verification details are invalid.' });
    return res.status(200).json({ valid: true, document: d });
  } catch (e) { console.error('Document verification lookup failed:', e.message); return res.status(500).json({ valid: false, error: 'Verification is temporarily unavailable.' }); }
};
