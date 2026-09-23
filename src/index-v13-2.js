// CreditFlow v13.2 — ACE Challenge Campaign
// Isolated from normal Strategy / Letters / Mail until explicit handoff.
import v131 from "./index-v13-1.js";
import baseWorker from "./index.js";
import { createD1Shim } from "./db-shim.js";
const json=(x,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
async function auth(req,env,ctx){const u=new URL(req.url);u.pathname="/api/auth/status";u.search="";const r=await baseWorker.fetch(new Request(u,{method:"GET",headers:req.headers}),env,ctx);if(!r.ok)return false;try{return !!(await r.json()).authenticated}catch{return false}}
function plan(f){
 const code=f.finding_code;
 if(code==="COLLECTOR_COMPLIANCE_UNVERIFIED"||code==="OWNERSHIP_DOCUMENTATION_REVIEW") return {eligible:true,target_type:"collector",template_id:64,template_code:"ACE40",round:1,title:"Collector Validation / Information Challenge",deadline_days:null,deadline_basis:"Validation rights depend on timing and facts; do not treat as an automatic 30-day deletion deadline."};
 if(code==="COLLECTOR_LICENSE_SIGNAL") return {eligible:true,target_type:"collector",template_id:64,template_code:"ACE40",round:1,title:"Collector Compliance Challenge",deadline_days:null,deadline_basis:"Use the confirmed official licensing/compliance finding; no automatic deletion assumption."};
 if(code==="CROSS_BUREAU_MISMATCH"||code==="POSSIBLE_DUPLICATE"||code==="AGING_REVIEW") return {eligible:f.actionability==="actionable",target_type:"cra",template_id:61,template_code:"ACE10",round:1,title:"Round 1 — Formal CRA Reinvestigation",deadline_days:30,deadline_basis:"FCRA reinvestigation generally 30 days; system must allow a lawful extension up to 45 days where applicable."};
 if(code==="REINSERTION") return {eligible:f.actionability==="actionable",target_type:"cra",template_id:49,template_code:"PRO32",round:1,title:"Reinsertion Challenge",deadline_days:30,deadline_basis:"Track the actual reinsertion notice/history and applicable FCRA requirements."};
 if(code==="RESPONSE_DEADLINE_REVIEW") return {eligible:f.actionability==="actionable",target_type:"cra",template_id:63,template_code:"ACE30",round:3,title:"Documented Compliance Failure Review",deadline_days:null,deadline_basis:"Only use after actual delivery/deadline facts establish a compliance issue."};
 if(code==="LATE_PAYMENT_DEEP_REVIEW"||code==="CHARGEOFF_FIELD_REVIEW") return {eligible:false,target_type:"furnisher",template_id:65,template_code:"ACE50",round:1,title:"Direct Furnisher Factual Dispute",deadline_days:30,deadline_basis:"Requires a specific disputed fact and basis before a direct dispute can be prepared.",block_reason:"No specific factual contradiction has been established yet."};
 return {eligible:false,target_type:"review",title:"Further review",block_reason:"No supported challenge route is available from this finding yet."};
}
async function getCampaigns(db,clientId){const {results}=await db.prepare(`SELECT * FROM aggressive_compliance_campaigns WHERE client_id=? ORDER BY id DESC`).bind(clientId).all();return results||[]}
async function prepare(db,clientId,findingId){
 const f=await db.prepare(`SELECT * FROM aggressive_compliance_findings WHERE id=? AND client_id=?`).bind(findingId,clientId).first();
 if(!f)return {error:"Hallazgo no encontrado.",status:404};
 const p=plan(f); if(!p.eligible)return {error:p.block_reason||"Este hallazgo todavía no tiene base suficiente para preparar una campaña.",plan:p,status:409};
 const existing=await db.prepare(`SELECT * FROM aggressive_compliance_campaigns WHERE client_id=? AND finding_id=? AND status IN ('draft','approved','sent','delivered','waiting_response') ORDER BY id DESC LIMIT 1`).bind(clientId,findingId).first();
 if(existing)return {ok:true,campaign:existing,plan:p,reused:true};
 const basis=f.investigation_result||f.detail||f.recommended_action||"";
 const r=await db.prepare(`INSERT INTO aggressive_compliance_campaigns(client_id,finding_id,credit_item_id,target_type,target_name,bureau,round_number,status,factual_basis,template_code,template_id,deadline_days,deadline_basis,metadata_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING *`).bind(clientId,f.id,f.credit_item_id||null,p.target_type,f.creditor_name||null,f.bureau||null,p.round,"draft",basis,p.template_code,p.template_id,p.deadline_days||null,p.deadline_basis,JSON.stringify({engine:"v13.2",finding_code:f.finding_code,actionability:f.actionability})).first();
 await db.prepare(`INSERT INTO aggressive_compliance_campaign_events(campaign_id,client_id,event_type,detail,metadata_json) VALUES(?,?,?,?,?)`).bind(r.id,clientId,"prepared","ACE campaign prepared from isolated Aggressive Compliance finding",JSON.stringify({finding_id:f.id,template_code:p.template_code})).run();
 return {ok:true,campaign:r,plan:p};
}
export default{async fetch(request,env,ctx){
 const u=new URL(request.url),m=request.method.toUpperCase();
 let hit=u.pathname.match(/^\/api\/aggressive-compliance\/client\/(\d+)\/campaigns$/);
 if(hit&&m==="GET"){if(!(await auth(request,env,ctx)))return json({error:"No autorizado"},401);try{return json({campaigns:await getCampaigns(createD1Shim(env),Number(hit[1]))})}catch(e){return json({error:"No se pudieron cargar campañas ACE",detail:String(e?.message||e)},500)}}
 hit=u.pathname.match(/^\/api\/aggressive-compliance\/client\/(\d+)\/findings\/(\d+)\/prepare-campaign$/);
 if(hit&&m==="POST"){if(!(await auth(request,env,ctx)))return json({error:"No autorizado"},401);try{const r=await prepare(createD1Shim(env),Number(hit[1]),Number(hit[2]));if(r.error)return json(r,r.status||400);return json(r)}catch(e){return json({error:"No se pudo preparar la campaña ACE",detail:String(e?.message||e)},500)}}
 return v131.fetch(request,env,ctx);
}};
