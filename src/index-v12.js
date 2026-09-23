// CreditFlow v12 — Collector Compliance Registry
import v1172 from "./index-v11-7-2.js";
import baseWorker from "./index.js";
import { createD1Shim } from "./db-shim.js";
const out=(x,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
async function auth(req,env,ctx){
 const u=new URL(req.url);u.pathname="/api/auth/status";u.search="";
 const r=await baseWorker.fetch(new Request(u,{method:"GET",headers:req.headers}),env,ctx);
 if(!r.ok)return false;try{return !!(await r.json()).authenticated}catch{return false}
}
export default{async fetch(request,env,ctx){
 const u=new URL(request.url),m=request.method.toUpperCase();
 const match=u.pathname.match(/^\/api\/collector-compliance\/client\/(\d+)$/);
 if(match){
  if(!(await auth(request,env,ctx)))return out({error:"No autorizado"},401);
  const db=createD1Shim(env),clientId=Number(match[1]);
  try{
   if(m==="GET"){
    const {results}=await db.prepare(`SELECT * FROM collector_compliance_checks WHERE client_id=? ORDER BY updated_at DESC,id DESC`).bind(clientId).all();
    return out({checks:results||[]});
   }
   if(m==="POST"){
    let b={};try{b=await request.json()}catch{}
    if(!b.collector_name)return out({error:"Falta collector_name"},400);
    const row=await db.prepare(`INSERT INTO collector_compliance_checks
      (client_id,credit_item_id,collector_name,legal_name,jurisdiction,regulator,nmls_id,license_number,
       license_status,license_required_status,source_url,source_title,source_checked_at,effective_date,
       expiration_date,reviewer_notes,human_verified)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING *`)
      .bind(clientId,b.credit_item_id||null,String(b.collector_name),b.legal_name||null,b.jurisdiction||"MD",
       b.regulator||"Maryland Office of Financial Regulation / State Collection Agency Licensing Board",
       b.nmls_id||null,b.license_number||null,b.license_status||"pending_review",
       b.license_required_status||"review_required",b.source_url||null,b.source_title||null,
       b.source_checked_at||null,b.effective_date||null,b.expiration_date||null,
       b.reviewer_notes||null,!!b.human_verified).first();
    return out({check:row},201);
   }
  }catch(e){return out({error:"Collector Compliance falló",detail:String(e?.message||e)},500)}
 }
 return v1172.fetch(request,env,ctx);
}};