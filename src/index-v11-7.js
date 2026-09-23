import v114Worker from "./index-v11-4.js";
import baseWorker from "./index.js";
import { createD1Shim } from "./db-shim.js";
const out=(x,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
async function auth(request,env,ctx){const u=new URL(request.url);u.pathname="/api/auth/status";u.search="";const r=await baseWorker.fetch(new Request(u,{method:"GET",headers:request.headers}),env,ctx);if(!r.ok)return false;try{return !!(await r.json()).authenticated}catch{return false}}
async function counts(db,id){
 const row=await db.prepare(`SELECT
 (SELECT COUNT(*) FROM credit_items WHERE client_id=? AND COALESCE(removed_status,'')<>'eliminado') AS total,
 (SELECT COUNT(*) FROM dispute_assessments da JOIN credit_items ci ON ci.id=da.credit_item_id WHERE da.client_id=? AND da.human_verified=TRUE AND COALESCE(ci.removed_status,'')<>'eliminado') AS assessed`).bind(id,id).first();
 return {total:Number(row?.total||0),assessed:Number(row?.assessed||0)};
}
export default{async fetch(request,env,ctx){
 const u=new URL(request.url),p=u.pathname,m=request.method.toUpperCase(),db=createD1Shim(env);
 const reopen=p.match(/^\/api\/audit-v11-7\/(\d+)\/reopen$/);
 if(reopen&&m==="POST"){
  if(!(await auth(request,env,ctx)))return out({error:"No autorizado"},401);
  const c=await counts(db,reopen[1]); if(c.total&&c.assessed<c.total){
   await db.prepare(`UPDATE repair_cases SET current_stage='report_audit',next_action='Auditar cada ítem del reporte',updated_at=NOW() WHERE client_id=?`).bind(reopen[1]).run();
  }
  return out({ok:true,...c});
 }
 const action=p.match(/^\/api\/repair-cases\/(\d+)\/action$/);
 if(action&&m==="POST"){
  let b={};try{b=await request.clone().json()}catch{}
  if(b.action==="complete_report_audit"){
   if(!(await auth(request,env,ctx)))return out({error:"No autorizado"},401);
   const c=await counts(db,action[1]);
   if(!c.total)return out({error:"No hay ítems activos para auditar."},409);
   if(c.assessed<c.total)return out({error:`Auditoría incompleta: ${c.assessed} de ${c.total} ítems revisados.`,code:"AUDIT_INCOMPLETE",...c},409);
  }
 }
 return v114Worker.fetch(request,env,ctx);
}};
