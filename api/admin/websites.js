
const { getDb } = require('../../lib/db');
const { requireAdmin } = require('../../lib/auth');
const { ObjectId } = require('mongodb');
const clean=(v,n=300)=>String(v??'').trim().slice(0,n);
function validUrl(v){try{const u=new URL(v);return ['https:','http:'].includes(u.protocol)}catch{return false}}
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','no-store');
 if(!['GET','POST','PATCH','DELETE'].includes(req.method))return res.status(405).json({error:'Method not allowed'});
 if(!requireAdmin(req,res))return;
 try{
  const col=(await getDb()).collection('websites');
  if(req.method==='GET'){const rows=await col.find({}).sort({createdAt:-1}).limit(200).toArray();return res.status(200).json({websites:rows.map(x=>({...x,_id:x._id.toString()}))})}
  const b=req.body||{},id=clean(req.query?.id||b.id,50);
  if(req.method==='DELETE'){if(!ObjectId.isValid(id))return res.status(400).json({error:'Valid website id required.'});const r=await col.deleteOne({_id:new ObjectId(id)});return res.status(r.deletedCount?200:404).json({ok:!!r.deletedCount})}
  const data={title:clean(b.title,120),url:clean(b.url,500),description:clean(b.description,600),previewImage:clean(b.previewImage,1000),category:clean(b.category,80)||'Geopram project',active:b.active!==false,updatedAt:new Date()};
  if(!data.title||!validUrl(data.url))return res.status(400).json({error:'Enter a title and a valid http(s) website URL.'});
  if(data.previewImage&&!validUrl(data.previewImage))return res.status(400).json({error:'Preview image must be a valid http(s) URL.'});
  if(req.method==='POST'){data.createdAt=new Date();const r=await col.insertOne(data);return res.status(201).json({website:{...data,_id:r.insertedId.toString()}})}
  if(!ObjectId.isValid(id))return res.status(400).json({error:'Valid website id required.'});
  const r=await col.updateOne({_id:new ObjectId(id)},{$set:data});return res.status(r.matchedCount?200:404).json({ok:!!r.matchedCount});
 }catch(e){console.error('Admin websites error:',e.message);return res.status(500).json({error:'Unable to manage websites.'})}
};
