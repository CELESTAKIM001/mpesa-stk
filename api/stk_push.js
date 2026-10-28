const { getDb } = require('../lib/db');
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { phone, amount, name, email, purpose } = req.body || {};
  const phoneStr = String(phone || '').replace(/[\s+]/g,'');
  const value = Number(amount);
  if (!/^254\d{9}$/.test(phoneStr)) return res.status(400).json({ error: 'Phone must be in format 254XXXXXXXXX.' });
  if (!Number.isInteger(value) || value < 1 || value > 250000) return res.status(400).json({ error: 'Enter an amount between KES 1 and 250,000.' });
  const { CONSUMER_KEY, CONSUMER_SECRET, SHORTCODE, PASSKEY, CALLBACK_URL } = process.env;
  if (![CONSUMER_KEY, CONSUMER_SECRET, SHORTCODE, PASSKEY, CALLBACK_URL].every(Boolean)) return res.status(500).json({ error: 'M-Pesa environment variables are incomplete.' });
  try {
    const tokenRes = await fetch('https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials', {
      headers: { Authorization: `Basic ${Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString('base64')}` }
    });
    if (!tokenRes.ok) { console.error('Daraja token request failed:', tokenRes.status); return res.status(502).json({ error: 'Could not connect to M-Pesa. Please try again.' }); }
    const { access_token } = await tokenRes.json();
    if (!access_token) return res.status(502).json({ error: 'M-Pesa did not return an access token.' });
    const timestamp = new Date().toISOString().replace(/[^0-9]/g,'').slice(0,14);
    const password = Buffer.from(`${SHORTCODE}${PASSKEY}${timestamp}`).toString('base64');
    const payload = {
      BusinessShortCode: SHORTCODE, Password: password, Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline', Amount: value, PartyA: phoneStr,
      PartyB: SHORTCODE, PhoneNumber: phoneStr, CallBackURL: CALLBACK_URL,
      AccountReference: 'Geopram', TransactionDesc: String(purpose || 'Geopram contribution').slice(0,50)
    };
    const stkRes = await fetch('https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest', {
      method:'POST', headers:{ Authorization:`Bearer ${access_token}`, 'Content-Type':'application/json' }, body:JSON.stringify(payload)
    });
    let data;
    try { data = await stkRes.json(); } catch (_) { data = {}; }
    if (!stkRes.ok || String(data.ResponseCode ?? '') !== '0' || !data.CheckoutRequestID) {
      // Keep diagnostics useful without logging credentials, tokens, or customer details.
      console.error('Daraja STK initiation rejected:', JSON.stringify({ httpStatus: stkRes.status, responseCode: data.ResponseCode ?? null, responseDescription: data.ResponseDescription ?? null, errorCode: data.errorCode ?? null, errorMessage: data.errorMessage ?? null }));
      const providerMessage = data.errorMessage || data.ResponseDescription;
      return res.status(502).json({ error: providerMessage || 'Safaricom did not accept the payment request. Check the phone number and try again.', providerCode: data.errorCode || data.ResponseCode || null });
    }
    const db = await getDb();
    await db.collection('transactions').insertOne({
      phone: phoneStr, name: String(name || '').slice(0,150), email: String(email || '').slice(0,200),
      purpose: String(purpose || 'Contribution').slice(0,200), amount: value, currency:'KES',
      status:'pending', merchantRequestId:data.MerchantRequestID || null,
      checkoutRequestId:data.CheckoutRequestID, createdAt:new Date(), updatedAt:new Date(),
      resultDescription: String(data.ResponseDescription || data.CustomerMessage || 'Payment request accepted; awaiting customer action.').slice(0,300)
    });
    return res.status(200).json({ ResponseCode:'0', CustomerMessage:data.CustomerMessage || 'Payment prompt sent. Check your phone.', CheckoutRequestID:data.CheckoutRequestID });
  } catch (e) {
    console.error('STK request failed:', e.message);
    return res.status(500).json({ error: 'Payment could not be started. Please try again later.' });
  }
};