
const { getDb } = require('../lib/db');
module.exports = async (req, res) => {
  res.setHeader('Cache-Control','no-store');
  if (req.method !== 'GET') return res.status(405).json({error:'Method not allowed'});
  const id = String(req.query?.id || '').trim().slice(0,150);
  if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) return res.status(400).json({error:'Valid transaction reference required.'});
  try {
    const db = await getDb();
    const t = await db.collection('transactions').findOne({checkoutRequestId:id},{projection:{status:1,amount:1,amountPaid:1,currency:1,mpesaReceiptNumber:1,resultDescription:1,createdAt:1,updatedAt:1}});
    if (!t) return res.status(404).json({error:'Transaction not found yet. Please refresh shortly.'});
    return res.status(200).json({status:t.status,amount:t.amountPaid || t.amount,currency:t.currency || 'KES',receipt:t.mpesaReceiptNumber || null,message:t.resultDescription || null,updatedAt:t.updatedAt});
  } catch(e) { console.error('Transaction status error:',e.message); return res.status(500).json({error:'Unable to check transaction status.'}); }
};
