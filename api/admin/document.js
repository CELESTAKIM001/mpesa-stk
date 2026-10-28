const { getDb } = require('../../lib/db');
const { requireAdmin } = require('../../lib/auth');
const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');
const { sendMail } = require('../../lib/mailer');
const { randomUUID } = require('crypto');
const QRCode = require('qrcode');
const esc = s => String(s ?? '').trim().slice(0, 500);
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!requireAdmin(req, res)) return;
  const b = req.body || {};
  const types = new Set(['receipt','invoice','sponsor_certificate','donor_certificate','membership_certificate','student_certificate','well_wisher_certificate']);
  if (!types.has(b.type)) return res.status(400).json({ error: 'Choose a supported document type.' });
  if (!esc(b.recipient) && !esc(b.transactionId)) return res.status(400).json({ error: 'Enter a recipient name or link a transaction.' });
  const quantity = Math.max(1, Math.min(100, Number(b.quantity) || 1));
  let amount = Math.max(0, Number(b.amount) || 0);
  let recipient = esc(b.recipient), recipientEmail = esc(b.email);
  const currency = esc(process.env.CURRENCY || 'KES');
  const company = esc(process.env.COMPANY_NAME || 'Geopram Technologies');
  const docNo = esc(b.documentNumber) || `GEO-${new Date().getFullYear()}-${randomUUID().slice(0,8).toUpperCase()}`;
  const createdAt = new Date();
  const verificationToken = randomUUID() + randomUUID();
  try {
    const db = await getDb();
    const transactionRef = esc(b.transactionId);
    let linkedTransaction = null;
    if (transactionRef) {
      linkedTransaction = await db.collection('transactions').findOne({ $or: [{ checkoutRequestId: transactionRef }, { mpesaReceiptNumber: transactionRef }] });
      if (!linkedTransaction) return res.status(400).json({ error: 'No transaction matches that checkout reference or M-Pesa receipt code.' });
      if (b.type === 'receipt' && String(linkedTransaction.status || '').toLowerCase() !== 'paid') {
        return res.status(400).json({ error: 'A payment receipt can only be issued for a transaction confirmed as paid.' });
      }
      if (b.type === 'receipt') {
        amount = Number(linkedTransaction.amountPaid ?? linkedTransaction.amount ?? amount);
        recipient = esc(linkedTransaction.name || recipient);
        recipientEmail = esc(linkedTransaction.email || recipientEmail);
      }
    }
    if (!recipient) return res.status(400).json({ error: 'Recipient name is required for this document type.' });
    if (b.sendEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(recipientEmail || '').trim())) return res.status(400).json({ error: 'Enter a valid recipient email to send the PDF.' });
    const baseUrl = String(process.env.APP_BASE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '')).replace(/\/$/, '');
    if (!baseUrl) return res.status(500).json({ error: 'Set APP_BASE_URL to your deployed HTTPS website URL to enable document verification QR codes.' });
    const verificationUrl = `${baseUrl}/verify.html?doc=${encodeURIComponent(docNo)}&token=${encodeURIComponent(verificationToken)}`;
    const qrBuffer = await QRCode.toBuffer(verificationUrl, { type: 'png', width: 240, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#FFFFFF' } });
    const docRecord = {
      type: b.type, documentNumber: docNo, verificationToken, verificationUrl, recipient, email: recipientEmail,
      description: esc(b.description), purpose: esc(b.purpose), quantity, amount, currency,
      transactionId: transactionRef, mpesaReceiptNumber: linkedTransaction?.mpesaReceiptNumber || null,
      issuedAt: createdAt, createdAt, status: 'issued'
    };
    await db.collection('documents').insertOne(docRecord);
    const pdf = new PDFDocument({ size: 'A4', margin: 54, bufferPages: true, info: { Title: `${b.type} - ${docNo}`, Author: company, Subject: 'Official Geopram document; verify online' } });
    const chunks = [];
    pdf.on('data', c => chunks.push(c));
    pdf.on('error', e => { console.error('PDF error', e.message); if (!res.headersSent) res.status(500).end('PDF generation failed'); });
    pdf.on('end', async () => {
      try {
        const pdfBuffer = Buffer.concat(chunks);
        if (b.sendEmail) {
          const emailTo = String(recipientEmail || '').trim();
          const title = titleMap[b.type] || 'GEOPRAM DOCUMENT';
          await sendMail({
            to: emailTo,
            subject: `${title} - ${docNo}`,
            text: `Hello ${esc(recipient)},\n\nPlease find attached your ${title.toLowerCase()}.\nDocument number: ${docNo}\nIssued by ${company}.\n\nRegards,\n${company}`,
            html: `<div style="font-family:Arial,sans-serif;color:#172033;max-width:620px;margin:auto;border:1px solid #e4e8ef;border-radius:12px;overflow:hidden"><div style="background:#081321;padding:22px 26px;border-bottom:5px solid #e50914"><div style="font-size:22px;font-weight:800;color:#fff">${company}</div><div style="color:#d8e0ea;font-size:12px;margin-top:5px">Official document delivery</div></div><div style="padding:26px"><p>Hello ${String(recipient).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]))},</p><p>Please find your <b>${title.toLowerCase()}</b> attached to this email.</p><p style="padding:14px;background:#f5f7fa;border-radius:8px"><b>Document number:</b> ${docNo}</p><p>Thank you for choosing ${company}.</p></div></div>` ,
            attachments: [{ filename: `${docNo}.pdf`, content: pdfBuffer, contentType: 'application/pdf' }]
          });
          await db.collection('documents').updateOne({ documentNumber: docNo }, { $set: { emailedAt: new Date(), emailedTo: emailTo } });
        }
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${docNo}.pdf"`);
        res.status(200).send(pdfBuffer);
      } catch (mailError) {
        console.error('Document email failed:', JSON.stringify({ message: mailError.message, code: mailError.code, command: mailError.command, responseCode: mailError.responseCode }));
        if (!res.headersSent) res.status(502).json({ error: 'The PDF was created, but email delivery failed. Check SMTP settings and try again.' });
      }
    });
    const red = '#e50914', navy = '#071321', grey = '#5b6470';
    const titleMap = {
      receipt:'OFFICIAL PAYMENT RECEIPT', invoice:'INVOICE', sponsor_certificate:'CERTIFICATE OF SPONSORSHIP',
      donor_certificate:'CERTIFICATE OF APPRECIATION', membership_certificate:'MEMBERSHIP CERTIFICATE',
      student_certificate:'STUDENT CERTIFICATE', well_wisher_certificate:'CERTIFICATE OF APPRECIATION'
    };
    pdf.rect(0,0,595,142).fill(navy);
    pdf.fillColor(red).rect(0,136,595,6).fill();
    const logoPath = path.join(__dirname, '../../public/geopram-logo.png');
    if (fs.existsSync(logoPath)) {
      pdf.roundedRect(42,28,158,52,7).fill('#ffffff');
      try { pdf.image(logoPath, 49, 34, { fit: [144, 40], align: 'center', valign: 'center' }); } catch (logoErr) { console.error('Could not embed company logo:', logoErr.message); }
    }
    pdf.fillColor('#ffffff').font('Helvetica-Bold').fontSize(20).text(company,220,37,{width:330});
    pdf.fillColor('#d9e1eb').font('Helvetica').fontSize(9).text(process.env.COMPANY_ADDRESS || 'Official document • Verified records',220,67,{width:320});
    pdf.fillColor('#ffffff').font('Helvetica').fontSize(8).text('TRUST • SERVICE • ACCOUNTABILITY',220,88,{width:320,characterSpacing:1.2});
    pdf.fillColor('#ffffff').font('Helvetica-Bold').fontSize(16).text(titleMap[b.type],54,174,{width:487,align:'center'});
    pdf.roundedRect(54,208,487,3,1.5).fill(red);
    pdf.fillColor(grey).font('Helvetica').fontSize(9).text('DOCUMENT NUMBER',54,232);
    pdf.fillColor(navy).font('Helvetica-Bold').fontSize(12).text(docNo,54,248);
    pdf.fillColor(grey).font('Helvetica').fontSize(9).text('DATE ISSUED',360,232);
    pdf.fillColor(navy).font('Helvetica-Bold').fontSize(10).text(createdAt.toLocaleString('en-KE',{timeZone:'Africa/Nairobi',year:'numeric',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}) + ' EAT',360,248,{width:180});
    const cert = b.type.includes('certificate');
    if (cert) {
      pdf.fillColor(grey).font('Helvetica').fontSize(11).text('THIS IS TO CERTIFY THAT',54,300,{align:'center',width:487});
      pdf.fillColor(navy).font('Helvetica-Bold').fontSize(25).text(esc(recipient),54,335,{align:'center',width:487});
      pdf.moveTo(130,376).lineTo(465,376).strokeColor(red).lineWidth(1).stroke();
      pdf.fillColor(navy).font('Helvetica').fontSize(12).text(esc(b.description || b.purpose || `is hereby recognised by ${company}.`),86,404,{align:'center',width:423,lineGap:5});
      if (quantity > 1) pdf.text(`Quantity / copies: ${quantity}`,54,478,{align:'center',width:487});
      pdf.fillColor(grey).font('Helvetica').fontSize(9).text('AUTHORISED SIGNATORY',80,620);
      pdf.moveTo(80,610).lineTo(230,610).strokeColor('#aab2bd').stroke();
      pdf.text('DATE',365,620); pdf.moveTo(365,610).lineTo(500,610).stroke();
    } else {
      pdf.fillColor(grey).font('Helvetica').fontSize(10).text('BILL TO / RECEIVED FROM',54,298);
      pdf.fillColor(navy).font('Helvetica-Bold').fontSize(17).text(esc(recipient),54,318);
      if (recipientEmail) pdf.fillColor(grey).font('Helvetica').fontSize(10).text(esc(recipientEmail),54,343);
      const top = 388;
      pdf.rect(54,top,487,30).fill(navy);
      pdf.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9).text('DESCRIPTION / PURPOSE',66,top+10,{width:280});
      pdf.text('QTY',370,top+10,{width:40,align:'right'}); pdf.text('AMOUNT',420,top+10,{width:105,align:'right'});
      pdf.fillColor(navy).font('Helvetica').fontSize(11).text(esc(b.description || b.purpose || 'Contribution / service'),66,top+48,{width:280});
      pdf.text(String(quantity),370,top+48,{width:40,align:'right'});
      pdf.text(`${currency} ${amount.toLocaleString('en-KE',{minimumFractionDigits:2,maximumFractionDigits:2})}`,420,top+48,{width:105,align:'right'});
      pdf.moveTo(54,top+84).lineTo(541,top+84).strokeColor('#dce1e8').stroke();
      pdf.fillColor(grey).font('Helvetica').fontSize(10).text('TOTAL',370,top+105);
      pdf.fillColor(red).font('Helvetica-Bold').fontSize(18).text(`${currency} ${(amount*quantity).toLocaleString('en-KE',{minimumFractionDigits:2,maximumFractionDigits:2})}`,420,top+100,{width:121,align:'right'});
      if (b.transactionId) pdf.fillColor(grey).font('Helvetica').fontSize(9).text(`Linked transaction: ${esc(b.transactionId)}`,54,top+150,{width:487});
    }
    // Online verification QR and verification URL are embedded in every generated PDF.
    pdf.roundedRect(430, 610, 112, 112, 8).lineWidth(1).strokeColor(red).stroke();
    pdf.image(qrBuffer, 439, 619, { width: 94, height: 94 });
    pdf.fillColor(navy).font('Helvetica-Bold').fontSize(7).text('SCAN TO VERIFY', 430, 725, { width: 112, align: 'center' });
    pdf.fillColor(grey).font('Helvetica').fontSize(7).text(verificationUrl, 54, 700, { width: 350, height: 30, link: verificationUrl });
    pdf.moveTo(54,744).lineTo(541,744).lineWidth(0.7).strokeColor('#dce1e8').stroke();
    pdf.fillColor(navy).font('Helvetica-Bold').fontSize(8).text(company,54,756,{width:240});
    pdf.fillColor(grey).font('Helvetica').fontSize(8).text(`Created ${createdAt.toLocaleString('en-KE',{timeZone:'Africa/Nairobi'})} EAT • Verify online`,294,756,{width:247,align:'right'});
    pdf.end();
  } catch (e) {
    console.error('Document creation error:', e.message);
    return res.status(500).json({ error: 'Unable to create document. Check database configuration.' });
  }
};