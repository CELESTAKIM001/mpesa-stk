const { getDb } = require('../../lib/db');
const { requireAdmin } = require('../../lib/auth');
const { ObjectId } = require('mongodb');
const ALLOWED = new Set(['sponsor', 'donor', 'member', 'well_wisher', 'student', 'other']);
const clean = v => String(v ?? '').trim().slice(0, 500);
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!['GET','POST','PATCH','DELETE'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });
  if (!requireAdmin(req, res)) return;
  try {
    const db = await getDb(), col = db.collection('records');
    if (req.method === 'GET') {
      const limit = Math.min(Math.max(parseInt(req.query?.limit || '100', 10) || 100, 1), 250);
      const type = clean(req.query?.type);
      const q = clean(req.query?.q);
      const filter = {};
      if (ALLOWED.has(type)) filter.type = type;
      if (q) filter.$or = ['name','email','reference','phone','notes'].map(k => ({ [k]: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }));
      const rows = await col.find(filter).sort({ createdAt: -1 }).limit(limit).toArray();
      return res.status(200).json({ records: rows.map(x => ({ ...x, _id: x._id.toString() })) });
    }
    const body = req.body || {};
    if (req.method === 'POST' || req.method === 'PATCH') {
      if (req.method === 'PATCH' && !ObjectId.isValid(body.id)) return res.status(400).json({ error: 'Valid record id required.' });
      if (!ALLOWED.has(body.type) && req.method === 'POST') return res.status(400).json({ error: 'Choose a valid record type.' });
      const data = {
        type: ALLOWED.has(body.type) ? body.type : 'other',
        name: clean(body.name), email: clean(body.email), phone: clean(body.phone),
        reference: clean(body.reference), notes: clean(body.notes),
        quantity: Math.min(1000, Math.max(1, Number(body.quantity) || 1)),
        updatedAt: new Date()
      };
      if (!data.name) return res.status(400).json({ error: 'Name is required.' });
      if (req.method === 'POST') {
        data.createdAt = new Date();
        const result = await col.insertOne(data);
        return res.status(201).json({ record: { ...data, _id: result.insertedId.toString() } });
      }
      const id = new ObjectId(body.id);
      const old = await col.findOne({ _id: id });
      if (!old) return res.status(404).json({ error: 'Record not found.' });
      if (!body.type) data.type = old.type;
      await col.updateOne({ _id: id }, { $set: data });
      return res.status(200).json({ record: { ...old, ...data, _id: id.toString() } });
    }
    const id = clean(req.query?.id || body.id);
    if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'Valid record id required.' });
    const result = await col.deleteOne({ _id: new ObjectId(id) });
    return res.status(result.deletedCount ? 200 : 404).json({ ok: !!result.deletedCount });
  } catch (e) {
    console.error('Admin records error:', e.message);
    return res.status(500).json({ error: 'Unable to process records. Check database configuration.' });
  }
};