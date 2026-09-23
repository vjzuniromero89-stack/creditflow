// CreditFlow v13.4 — Universal Challenge Campaign
// No audit/investigation gate inside Aggressive Compliance.
// Builds lawful category-specific challenge campaigns for eligible negative items.
import v133 from "./index-v13-3.js";
import baseWorker from "./index.js";
import { createD1Shim } from "./db-shim.js";

const out=(x,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{
  "content-type":"application/json; charset=utf-8","cache-control":"no-store"
}});

async function auth(req,env,ctx){
  const u=new URL(req.url);u.pathname="/api/auth/status";u.search="";
  const r=await baseWorker.fetch(new Request(u,{method:"GET",headers:req.headers}),env,ctx);
  if(!r.ok)return false;
  try{return !!(await r.json()).authenticated}catch{return false}
}

function normCategory(v){
  return String(v||"").trim().toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .replace(/\s+/g,"_");
}

function routeFor(item){
  const c=normCategory(item.category);
  if(["coleccion","collection","collections"].includes(c)){
    return {
      eligible:true,
      campaign_type:"collection_validation",
      target_type:"collector",
      template_id:64,
      template_code:"ACE40",
      label:"Collection Challenge",
      deadline_mode:"collector_validation_rules",
      next_action:"approve",
      note:"Validation/information challenge. No client-document evidence gate."
    };
  }
  if(["charge_off","chargeoff","charged_off"].includes(c)){
    return {
      eligible:true,
      campaign_type:"chargeoff_reporting_review",
      target_type:"furnisher",
      template_id:67,
      template_code:"ACE61",
      label:"Charge-Off Reporting Challenge",
      deadline_mode:"response_tracking",
      next_action:"approve",
      note:"Account-level reporting review. Does not invent a factual error."
    };
  }
  if(["pago_tardio","late_payment","late","late_payments"].includes(c)){
    return {
      eligible:true,
      campaign_type:"late_payment_reporting_review",
      target_type:"furnisher",
      template_id:68,
      template_code:"ACE62",
      label:"Late Payment Reporting Challenge",
      deadline_mode:"response_tracking",
      next_action:"approve",
      note:"Payment-history review without falsely claiming the payment was timely."
    };
  }
  if(["inquiry","inquiries","consulta","hard_inquiry"].includes(c)){
    return {
      eligible:true,
      campaign_type:"inquiry_permissible_purpose",
      target_type:"furnisher",
      template_id:69,
      template_code:"ACE63",
      label:"Inquiry Permissible-Purpose Challenge",
      deadline_mode:"response_tracking",
      next_action:"approve",
      note:"Requests permissible-purpose information without falsely claiming unauthorized access."
    };
  }
  return {eligible:false};
}

function basisFor(item){
  const parts=[
    `Category: ${item.category||"unknown"}`,
    `Reported status: ${item.status_raw||"not provided"}`,
    `Balance: ${item.balance||"not provided"}`,
    `Past due: ${item.past_due||"not provided"}`,
    `Date reported: ${item.date_reported||"not provided"}`,
    `Date opened: ${item.date_opened||"not provided"}`,
    `Bureaus: ${item.bureaus||"not provided"}`
  ];
  return `Request a documented review of the reporting shown in the imported consumer report. ${parts.join("; ")}.`;
}

async function dashboard(db,clientId){
  const {results:items=[]}=await db.prepare(`
    SELECT * FROM credit_items
    WHERE client_id=? AND COALESCE(removed_status,'') NOT IN ('removed','deleted')
    ORDER BY id
  `).bind(clientId).all();

  const eligible=items.map(i=>({item:i,route:routeFor(i)})).filter(x=>x.route.eligible);

  const {results:campaigns=[]}=await db.prepare(`
    SELECT * FROM aggressive_compliance_campaigns
    WHERE client_id=? AND source='aggressive_compliance'
    ORDER BY id DESC
  `).bind(clientId).all();

  return {
    items:eligible.map(x=>({
      id:x.item.id,
      category:x.item.category,
      creditor_name:x.item.creditor_name,
      account_number:x.item.account_number,
      status_raw:x.item.status_raw,
      balance:x.item.balance,
      past_due:x.item.past_due,
      date_reported:x.item.date_reported,
      date_opened:x.item.date_opened,
      bureaus:x.item.bureaus,
      creditor_address:x.item.creditor_address,
      challenge:x.route
    })),
    campaigns,
    counts:{
      eligible:eligible.length,
      collections:eligible.filter(x=>x.route.campaign_type==="collection_validation").length,
      chargeoffs:eligible.filter(x=>x.route.campaign_type==="chargeoff_reporting_review").length,
      late_payments:eligible.filter(x=>x.route.campaign_type==="late_payment_reporting_review").length,
      inquiries:eligible.filter(x=>x.route.campaign_type==="inquiry_permissible_purpose").length,
      campaigns:campaigns.length
    }
  };
}

async function buildAll(db,clientId){
  const dash=await dashboard(db,clientId);
  let created=0,reused=0;
  const createdIds=[];

  for(const item of dash.items){
    const r=item.challenge;
    const existing=await db.prepare(`
      SELECT * FROM aggressive_compliance_campaigns
      WHERE client_id=? AND credit_item_id=? AND template_code=?
        AND status IN ('draft','approved','sent','delivered','waiting_response','responded')
      ORDER BY id DESC LIMIT 1
    `).bind(clientId,item.id,r.template_code).first();

    if(existing){reused++;continue}

    const basis=basisFor(item);
    const c=await db.prepare(`
      INSERT INTO aggressive_compliance_campaigns(
        client_id,finding_id,credit_item_id,campaign_type,target_type,target_name,bureau,
        round_number,status,factual_basis,template_code,template_id,deadline_days,deadline_basis,
        deadline_mode,deadline_status,next_action,source,metadata_json
      ) VALUES(?,NULL,?,?,?,?,?,1,'draft',?,?,?,?,?,'not_started',?,'aggressive_compliance',?)
      RETURNING *
    `).bind(
      clientId,item.id,r.campaign_type,r.target_type,item.creditor_name||null,item.bureaus||null,
      basis,r.template_code,r.template_id,null,r.note,r.deadline_mode,r.next_action,
      JSON.stringify({engine:"v13.4",category:item.category,account_number:item.account_number||null})
    ).first();

    await db.prepare(`
      INSERT INTO aggressive_compliance_campaign_events(
        campaign_id,client_id,event_type,detail,metadata_json
      ) VALUES(?,?,?,?,?)
    `).bind(
      c.id,clientId,"challenge_created",
      `${r.label} created automatically from the reported negative item.`,
      JSON.stringify({credit_item_id:item.id,template_code:r.template_code})
    ).run();

    created++;createdIds.push(c.id);
  }

  return {ok:true,eligible:dash.items.length,created,reused,created_ids:createdIds};
}

export default{
  async fetch(request,env,ctx){
    const u=new URL(request.url),m=request.method.toUpperCase();
    let hit=u.pathname.match(/^\/api\/aggressive-compliance\/client\/(\d+)\/challenge-dashboard$/);
    if(hit&&m==="GET"){
      if(!(await auth(request,env,ctx)))return out({error:"No autorizado"},401);
      try{return out(await dashboard(createD1Shim(env),Number(hit[1])))}
      catch(e){return out({error:"No se pudo cargar Challenge Campaign",detail:String(e?.message||e)},500)}
    }

    hit=u.pathname.match(/^\/api\/aggressive-compliance\/client\/(\d+)\/build-all-challenges$/);
    if(hit&&m==="POST"){
      if(!(await auth(request,env,ctx)))return out({error:"No autorizado"},401);
      try{return out(await buildAll(createD1Shim(env),Number(hit[1])))}
      catch(e){return out({error:"No se pudieron construir los challenges",detail:String(e?.message||e)},500)}
    }

    return v133.fetch(request,env,ctx);
  }
};
