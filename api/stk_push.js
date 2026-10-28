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
  const { CONSUMER_KEY, CONSUMER_SECRET, SHORTCODE, TILL_NUMBER, PASSKEY, CALLBACK_URL } = process.env;
  if (![CONSUMER_KEY, CONSUMER_SECRET, SHORTCODE, TILL_NUMBER, PASSKEY, CALLBACK_URL].every(Boolean)) {
    return res.status(500).json({ error: 'M-Pesa configuration is incomplete. Configure CONSUMER_KEY, CONSUMER_SECRET, SHORTCODE, TILL_NUMBER, PASSKEY, and CALLBACK_URL in Vercel.' });
  }
  if (!/^\d{5,20}$/.test(String(SHORTCODE)) || !/^\d{5,20}$/.test(String(TILL_NUMBER))) {
    return res.status(500).json({ error: 'SHORTCODE and TILL_NUMBER must contain digits only. Confirm the values with your Daraja Go Live configuration.' });
  }
  let acceptedStkResponse = null;
  try {
    const tokenRes = await fetch('https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials', {
      headers: { Authorization: `Basic ${Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString('base64')}` }
    });
    if (!tokenRes.ok) { console.error('Daraja token request failed:', tokenRes.status); return res.status(502).json({ error: 'Could not connect to M-Pesa. Please try again.' }); }
    const { access_token } = await tokenRes.json();
    if (!access_token) return res.status(502).json({ error: 'M-Pesa did not return an access token.' });
    // Daraja expects YYYYMMDDHHmmss. Generate it in Kenya time and reuse it in the password.
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    }).formatToParts(new Date());
    const dateParts = Object.fromEntries(parts.filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
    const timestamp = dateParts.year + dateParts.month + dateParts.day + dateParts.hour + dateParts.minute + dateParts.second;
    const password = Buffer.from(`${SHORTCODE}${PASSKEY}${timestamp}`).toString('base64');
    const payload = {
      BusinessShortCode: SHORTCODE, Password: password, Timestamp: timestamp,
      // For a Buy Goods Till, BusinessShortCode is the shortcode enabled at Go Live; PartyB is the customer-facing Till.
      TransactionType: 'CustomerBuyGoodsOnline', Amount: value, PartyA: phoneStr,
      PartyB: TILL_NUMBER, PhoneNumber: phoneStr, CallBackURL: CALLBACK_URL,
      AccountReference: 'Geopram', TransactionDesc: String(purpose || 'Geopram payment').replace(/[\r\n]/g, ' ').slice(0,13)
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
    // From this point, Safaricom has accepted the STK request. Never tell the customer
    // that initiation failed merely because our database temporarily failed afterward.
    acceptedStkResponse = data;
    const db = await getDb();
    // Upsert allows a very fast callback to win the race; do not overwrite its final status.
    await db.collection('transactions').updateOne(
      { checkoutRequestId: data.CheckoutRequestID },
      { $setOnInsert: {
      phone: phoneStr, name: String(name || '').slice(0,150), email: String(email || '').slice(0,200),
      purpose: String(purpose || 'Contribution').slice(0,200), amount: value, currency:'KES',
      status:'pending', merchantRequestId:data.MerchantRequestID || null,
      checkoutRequestId:data.CheckoutRequestID, createdAt:new Date(), updatedAt:new Date(),
      resultDescription: String(data.ResponseDescription || data.CustomerMessage || 'Payment request accepted; awaiting customer action.').slice(0,300)
      }, $set: {
        updatedAt: new Date(), phone: phoneStr, name: String(name || '').slice(0,150),
        email: String(email || '').slice(0,200), purpose: String(purpose || 'Contribution').slice(0,200),
        amount: value, currency: 'KES', merchantRequestId: data.MerchantRequestID || null
      } },
      { upsert: true }
    );
    return res.status(200).json({ ResponseCode:'0', CustomerMessage:data.CustomerMessage || 'Payment prompt sent. Check your phone.', CheckoutRequestID:data.CheckoutRequestID });
  } catch (e) {
    console.error('STK request processing failed:', e.message);
    if (acceptedStkResponse?.CheckoutRequestID) {
      // The phone prompt may already be on the customer's phone. Return the accepted
      // checkout reference so the UI can show the prompt message and poll for callback status.
      return res.status(200).json({
        ResponseCode: '0',
        CustomerMessage: 'Payment request sent. Check your phone and follow the M-Pesa prompt.',
        CheckoutRequestID: acceptedStkResponse.CheckoutRequestID,
        trackingWarning: 'Payment request was accepted, but transaction tracking may be delayed.'
      });
    }
    return res.status(500).json({ error: 'M-Pesa could not accept the payment request. Please try again later.' });
  }
};