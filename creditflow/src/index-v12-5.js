// CreditFlow v12.5 — Auto Audit Engine
import v123 from "./index-v12-3.js";
import baseWorker from "./index.js";
import { createD1Shim } from "./db-shim.js";

const out=(x,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{
 "content-type":"application/json; charset=utf-8","cache-control":"no-store"
}});

async function auth(req,env,ctx){
 const u=new URL(req.url);u.pathname="/api/auth/status";u.search="";
 const r=await baseWorker.fetch(new Request(u,{method:"GET",headers:req.headers}),env,ctx);
 if(!r.ok)return false;try{return !!(await r.json()).authenticated}catch{return false}
}
function norm(v){return String(v??"").trim().toLowerCase().replace(/\s+/g," ")}
function key(i){
 const digits=String(i.account_number||"").replace(/\D/g,"");
 return `${norm(i.creditor_name)}|${digits.slice(-4)||norm(i.account_number)}`;
}
function bureau(v){
 const s=norm(v);
 if(s.includes("experian"))return "Experian";
 if(s.includes("equifax"))return "Equifax";
 if(s.includes("transunion")||s.includes("trans union"))return "TransUnion";
 return String(v||"Otro");
}
function isCollector(i){
 const c=norm(i.category),s=norm(i.status_raw||i.status),n=norm(i.creditor_name);
 return c.includes("collection")||c.includes("coleccion")||c.includes("charge")||
        s.includes("collection")||s.includes("charge off")||n.includes("collection")||
        n.includes("recovery")||n.includes("receivable");
}
const FIELDS=[
 ["balance","Balance","balance_mismatch"],
 ["status_raw","Estado","status_mismatch"],
 ["date_opened","Fecha de apertura","date_mismatch"],
 ["opened_date","Fecha de apertura","date_mismatch"],
 ["date_of_first_delinquency","Primera morosidad","date_mismatch"],
 ["first_delinquency_date","Primera morosidad","date_mismatch"],
 ["last_payment_date","Último pago","date_mismatch"],
 ["original_creditor","Acreedor original","furnisher_data_mismatch"],
 ["account_type","Tipo de cuenta","other"],
 ["payment_status","Payment status","status_mismatch"]
];
function compareGroup(g){
 const out=[],seen=new Set();
 for(const [field,label,issue] of FIELDS){
  if(seen.has(label))continue;
  const vals=g.map(x=>({bureau:bureau(x.bureaus),value:x[field]}))
   .filter(x=>x.value!==null&&x.value!==undefined&&String(x.value).trim()!=="");
  if(vals.length<2)continue;
  if(new Set(vals.map(x=>norm(x.value))).size>1){
    out.push({field,label,issue,values:vals});seen.add(label);
  }
 }
 return out;
}
function assessmentFor(item,group,findings,check){
 const relevant=findings;
 if(relevant.length){
   const issue=relevant[0].issue||"other";
   const basis=relevant.map(f=>`${f.label}: ${f.values.map(v=>`${v.bureau}=${v.value}`).join(" | ")}`).join("\n");
   return {
     issue_type:issue,
     accuracy_status:"incomplete",
     evidence_status:"report_comparison",
     confidence:85,
     dispute_basis:`CreditFlow detectó información inconsistente entre los burós para la misma cuenta.\n${basis}`,
     evidence_notes:`Comparación automática del reporte. Debe disputarse únicamente la inconsistencia factual detectada.${isCollector(item)?" Collection/charge-off: revisar además compliance del collector.":""}`,
     desired_resolution:"Investigar y corregir los campos inconsistentes para que la información reportada sea exacta y completa.",
     findings:relevant
   };
 }
 if(isCollector(item) && check?.human_verified && check.license_required_status==="required" &&
    ["inactive","not_found"].includes(check.license_status)){
   return {
     issue_type:"other",accuracy_status:"unknown",evidence_status:"other_document",confidence:80,
     dispute_basis:"No se detectó una inconsistencia inter-buró suficiente para una disputa factual automática.",
     evidence_notes:`Existe un hallazgo regulatorio separado del collector (${check.license_status}) en ${check.jurisdiction||"la jurisdicción registrada"}. No implica automáticamente que la deuda sea inválida.`,
     desired_resolution:"Revisar el hallazgo regulatorio por separado antes de decidir una acción.",
     findings:[]
   };
 }
 return {
   issue_type:"unknown",accuracy_status:"unknown",evidence_status:"none",confidence:65,
   dispute_basis:group.length>1
     ?"No se detectó una inconsistencia material entre los burós con los campos disponibles en el reporte."
     :"La cuenta aparece en un solo buró o no hay suficientes datos comparables para confirmar una inconsistencia automáticamente.",
   evidence_notes:"CreditFlow no generará una disputa factual solo porque la cuenta sea negativa.",
   desired_resolution:"Mantener en revisión; no disputar automáticamente sin una base factual adicional.",
   findings:[]
 };
}

async function prepare(request,env,ctx,clientId){
 const db=createD1Shim(env);
 const [{results:items},{results:assessments}] = await Promise.all([
  db.prepare(`SELECT * FROM credit_items WHERE client_id=? ORDER BY id`).bind(clientId).all(),
  db.prepare(`SELECT * FROM dispute_assessments WHERE client_id=?`).bind(clientId).all()
 ]);
 let checks=[];
 try{checks=(await db.prepare(`SELECT * FROM collector_compliance_checks WHERE client_id=? ORDER BY updated_at DESC,id DESC`).bind(clientId).all()).results||[]}catch{}

 const groups=new Map();
 for(const i of items||[]){
   if(i.removed_status==="eliminado")continue;
   const k=key(i);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(i);
 }
 let created=0,updated=0,skippedHuman=0;
 for(const group of groups.values()){
   const findings=compareGroup(group);
   for(const item of group){
     const existing=(assessments||[]).find(a=>String(a.credit_item_id)===String(item.id));
     if(existing?.human_verified){skippedHuman++;continue}
     const check=checks.find(c=>String(c.credit_item_id||"")===String(item.id))||
                 checks.find(c=>norm(c.collector_name)===norm(item.creditor_name));
     const a=assessmentFor(item,group,findings,check);
     const findingsJson=JSON.stringify(a.findings);
     if(existing){
       await db.prepare(`
         UPDATE dispute_assessments SET
          issue_type=?,accuracy_status=?,evidence_status=?,confidence=?,
          dispute_basis=?,evidence_notes=?,desired_resolution=?,
          auto_assessed=TRUE,auto_ready=TRUE,assessment_source='creditflow_auto_v12_5',
          auto_findings_json=?,auto_assessed_at=NOW(),updated_at=NOW()
         WHERE id=?
       `).bind(a.issue_type,a.accuracy_status,a.evidence_status,a.confidence,a.dispute_basis,
          a.evidence_notes,a.desired_resolution,findingsJson,existing.id).run();
       updated++;
     }else{
       await db.prepare(`
        INSERT INTO dispute_assessments
        (client_id,credit_item_id,issue_type,accuracy_status,evidence_status,consumer_confirmed,
         identity_theft_confirmed,confidence,dispute_basis,evidence_notes,desired_resolution,
         recommended_route,human_verified,auto_assessed,auto_ready,assessment_source,
         auto_findings_json,auto_assessed_at)
        VALUES (?,?,?,?,?,FALSE,FALSE,?,?,?,?, '',FALSE,TRUE,TRUE,'creditflow_auto_v12_5',?,NOW())
       `).bind(clientId,item.id,a.issue_type,a.accuracy_status,a.evidence_status,a.confidence,
          a.dispute_basis,a.evidence_notes,a.desired_resolution,findingsJson).run();
       created++;
     }
   }
 }

 // Build the strategy immediately after auto-audit.
 const u=new URL(request.url);
 u.pathname=`/api/strategy/client/${clientId}/build`;u.search="";
 const buildReq=new Request(u.toString(),{method:"POST",headers:request.headers});
 const buildResp=await v123.fetch(buildReq,env,ctx);
 let build={};
 try{build=await buildResp.clone().json()}catch{}
 if(!buildResp.ok){
   return out({error:build.error||"La auditoría automática terminó, pero la estrategia no pudo construirse.",
     detail:build.detail||null,created,updated,skippedHuman},buildResp.status);
 }
 return out({
   ok:true,engine:"v12.5",created,updated,skippedHuman,
   planned:build.planned||0,blocked:build.blocked||0,
   message:"Auditoría automática completada y estrategia preparada."
 });
}

export default{async fetch(request,env,ctx){
 const u=new URL(request.url),m=request.method.toUpperCase();
 const match=u.pathname.match(/^\/api\/automation\/client\/(\d+)\/prepare-strategy$/);
 if(m==="POST"&&match){
   if(!(await auth(request,env,ctx)))return out({error:"No autorizado"},401);
   try{return await prepare(request,env,ctx,Number(match[1]))}
   catch(e){return out({error:"Auto Audit Engine v12.5 falló",detail:String(e?.message||e)},500)}
 }
 return v123.fetch(request,env,ctx);
}};
