const { cors } = require('./_lib');
const https=require('https'),http=require('http');
function fetchUrl(url){return new Promise((resolve,reject)=>{const mod=url.startsWith('https')?https:http;const req=mod.get(url,{headers:{'User-Agent':'Mozilla/5.0'},timeout:10000},(res)=>{if([301,302,303,307,308].includes(res.statusCode)&&res.headers.location)return fetchUrl(res.headers.location).then(resolve).catch(reject);const c=[];res.on('data',d=>c.push(d));res.on('end',()=>resolve(Buffer.concat(c).toString('utf8',0,200000)));});req.on('error',reject);req.on('timeout',()=>{req.destroy();reject(new Error('timeout'));});});}
module.exports = async (req, res) => {
  cors(res);
  if(req.method==='OPTIONS'){res.status(204).end();return;}
  const url=req.query?.url;
  if(!url){res.status(400).json({error:'Missing url'});return;}
  try{
    const html=await fetchUrl(url);
    const text=html.replace(/<script[\s\S]*?<\/script>/gi,'').replace(/<style[\s\S]*?<\/style>/gi,'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().slice(0,8000);
    const title=(html.match(/<title[^>]*>([^<]+)/i)||[])[1]||'';
    res.status(200).json({text,meta:{title},domain:new URL(url).hostname,scraped:true});
  }catch(e){res.status(500).json({error:e.message,scraped:false});}
};
