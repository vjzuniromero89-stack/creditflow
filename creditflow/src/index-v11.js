import v101Worker from "./index-v10-1.js";
import baseWorker from "./index.js";
import { createD1Shim } from "./db-shim.js";

const POSTGRID_BASE = "https://api.postgrid.com/print-mail/v1";
const j=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8"}});

async function authed(request,env,ctx){
  const u=new URL(request.url);u.pathname="/api/auth/status";u.search="";
  const r=await baseWorker.fetch(new Request(u.toString(),{method:"GET",headers:request.headers}),env,ctx);
  if(!r.ok)return false; try{return !!(await r.json()).authenticated}catch{return false}
}
function esc(s){return String(s??"").replace(/[&<>\"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'\"':"&quot;","'":"&#039;"}[c]))}
function splitName(full){const p=String(full||"").trim().split(/\s+/).filter(Boolean);return {firstName:p[0]||"CreditFlow",lastName:p.slice(1).join(" ")||undefined}}
function parseRecipient(raw,name){
  const s=String(raw||"").replace(/\r/g,"").trim(); if(!s)return null;
  let addressLine1="",addressLine2,city,provinceOrState,postalOrZip;
  const lines=s.split("\n").map(x=>x.trim()).filter(Boolean);
  if(lines.length>=2){
    const m=lines.at(-1).match(/^(.+?),\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
    if(m){city=m[1].trim();provinceOrState=m[2].toUpperCase();postalOrZip=m[3];const a=lines.slice(0,-1);if(a[0]?.toLowerCase()===String(name||"").toLowerCase())a.shift();addressLine1=a[0]||"";addressLine2=a.slice(1).join(", ")||undefined;}
  }
  if(!addressLine1){
    const m=s.match(/^(.*?)(?:,\s*)?([^,\n]+?),\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
    if(m){const chunks=m[1].replace(/,\s*$/,"").split(/,\s*/).filter(Boolean);if(chunks[0]?.toLowerCase()===String(name||"").toLowerCase())chunks.shift();addressLine1=chunks[0]||m[1];addressLine2=chunks.slice(1).join(", ")||undefined;city=m[2].trim();provinceOrState=m[3].toUpperCase();postalOrZip=m[4];}
  }
  if(!addressLine1)return null;
  return {companyName:name||"Recipient",addressLine1,addressLine2,city,provinceOrState,postalOrZip,countryCode:"US"};
}
function payloadFor(bundle,job,mailingClass){
  const to=parseRecipient(bundle.recipient_address,bundle.recipient_name); if(!to)throw new Error("No se pudo interpretar la dirección del destinatario.");
  if(!bundle.address||!bundle.city||!bundle.state||!bundle.zip)throw new Error("El cliente necesita dirección, ciudad, estado y ZIP completos.");
  const n=splitName(bundle.full_name);
  const from={firstName:n.firstName,lastName:n.lastName,addressLine1:bundle.address,city:bundle.city,provinceOrState:bundle.state,postalOrZip:bundle.zip,countryCode:"US",phoneNumber:bundle.phone||undefined};
  const ref=job.internal_reference||`CF-${bundle.id}`;
  return {from,to,html:`<!doctype html><html><head><meta charset="utf-8"><style>@page{size:Letter;margin:.75in}body{font-family:Arial,Helvetica,sans-serif;font-size:11pt;line-height:1.45;color:#111}.letter{white-space:pre-wrap}</style></head><body><div class="letter">${esc(bundle.body||"")}</div></body></html>`,addressPlacement:"top_first_page",mailingClass,description:`CreditFlow ${ref} - ${bundle.title||"Letter"}`.slice(0,200),color:false,doubleSided:false,metadata:{creditflowJobId:String(job.id),creditflowLetterId:String(bundle.id),creditflowClientId:String(bundle.client_id),internalReference:String(ref)}};
}
async function pg(env,path,opt={}){
  if(!env.POSTGRID_TEST_API_KEY){const e=new Error("POSTGRID_TEST_API_KEY no está configurada en Cloudflare.");e.code="POSTGRID_KEY_MISSING";throw e}
  const h=new Headers(opt.headers||{});h.set("X-API-Key",env.POSTGRID_TEST_API_KEY);if(opt.body&&!h.has("Content-Type"))h.set("Content-Type","application/json");
  const r=await fetch(`${POSTGRID_BASE}${path}`,{...opt,headers:h});let d={};try{d=await r.json()}catch{}
  if(!r.ok){const e=new Error(d?.message||d?.error?.message||d?.error||`PostGrid HTTP ${r.status}`);e.status=r.status;e.payload=d;throw e}return d;
}
async function providerRow(db,env){
  let r=await db.prepare(`SELECT * FROM mail_provider_settings WHERE provider='postgrid' LIMIT 1`).first();
  if(!r)r=await db.prepare(`INSERT INTO mail_provider_settings(provider,environment,connection_status,credentials_configured) VALUES ('postgrid','test',?,?) RETURNING *`).bind(env.POSTGRID_TEST_API_KEY?'ready_for_test':'awaiting_credentials',!!env.POSTGRID_TEST_API_KEY).first();
  else await db.prepare(`UPDATE mail_provider_settings SET credentials_configured=?,updated_at=NOW() WHERE provider='postgrid'`).bind(!!env.POSTGRID_TEST_API_KEY).run();
  return await db.prepare(`SELECT * FROM mail_provider_settings WHERE provider='postgrid' LIMIT 1`).first();
}
async function status(db,env){
  const provider=await providerRow(db,env);const {results:jobs}=await db.prepare(`SELECT j.*,l.title,l.recipient_name,l.recipient_address,l.status AS letter_status,c.full_name AS client_name FROM certified_mail_jobs j LEFT JOIN letters l ON l.id=j.letter_id LEFT JOIN clients c ON c.id=j.client_id WHERE j.provider='postgrid' ORDER BY j.created_at DESC LIMIT 100`).all();
  const {results:ready}=await db.prepare(`SELECT l.id,l.client_id,l.title,l.recipient_name,l.recipient_address,l.round_number,l.status,c.full_name AS client_name FROM letters l JOIN clients c ON c.id=l.client_id WHERE l.status='lista' ORDER BY c.full_name,l.created_at DESC`).all();
  return {provider:{...provider,credentials_configured:!!env.POSTGRID_TEST_API_KEY,environment:"test",live_enabled:false},jobs:jobs||[],ready_letters:ready||[]};
}
async function testConnection(db,env){try{await pg(env,"/letters?limit=1",{method:"GET"});await db.prepare(`UPDATE mail_provider_settings SET connection_status='connected',credentials_configured=TRUE,last_test_at=NOW(),last_test_status='success',last_test_message='Conexión TEST correcta',updated_at=NOW() WHERE provider='postgrid'`).run();return j({ok:true,environment:"test",live:false,message:"PostGrid TEST conectado correctamente."})}catch(e){await db.prepare(`UPDATE mail_provider_settings SET connection_status='error',last_test_at=NOW(),last_test_status='error',last_test_message=?,updated_at=NOW() WHERE provider='postgrid'`).bind(String(e.message).slice(0,1000)).run();return j({ok:false,error:e.message},e.status&&e.status<500?400:502)}}
async function bundle(db,id){return db.prepare(`SELECT l.*,c.full_name,c.address,c.city,c.state,c.zip,c.phone FROM letters l JOIN clients c ON c.id=l.client_id WHERE l.id=? LIMIT 1`).bind(id).first()}
async function prepare(db,letterId,b={}){
  const x=await bundle(db,letterId);if(!x)return j({error:"Carta no encontrada."},404);if(x.status!=="lista")return j({error:"La carta debe estar en estado Lista."},409);
  let job=await db.prepare(`SELECT * FROM certified_mail_jobs WHERE letter_id=? LIMIT 1`).bind(letterId).first();
  if(job?.provider_job_id&&job.provider!=="postgrid")return j({error:"Esta carta ya fue procesada con otro proveedor."},409);
  if(!job)job=await db.prepare(`INSERT INTO certified_mail_jobs(repair_case_id,client_id,letter_id,provider,status,provider_environment,internal_reference,extra_service,payload_json) VALUES ((SELECT id FROM repair_cases WHERE client_id=? LIMIT 1),?,?, 'postgrid','prepared_test','test',?,'certified_return_receipt','{}') RETURNING *`).bind(x.client_id,x.client_id,letterId,`CF-${letterId}`).first();
  else{await db.prepare(`UPDATE certified_mail_jobs SET provider='postgrid',status='prepared_test',provider_environment='test',internal_reference=COALESCE(internal_reference,?),updated_at=NOW() WHERE id=?`).bind(`CF-${letterId}`,job.id).run();job=await db.prepare(`SELECT * FROM certified_mail_jobs WHERE id=?`).bind(job.id).first()}
  const mailingClass=b.mailing_class==='certified'?'certified':'certified_return_receipt';let p;try{p=payloadFor(x,job,mailingClass)}catch(e){return j({error:e.message},400)}
  await db.prepare(`UPDATE certified_mail_jobs SET payload_json=?,extra_service=?,status='prepared_test',updated_at=NOW() WHERE id=?`).bind(JSON.stringify(p),mailingClass,job.id).run();
  await db.prepare(`INSERT INTO certified_mail_events(certified_mail_job_id,client_id,letter_id,event_type,provider_status,detail,metadata_json) VALUES (?,?,?,'prepared','prepared_test','Trabajo preparado en sandbox.',?)`).bind(job.id,x.client_id,letterId,JSON.stringify({mailingClass})).run();return j({ok:true,job_id:job.id});
}
async function submit(db,env,id){
  const job=await db.prepare(`SELECT * FROM certified_mail_jobs WHERE id=? AND provider='postgrid' LIMIT 1`).bind(id).first();if(!job)return j({error:"Trabajo no encontrado."},404);if(job.provider_environment!=="test")return j({error:"LIVE está bloqueado en v11."},409);if(job.provider_job_id)return j({error:"Ya existe una orden en PostGrid. Usa Sincronizar."},409);
  const x=await bundle(db,job.letter_id);let p=job.payload_json;try{p=typeof p==='string'?JSON.parse(p):p}catch{p=null}if(!p?.to){try{p=payloadFor(x,job,job.extra_service||'certified_return_receipt')}catch(e){return j({error:e.message},400)}}
  await db.prepare(`UPDATE certified_mail_jobs SET provider_attempts=provider_attempts+1,last_provider_attempt_at=NOW() WHERE id=?`).bind(id).run();
  try{const d=await pg(env,"/letters",{method:"POST",headers:{"Idempotency-Key":`creditflow-postgrid-test-${job.id}`},body:JSON.stringify(p)});const t=d?.trackingNumber||d?.tracking_number||null;await db.prepare(`UPDATE certified_mail_jobs SET status='submitted_test',provider_job_id=?,provider_status=?,tracking_number=?,provider_live=?,response_json=?,submitted_at=NOW(),updated_at=NOW(),error_message=NULL WHERE id=?`).bind(d?.id||null,d?.status||'created',t,!!d?.live,JSON.stringify(d),job.id).run();await db.prepare(`INSERT INTO certified_mail_events(certified_mail_job_id,client_id,letter_id,event_type,provider_status,tracking_number,detail,metadata_json) VALUES (?,?,?,'submitted_test',?,?, 'Orden creada en PostGrid TEST.',?)`).bind(job.id,job.client_id,job.letter_id,d?.status||'created',t,JSON.stringify(d)).run();return j({ok:true,test:true,live:!!d?.live,postgrid:d})}catch(e){await db.prepare(`UPDATE certified_mail_jobs SET status='error',error_message=?,provider_error_code=?,response_json=?,updated_at=NOW() WHERE id=?`).bind(String(e.message).slice(0,2000),String(e.status||e.code||'POSTGRID_ERROR'),JSON.stringify(e.payload||{}),job.id).run();return j({ok:false,error:e.message,details:e.payload||null},e.status&&e.status<500?400:502)}
}
async function sync(db,env,id){const job=await db.prepare(`SELECT * FROM certified_mail_jobs WHERE id=? AND provider='postgrid' LIMIT 1`).bind(id).first();if(!job)return j({error:"Trabajo no encontrado."},404);if(!job.provider_job_id)return j({error:"Todavía no tiene ID de PostGrid."},409);try{const d=await pg(env,`/letters/${encodeURIComponent(job.provider_job_id)}`,{method:"GET"});const t=d?.trackingNumber||d?.tracking_number||job.tracking_number||null;await db.prepare(`UPDATE certified_mail_jobs SET provider_status=?,tracking_number=?,provider_live=?,response_json=?,last_tracking_at=NOW(),updated_at=NOW(),error_message=NULL WHERE id=?`).bind(d?.status||job.provider_status,t,!!d?.live,JSON.stringify(d),job.id).run();return j({ok:true,postgrid:d})}catch(e){return j({ok:false,error:e.message},e.status&&e.status<500?400:502)}}

function hex(buf){return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('')}
function cteq(a,b){a=String(a||'');b=String(b||'');if(a.length!==b.length)return false;let x=0;for(let i=0;i<a.length;i++)x|=a.charCodeAt(i)^b.charCodeAt(i);return x===0}
async function verify(raw,header,secret){if(!header||!secret)return false;const parts=Object.fromEntries(header.split(',').map(p=>p.trim().split('=')));const t=parts.t,v1=parts.v1;if(!t||!v1||Math.abs(Date.now()-Number(t))>600000)return false;const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);const sig=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`${t}.${raw}`));return cteq(hex(sig),v1)}
async function webhook(request,db,env){if(!env.POSTGRID_WEBHOOK_SECRET)return j({error:'Webhook secret not configured'},503);const raw=await request.text();if(!(await verify(raw,request.headers.get('PostGrid-Signature'),env.POSTGRID_WEBHOOK_SECRET)))return j({error:'Invalid signature'},401);let ev;try{ev=JSON.parse(raw)}catch{return j({error:'Invalid JSON'},400)}const d=ev?.data||{},meta=d?.metadata||{};let job=d?.id?await db.prepare(`SELECT * FROM certified_mail_jobs WHERE provider='postgrid' AND provider_job_id=? LIMIT 1`).bind(d.id).first():null;if(!job&&meta.creditflowJobId)job=await db.prepare(`SELECT * FROM certified_mail_jobs WHERE id=? AND provider='postgrid' LIMIT 1`).bind(meta.creditflowJobId).first();if(job){const t=d?.trackingNumber||d?.tracking_number||job.tracking_number||null;await db.prepare(`UPDATE certified_mail_jobs SET provider_status=?,tracking_number=?,last_tracking_at=NOW(),response_json=?,updated_at=NOW() WHERE id=?`).bind(d?.status||job.provider_status,t,JSON.stringify(d),job.id).run();await db.prepare(`INSERT INTO certified_mail_events(certified_mail_job_id,client_id,letter_id,event_type,provider_status,tracking_number,detail,metadata_json,occurred_at) VALUES (?,?,?,?,?,?, 'Evento recibido de PostGrid.',?,NOW())`).bind(job.id,job.client_id,job.letter_id,ev?.type||'postgrid_webhook',d?.status||null,t,JSON.stringify(ev)).run()}return j({ok:true})}

export default{async fetch(request,env,ctx){const runtimeEnv={...env,DB:createD1Shim(env)},db=runtimeEnv.DB,u=new URL(request.url),p=u.pathname,m=request.method.toUpperCase();if(!p.startsWith('/api/'))return v101Worker.fetch(request,runtimeEnv,ctx);if(p==='/api/webhooks/postgrid'&&m==='POST')return webhook(request,db,runtimeEnv);const owned=p==='/api/postgrid/status'||p==='/api/postgrid/test'||/^\/api\/postgrid\/letters\/\d+\/prepare$/.test(p)||/^\/api\/postgrid\/jobs\/\d+\/submit$/.test(p)||/^\/api\/postgrid\/jobs\/\d+\/sync$/.test(p);if(!owned)return v101Worker.fetch(request,runtimeEnv,ctx);if(!(await authed(request,runtimeEnv,ctx)))return j({error:'No autorizado'},401);if(p==='/api/postgrid/status'&&m==='GET')return j(await status(db,runtimeEnv));if(p==='/api/postgrid/test'&&m==='POST')return testConnection(db,runtimeEnv);let x=p.match(/^\/api\/postgrid\/letters\/(\d+)\/prepare$/);if(x&&m==='POST'){let b={};try{b=await request.json()}catch{}return prepare(db,x[1],b)}x=p.match(/^\/api\/postgrid\/jobs\/(\d+)\/submit$/);if(x&&m==='POST')return submit(db,runtimeEnv,x[1]);x=p.match(/^\/api\/postgrid\/jobs\/(\d+)\/sync$/);if(x&&m==='POST')return sync(db,runtimeEnv,x[1]);return v101Worker.fetch(request,runtimeEnv,ctx)}};
