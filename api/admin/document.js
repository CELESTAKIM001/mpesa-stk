const { getDb } = require('../../lib/db');
const { requireAdmin } = require('../../lib/auth');
const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');
const { sendMail } = require('../../lib/mailer');
const { randomUUID } = require('crypto');
const esc = s => String(s ?? '').trim().slice(0, 500);
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!requireAdmin(req, res)) return;
  const b = req.body || {};
  const types = new Set(['receipt','invoice','sponsor_certificate','donor_certificate','membership_certificate','student_certificate','well_wisher_certificate']);
  if (!types.has(b.type)) return res.status(400).json({ error: 'Choose a supported document type.' });
  if (!esc(b.recipient)) return res.status(400).json({ error: 'Recipient name is required.' });
  if (b.sendEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(b.email || '').trim())) return res.status(400).json({ error: 'Enter a valid recipient email to send the PDF.' });
  const quantity = Math.max(1, Math.min(100, Number(b.quantity) || 1));
  const amount = Math.max(0, Number(b.amount) || 0);
  const currency = esc(process.env.CURRENCY || 'KES');
  const company = esc(process.env.COMPANY_NAME || 'Geopram Technologies');
  const docNo = esc(b.documentNumber) || `GEO-${new Date().getFullYear()}-${randomUUID().slice(0,8).toUpperCase()}`;
  try {
    const db = await getDb();
    const docRecord = {
      type: b.type, documentNumber: docNo, recipient: esc(b.recipient), email: esc(b.email),
      description: esc(b.description), purpose: esc(b.purpose), quantity, amount, currency,
      transactionId: esc(b.transactionId), issuedAt: new Date(), createdAt: new Date()
    };
    await db.collection('documents').insertOne(docRecord);
    const pdf = new PDFDocument({ size: 'A4', margin: 54, bufferPages: true, info: { Title: `${b.type} - ${docNo}`, Author: company, Subject: 'Official Geopram document' } });
    const chunks = [];
    pdf.on('data', c => chunks.push(c));
    pdf.on('error', e => { console.error('PDF error', e.message); if (!res.headersSent) res.status(500).end('PDF generation failed'); });
    pdf.on('end', async () => {
      try {
        const pdfBuffer = Buffer.concat(chunks);
        if (b.sendEmail) {
          const recipientEmail = String(b.email || '').trim();
          const title = titleMap[b.type] || 'GEOPRAM DOCUMENT';
          await sendMail({
            to: recipientEmail,
            subject: `${title} - ${docNo}`,
            text: `Hello ${esc(b.recipient)},\n\nPlease find attached your ${title.toLowerCase()}.\nDocument number: ${docNo}\nIssued by ${company}.\n\nRegards,\n${company}`,
            html: `<div style="font-family:Arial,sans-serif;color:#172033;max-width:620px;margin:auto;border:1px solid #e4e8ef;border-radius:12px;overflow:hidden"><div style="background:#081321;padding:22px 26px;border-bottom:5px solid #e50914"><div style="font-size:22px;font-weight:800;color:#fff">${company}</div><div style="color:#d8e0ea;font-size:12px;margin-top:5px">Official document delivery</div></div><div style="padding:26px"><p>Hello ${String(b.recipient).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]))},</p><p>Please find your <b>${title.toLowerCase()}</b> attached to this email.</p><p style="padding:14px;background:#f5f7fa;border-radius:8px"><b>Document number:</b> ${docNo}</p><p>Thank you for choosing ${company}.</p></div></div>` ,
            attachments: [{ filename: `${docNo}.pdf`, content: pdfBuffer, contentType: 'application/pdf' }]
          });
          await db.collection('documents').updateOne({ documentNumber: docNo }, { $set: { emailedAt: new Date(), emailedTo: recipientEmail } });
        }
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${docNo}.pdf"`);
        res.status(200).send(pdfBuffer);
      } catch (mailError) {
        console.error('Document email failed:', mailError.message);
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
    pdf.fillColor(navy).font('Helvetica-Bold').fontSize(12).text(new Date().toLocaleDateString('en-KE',{year:'numeric',month:'long',day:'numeric'}),360,248);
    const cert = b.type.includes('certificate');
    if (cert) {
      pdf.fillColor(grey).font('Helvetica').fontSize(11).text('THIS IS TO CERTIFY THAT',54,300,{align:'center',width:487});
      pdf.fillColor(navy).font('Helvetica-Bold').fontSize(25).text(esc(b.recipient),54,335,{align:'center',width:487});
      pdf.moveTo(130,376).lineTo(465,376).strokeColor(red).lineWidth(1).stroke();
      pdf.fillColor(navy).font('Helvetica').fontSize(12).text(esc(b.description || b.purpose || `is hereby recognised by ${company}.`),86,404,{align:'center',width:423,lineGap:5});
      if (quantity > 1) pdf.text(`Quantity / copies: ${quantity}`,54,478,{align:'center',width:487});
      pdf.fillColor(grey).font('Helvetica').fontSize(9).text('AUTHORISED SIGNATORY',80,620);
      pdf.moveTo(80,610).lineTo(230,610).strokeColor('#aab2bd').stroke();
      pdf.text('DATE',365,620); pdf.moveTo(365,610).lineTo(500,610).stroke();
    } else {
      pdf.fillColor(grey).font('Helvetica').fontSize(10).text('BILL TO / RECEIVED FROM',54,298);
      pdf.fillColor(navy).font('Helvetica-Bold').fontSize(17).text(esc(b.recipient),54,318);
      if (b.email) pdf.fillColor(grey).font('Helvetica').fontSize(10).text(esc(b.email),54,343);
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
    pdf.moveTo(54,744).lineTo(541,744).lineWidth(0.7).strokeColor('#dce1e8').stroke();
    pdf.fillColor(navy).font('Helvetica-Bold').fontSize(8).text(company,54,756,{width:240});
    pdf.fillColor(grey).font('Helvetica').fontSize(8).text(`Document ${docNo} • Keep this document for your records`,294,756,{width:247,align:'right'});
    pdf.end();
  } catch (e) {
    console.error('Document creation error:', e.message);
    return res.status(500).json({ error: 'Unable to create document. Check database configuration.' });
  }
};