
const { getDb } = require('../../lib/db');
const { requireAdmin } = require('../../lib/auth');
const { sendMail } = require('../../lib/mailer');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
 if(!requireAdmin(req,res))return;
 const id=String(req.body?.id||'').trim();
 if(!id)return res.status(400).json({error:'Transaction ID required.'});
 try{
  const db=await getDb(),t=await db.collection('transactions').findOne({checkoutRequestId:id});
  if(!t)return res.status(404).json({error:'Transaction not found.'});
  if(t.status!=='paid')return res.status(409).json({error:'A receipt can only be emailed after payment is confirmed by Safaricom.'});
  const to=String(req.body?.email||t.email||'').trim();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to))return res.status(400).json({error:'Enter a valid recipient email.'});
  const amount=Number(t.amountPaid||t.amount||0).toLocaleString('en-KE',{minimumFractionDigits:2,maximumFractionDigits:2});
  const receipt=String(t.mpesaReceiptNumber||'Not supplied');
  const subject=`Geopram payment receipt${receipt!=='Not supplied'?' - '+receipt:''}`;
  const text=`Geopram Technologies payment receipt\nName: ${t.name||'Customer'}\nAmount: KES ${amount}\nM-Pesa receipt: ${receipt}\nReference: ${id}\nStatus: Successful\nThank you.`;
  const html=`<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#172033"><h2 style="color:#10233e">Geopram Technologies</h2><p>Your payment has been confirmed.</p><table cellpadding="9" style="border-collapse:collapse;width:100%"><tr><td>Customer</td><td>${esc(t.name||'Customer')}</td></tr><tr><td>Amount</td><td><b>KES ${esc(amount)}</b></td></tr><tr><td>M-Pesa receipt</td><td>${esc(receipt)}</td></tr><tr><td>Reference</td><td>${esc(id)}</td></tr><tr><td>Status</td><td>Successful</td></tr></table><p>Thank you for choosing Geopram Technologies.</p></div>`;
  await sendMail({to,subject,text,html});
  await db.collection('transactions').updateOne({_id:t._id},{$set:{receiptEmailedAt:new Date(),receiptEmailedTo:to}});
  return res.status(200).json({ok:true,message:`Receipt sent to ${to}.`});
 }catch(e){console.error('Receipt email failed:',e.message);return res.status(500).json({error:e.message.includes('Email is not configured')?e.message:'Receipt email could not be sent. Check SMTP settings.'})}
};
