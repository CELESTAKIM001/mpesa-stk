const { getDb } = require('../lib/db');
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  // Safaricom expects a quick acknowledgement. Persist callback details before acknowledging.
  try {
    const callback = req.body?.Body?.stkCallback;
    if (callback) {
      const db = await getDb();
      const success = Number(callback.ResultCode) === 0;
      const items = callback.CallbackMetadata?.Item || [];
      const meta = Object.fromEntries(items.map(x => [x.Name, x.Value]));
      const update = {
        status: success ? 'paid' : 'failed',
        resultCode: callback.ResultCode,
        resultDescription: String(callback.ResultDesc || '').slice(0,300),
        merchantRequestId: callback.MerchantRequestID || null,
        checkoutRequestId: callback.CheckoutRequestID || null,
        updatedAt: new Date()
      };
      if (success) {
        update.amountPaid = Number(meta.Amount || 0);
        update.mpesaReceiptNumber = String(meta.MpesaReceiptNumber || '');
        update.paidPhone = String(meta.PhoneNumber || '');
        if (meta.TransactionDate) update.transactionDate = String(meta.TransactionDate);
      }
      await db.collection('transactions').updateOne(
        { checkoutRequestId: callback.CheckoutRequestID },
        { $set: update, $setOnInsert: { createdAt: new Date(), currency:'KES', purpose:'M-Pesa payment' } },
        { upsert: true }
      );
    }
  } catch (e) { console.error('M-Pesa callback persistence failed:', e.message); }
  return res.status(200).json({ ResultCode: 0, ResultDesc: 'Success' });
};