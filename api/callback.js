const { getDb } = require('../lib/db');
const { sendMail } = require('../lib/mailer');

const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const callback = req.body?.Body?.stkCallback;
  const checkoutRequestId = String(callback?.CheckoutRequestID || '').trim();
  if (!callback || !checkoutRequestId) {
    console.error('M-Pesa callback missing callback body or checkout reference');
    // Invalid payloads cannot be associated with a payment; acknowledge to avoid pointless retries.
    return res.status(200).json({ ResultCode: 0, ResultDesc: 'Acknowledged' });
  }

  try {
    const col = (await getDb()).collection('transactions');
    const before = await col.findOne({ checkoutRequestId });
    const success = Number(callback.ResultCode) === 0;
    const description = String(callback.ResultDesc || '').slice(0, 300);
    const lowerDesc = description.toLowerCase();
    const cancelled = Number(callback.ResultCode) === 1032 || /cancel|canceled/.test(lowerDesc);
    const items = Array.isArray(callback.CallbackMetadata?.Item) ? callback.CallbackMetadata.Item : [];
    const meta = Object.fromEntries(items.filter(x => x && x.Name).map(x => [x.Name, x.Value]));

    // A success callback must include receipt metadata; otherwise do not falsely mark it paid.
    if (success && (!meta.MpesaReceiptNumber || !Number.isFinite(Number(meta.Amount)))) {
      console.error('Successful M-Pesa callback missing receipt/amount metadata for checkout', checkoutRequestId);
      return res.status(500).json({ ResultCode: 1, ResultDesc: 'Required payment metadata missing' });
    }

    const now = new Date();
    const status = success ? 'paid' : (cancelled ? 'cancelled' : 'failed');
    const update = {
      status,
      resultCode: callback.ResultCode ?? null,
      resultDescription: description || (success ? 'Payment confirmed successfully.' : 'Safaricom reported that the payment was not completed.'),
      merchantRequestId: callback.MerchantRequestID || before?.merchantRequestId || null,
      checkoutRequestId,
      updatedAt: now
    };
    if (success) {
      update.amountPaid = Number(meta.Amount);
      update.mpesaReceiptNumber = String(meta.MpesaReceiptNumber).slice(0, 40);
      if (meta.PhoneNumber) update.paidPhone = String(meta.PhoneNumber).slice(0, 20);
      if (meta.TransactionDate) update.transactionDate = String(meta.TransactionDate).slice(0, 20);
    }

    // If a callback arrives before the STK API finishes saving its response, upsert a record.
    // The STK handler uses $setOnInsert so it will not overwrite a final callback status.
    await col.updateOne(
      { checkoutRequestId },
      { $set: update, $setOnInsert: { createdAt: now, currency: 'KES', purpose: 'M-Pesa payment', callbackCreatedRecord: !before } },
      { upsert: true }
    );

    // Email is best-effort; payment status remains authoritative even if SMTP is down.
    // A production queue/atomic email claim is recommended for strict exactly-once delivery.
    if (success && before?.email && !before.receiptEmailedAt && meta.MpesaReceiptNumber) {
      try {
        const amount = Number(meta.Amount).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const receipt = String(meta.MpesaReceiptNumber).slice(0, 40);
        const safeName = String(before.name || 'Customer').slice(0, 150);
        await sendMail({
          to: before.email,
          subject: `Geopram payment receipt - ${receipt}`,
          text: `Geopram Technologies payment receipt\nName: ${safeName}\nAmount: KES ${amount}\nM-Pesa receipt: ${receipt}\nReference: ${checkoutRequestId}\nStatus: Successful\nThank you.`,
          html: `<div style="font-family:Arial,sans-serif;color:#172033"><h2>Geopram Technologies</h2><p>Your payment has been confirmed.</p><p>Name: <b>${escapeHtml(safeName)}</b></p><p>Amount: <b>KES ${amount}</b></p><p>M-Pesa receipt: <b>${escapeHtml(receipt)}</b></p><p>Reference: ${escapeHtml(checkoutRequestId)}</p><p>Thank you.</p></div>`
        });
        await col.updateOne({ checkoutRequestId, receiptEmailedAt: { $exists: false } }, { $set: { receiptEmailedAt: new Date(), receiptEmailedTo: before.email } });
      } catch (mailErr) {
        console.error('Automatic receipt email failed:', mailErr.message);
      }
    }
    return res.status(200).json({ ResultCode: 0, ResultDesc: 'Success' });
  } catch (e) {
    console.error('M-Pesa callback persistence failed:', e.message);
    // Return non-2xx when persistence failed so the callback can be investigated/retried.
    return res.status(500).json({ ResultCode: 1, ResultDesc: 'Could not persist callback' });
  }
};
