const { getDb } = require('../lib/db');

const STATUS_MESSAGES = {
  pending: 'Your payment request is awaiting Safaricom confirmation. Do not initiate another request yet.',
  paid: 'Payment confirmed successfully.',
  failed: 'Safaricom could not complete the payment. Check the M-Pesa message on your phone before trying again.',
  cancelled: 'The payment was cancelled. You can start a new request if you did not complete it.',
  timeout: 'No final confirmation has been received yet. Check your M-Pesa messages before retrying.',
  unknown: 'The payment status is not yet confirmed. Please check again shortly.'
};

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed', allowedMethod: 'GET' });
  }

  // Vercel normally supplies req.query; parse the URL as a fallback without legacy url.parse().
  let id = req.query?.id || req.query?.checkoutRequestId;
  if (!id && typeof req.url === 'string') {
    try {
      const parsed = new URL(req.url, 'https://internal.invalid');
      id = parsed.searchParams.get('id') || parsed.searchParams.get('checkoutRequestId');
    } catch (_) {}
  }
  id = String(id || '').trim().slice(0, 150);
  if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) {
    return res.status(400).json({ error: 'A valid checkout reference is required.' });
  }

  try {
    const db = await getDb();
    const t = await db.collection('transactions').findOne(
      { checkoutRequestId: id },
      { projection: { status: 1, amount: 1, amountPaid: 1, currency: 1, mpesaReceiptNumber: 1, resultDescription: 1, resultCode: 1, createdAt: 1, updatedAt: 1 } }
    );
    if (!t) {
      return res.status(200).json({ status: 'unknown', message: 'The transaction record is not available yet. Please check again shortly.', reference: id });
    }

    const rawStatus = String(t.status || 'unknown').toLowerCase();
    const status = ['paid', 'failed', 'cancelled', 'pending', 'timeout'].includes(rawStatus) ? rawStatus : 'unknown';
    return res.status(200).json({
      status,
      amount: t.amountPaid ?? t.amount ?? null,
      currency: t.currency || 'KES',
      receipt: t.mpesaReceiptNumber || null,
      resultCode: t.resultCode ?? null,
      message: t.resultDescription || STATUS_MESSAGES[status],
      reference: id,
      createdAt: t.createdAt || null,
      updatedAt: t.updatedAt || null
    });
  } catch (e) {
    console.error('Transaction status lookup failed:', e.message);
    return res.status(500).json({ error: 'Unable to check transaction status right now. Please try again shortly.' });
  }
};
