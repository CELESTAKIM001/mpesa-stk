const { MongoClient } = require('mongodb');

let clientPromise;
async function getDb() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not configured');
  if (!clientPromise) {
    const client = new MongoClient(process.env.MONGODB_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 10000
    });
    clientPromise = client.connect().catch(err => { clientPromise = null; throw err; });
  }
  const client = await clientPromise;
  const db = client.db(process.env.DATABASE_NAME || 'geopram');
  await Promise.all([
    db.collection('transactions').createIndex({ createdAt: -1 }),
    db.collection('transactions').createIndex({ checkoutRequestId: 1 }, { sparse: true }),
    db.collection('records').createIndex({ createdAt: -1 }),
    db.collection('records').createIndex({ type: 1, createdAt: -1 }),
    db.collection('documents').createIndex({ createdAt: -1 })
  ]);
  return db;
}
module.exports = { getDb };