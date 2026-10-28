
const { getDb } = require('../lib/db');
module.exports = async (req,res) => {
  res.setHeader('Cache-Control','no-store');
  try {
    const db=await getDb();
    const rows=await db.collection('websites').find({active:{$ne:false}},{projection:{title:1,url:1,description:1,previewImage:1,category:1,createdAt:1}}).sort({createdAt:-1}).limit(100).toArray();
    return res.status(200).json({websites:rows.map(x=>({...x,_id:x._id.toString()}))});
  } catch(e) { console.error('Websites read error:',e.message); return res.status(500).json({error:'Unable to load websites.'}); }
};
