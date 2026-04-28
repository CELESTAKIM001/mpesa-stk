module.exports = (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  const body = req.body;
  console.log('M-Pesa Callback:', JSON.stringify(body, null, 2));

  const stkCallback = body?.Body?.stkCallback;

  if (stkCallback) {
    const resultCode = stkCallback.ResultCode;
    const resultDesc = stkCallback.ResultDesc;
    const merchantRequestID = stkCallback.MerchantRequestID;

    if (resultCode === 0) {
      const metadata = stkCallback.CallbackMetadata.Item;
      const amount = metadata.find(i => i.Name === 'Amount')?.Value;
      const mpesaCode = metadata.find(i => i.Name === 'MpesaReceiptNumber')?.Value;
      const phone = metadata.find(i => i.Name === 'PhoneNumber')?.Value;

      console.log(`✅ Payment SUCCESS — KES ${amount} from ${phone}, Code: ${mpesaCode}`);
    } else {
      console.log(`❌ Payment FAILED — ${resultDesc}`);
    }
  }

  // Always respond 200 to Safaricom
  return res.status(200).json({ ResultCode: 0, ResultDesc: 'Success' });
};