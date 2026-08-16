const https=require('https');
const CLAUDE_KEY=process.env.CLAUDE_KEY||'';
const OPENAI_KEY=process.env.OPENAI_KEY||'';
const SARVAM_KEY=process.env.SARVAM_KEY||'';
const agent=new https.Agent({keepAlive:true,maxSockets:4});
function cors(res){res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type');}
function readBody(req){return new Promise((resolve,reject)=>{const c=[];req.on('data',d=>c.push(d));req.on('end',()=>resolve(Buffer.concat(c).toString()));req.on('error',reject);});}
function readBodyRaw(req){return new Promise((resolve,reject)=>{const c=[];req.on('data',d=>c.push(d));req.on('end',()=>resolve(Buffer.concat(c)));req.on('error',reject);});}
function httpsPost(hostname,path,headers,payload){return new Promise((resolve,reject)=>{const buf=typeof payload==='string'?Buffer.from(payload):payload;const req=https.request({hostname,path,method:'POST',agent,headers:{...headers,'Content-Length':buf.length},timeout:55000},(res)=>{const c=[];res.on('data',d=>c.push(d));res.on('end',()=>resolve({status:res.statusCode,body:Buffer.concat(c).toString()}));});req.on('error',reject);req.on('timeout',()=>{req.destroy();reject(new Error('timeout'));});req.write(buf);req.end();});}
async function callClaude(body){const msgs=(body.messages||[]).map(m=>({role:m.role==='system'?'user':m.role,content:typeof m.content==='string'?m.content:(m.content||[]).map(b=>b.type==='text'?b.text:JSON.stringify(b)).join('\n')}));const payload=JSON.stringify({model:'claude-sonnet-4-6',max_tokens:body.max_tokens||1800,messages:msgs});const r=await httpsPost('api.anthropic.com','/v1/messages',{'Content-Type':'application/json','x-api-key':CLAUDE_KEY,'anthropic-version':'2023-06-01'},payload);try{const p=JSON.parse(r.body);if(p.content?.[0]?.text)return{status:r.status,body:JSON.stringify({content:p.content})};if(p.error)return{status:r.status,body:JSON.stringify({content:[{type:'text',text:''}],error:p.error})};return r;}catch(e){return r;}}
module.exports={cors,readBody,readBodyRaw,httpsPost,callClaude,CLAUDE_KEY,OPENAI_KEY,SARVAM_KEY};
