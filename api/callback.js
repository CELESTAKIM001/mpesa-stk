const { getDb } = require('../lib/db');
const { sendMail } = require('../lib/mailer');
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
        status: success ? 'paid' : (/cancel/i.test(String(callback.ResultDesc||'')) ? 'cancelled' : 'failed'),
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
      const col=db.collection('transactions');
      const before=await col.findOne({checkoutRequestId:callback.CheckoutRequestID});
      await col.updateOne(
        { checkoutRequestId: callback.CheckoutRequestID },
        { $set: update, $setOnInsert: { createdAt: new Date(), currency:'KES', purpose:'M-Pesa payment' } },
        { upsert: true }
      );
      if(success && before?.email && !before.receiptEmailedAt) {
        try {
          const amount=Number(meta.Amount||before.amount||0).toLocaleString('en-KE',{minimumFractionDigits:2,maximumFractionDigits:2});
          const receipt=String(meta.MpesaReceiptNumber||'Not supplied');
          const text=`Geopram Technologies payment receipt\nName: ${before.name||'Customer'}\nAmount: KES ${amount}\nM-Pesa receipt: ${receipt}\nReference: ${callback.CheckoutRequestID}\nStatus: Successful\nThank you.`;
          await sendMail({to:before.email,subject:`Geopram payment receipt - ${receipt}`,text,html:`<div style="font-family:Arial,sans-serif;color:#172033"><h2>Geopram Technologies</h2><p>Your payment has been confirmed.</p><p>Amount: <b>KES ${amount}</b></p><p>M-Pesa receipt: ${receipt}</p><p>Reference: ${callback.CheckoutRequestID}</p><p>Thank you.</p></div>`});
          await col.updateOne({checkoutRequestId:callback.CheckoutRequestID},{$set:{receiptEmailedAt:new Date(),receiptEmailedTo:before.email}});
        } catch(mailErr) { console.error('Automatic receipt email failed:',mailErr.message); }
      }
    }
  } catch (e) { console.error('M-Pesa callback persistence failed:', e.message); }
  return res.status(200).json({ ResultCode: 0, ResultDesc: 'Success' });
};