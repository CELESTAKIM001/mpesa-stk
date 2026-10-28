const { getDb } = require('../../lib/db');
const { requireAdmin } = require('../../lib/auth');
const PDFDocument = require('pdfkit');
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
    pdf.on('end', () => {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${docNo}.pdf"`);
      res.status(200).send(Buffer.concat(chunks));
    });
    const red = '#e50914', navy = '#071321', grey = '#5b6470';
    const titleMap = {
      receipt:'OFFICIAL PAYMENT RECEIPT', invoice:'INVOICE', sponsor_certificate:'CERTIFICATE OF SPONSORSHIP',
      donor_certificate:'CERTIFICATE OF APPRECIATION', membership_certificate:'MEMBERSHIP CERTIFICATE',
      student_certificate:'STUDENT CERTIFICATE', well_wisher_certificate:'CERTIFICATE OF APPRECIATION'
    };
    pdf.rect(0,0,595,142).fill(navy);
    pdf.fillColor(red).rect(54,42,6,58).fill();
    pdf.fillColor('#ffffff').font('Helvetica-Bold').fontSize(24).text(company,76,42,{width:450});
    pdf.fillColor('#d9e1eb').font('Helvetica').fontSize(9).text(process.env.COMPANY_ADDRESS || 'Official document',76,75);
    pdf.fillColor('#ffffff').font('Helvetica-Bold').fontSize(16).text(titleMap[b.type],54,174,{width:487,align:'center'});
    pdf.moveTo(54,208).lineTo(541,208).lineWidth(1.5).strokeColor(red).stroke();
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
    pdf.fillColor(grey).font('Helvetica').fontSize(8).text(`${company} • Thank you for your support. Keep this document for your records.`,54,760,{width:487,align:'center'});
    pdf.end();
  } catch (e) {
    console.error('Document creation error:', e.message);
    return res.status(500).json({ error: 'Unable to create document. Check database configuration.' });
  }
};