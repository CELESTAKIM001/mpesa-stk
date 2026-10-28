const { getDb } = require('../lib/db');
const { sendMail } = require('../lib/mailer');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const callback = req.body?.Body?.stkCallback;
    if (!callback) {
      // Acknowledge safely so Safaricom does not repeatedly send malformed payloads.
      console.error('M-Pesa callback received without stkCallback body');
      return res.status(200).json({ ResultCode: 0, ResultDesc: 'Acknowledged' });
    }
    const checkoutRequestId = String(callback.CheckoutRequestID || '').trim();
    if (!checkoutRequestId) {
      console.error('M-Pesa callback missing CheckoutRequestID');
      return res.status(200).json({ ResultCode: 0, ResultDesc: 'Acknowledged' });
    }

    const db = await getDb();
    const col = db.collection('transactions');
    const success = Number(callback.ResultCode) === 0;
    const description = String(callback.ResultDesc || '').slice(0, 300);
    const lowerDesc = description.toLowerCase();
    const cancelled = /cancel|request cancelled|cancelled by user|canceled/.test(lowerDesc) || Number(callback.ResultCode) === 1032;
    const items = Array.isArray(callback.CallbackMetadata?.Item) ? callback.CallbackMetadata.Item : [];
    const meta = Object.fromEntries(items.filter(x => x && x.Name).map(x => [x.Name, x.Value]));
    const before = await col.findOne({ checkoutRequestId });

    const update = {
      status: success ? 'paid' : (cancelled ? 'cancelled' : 'failed'),
      resultCode: callback.ResultCode ?? null,
      resultDescription: description || (success ? 'Payment confirmed successfully.' : 'Safaricom reported that the payment was not completed.'),
      merchantRequestId: callback.MerchantRequestID || before?.merchantRequestId || null,
      checkoutRequestId,
      updatedAt: new Date()
    };
    if (success) {
      if (meta.Amount !== undefined) update.amountPaid = Number(meta.Amount);
      if (meta.MpesaReceiptNumber) update.mpesaReceiptNumber = String(meta.MpesaReceiptNumber).slice(0, 40);
      if (meta.PhoneNumber) update.paidPhone = String(meta.PhoneNumber).slice(0, 20);
      if (meta.TransactionDate) update.transactionDate = String(meta.TransactionDate).slice(0, 20);
    }

    await col.updateOne(
      { checkoutRequestId },
      { $set: update, $setOnInsert: { createdAt: new Date(), currency: 'KES', purpose: 'M-Pesa payment' } },
      { upsert: true }
    );

    // Send a receipt only for a confirmed success, and avoid duplicate sends on repeated callbacks.
    if (success && before?.email && !before.receiptEmailedAt && meta.MpesaReceiptNumber) {
      try {
        const amountValue = Number(meta.Amount ?? before.amount ?? 0);
        const amount = amountValue.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const receipt = String(meta.MpesaReceiptNumber);
        const reference = checkoutRequestId;
        const safeName = String(before.name || 'Customer').slice(0, 150);
        const htmlEscape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
        await sendMail({
          to: before.email,
          subject: `Geopram payment receipt - ${receipt}`,
          text: `Geopram Technologies payment receipt\nName: ${safeName}\nAmount: KES ${amount}\nM-Pesa receipt: ${receipt}\nReference: ${reference}\nStatus: Successful\nThank you.`,
          html: `<div style="font-family:Arial,sans-serif;color:#172033"><h2>Geopram Technologies</h2><p>Your payment has been confirmed.</p><p>Name: <b>${htmlEscape(safeName)}</b></p><p>Amount: <b>KES ${amount}</b></p><p>M-Pesa receipt: ${htmlEscape(receipt)}</p><p>Reference: ${htmlEscape(reference)}</p><p>Thank you.</p></div>`
        });
        await col.updateOne({ checkoutRequestId, receiptEmailedAt: { $exists: false } }, { $set: { receiptEmailedAt: new Date(), receiptEmailedTo: before.email } });
      } catch (mailErr) {
        console.error('Automatic receipt email failed:', mailErr.message);
      }
    }
  } catch (e) {
    console.error('M-Pesa callback persistence failed:', e.message);
  }
  // Safaricom callback endpoint should return HTTP 200 after handling the callback.
  return res.status(200).json({ ResultCode: 0, ResultDesc: 'Success' });
};
