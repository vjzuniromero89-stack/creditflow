// CreditFlow v13.5 — Simple Strategy Flow
// Removes the separate Aggressive Compliance UI and turns "Empezar estrategia"
// into the single entry point for all negative accounts.
import v134 from "./index-v13-4.js";
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
  if(["coleccion","collection","collections"].includes(c))
    return {template_id:64,code:"ACE40",label:"Collection Challenge",recipient_type:"collector"};
  if(["charge_off","chargeoff","charged_off"].includes(c))
    return {template_id:67,code:"ACE61",label:"Charge-Off Reporting Challenge",recipient_type:"furnisher"};
  if(["pago_tardio","late_payment","late","late_payments"].includes(c))
    return {template_id:68,code:"ACE62",label:"Late Payment Reporting Challenge",recipient_type:"furnisher"};
  if(["inquiry","inquiries","consulta","hard_inquiry"].includes(c))
    return {template_id:69,code:"ACE63",label:"Inquiry Permissible-Purpose Challenge",recipient_type:"furnisher"};
  return null;
}

function renderTemplate(body,map){
  return String(body||"").replace(/\{\{([a-zA-Z0-9_]+)\}\}/g,(_,k)=>map[k]??"");
}

function mapFor(client,item,recipientName,recipientAddress){
  const cityStateZip=[client.city||"",[client.state||"",client.zip||""].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const reason=[
    `This request concerns the reporting shown for ${item.creditor_name||"the account"}.`,
    item.status_raw?`Reported status: ${item.status_raw}.`:"",
    item.balance?`Reported balance: ${item.balance}.`:"",
    item.past_due?`Reported past due: ${item.past_due}.`:"",
    item.date_reported?`Date reported: ${item.date_reported}.`:"",
    item.date_opened?`Date opened: ${item.date_opened}.`:"",
    item.bureaus?`Bureau(s): ${item.bureaus}.`:"",
    "Please review the account-level information and respond in writing with the results of the applicable investigation or validation process."
  ].filter(Boolean).join(" ");
  return {
    fecha:new Date().toLocaleDateString("en-US"),
    cliente_nombre:client.full_name||"",
    cliente_direccion:client.address||"",
    cliente_ciudad_estado_zip:cityStateZip,
    cliente_fecha_nacimiento:client.date_of_birth||"",
    cliente_id_last4:client.id_last4||"",
    destinatario_nombre:recipientName||item.creditor_name||"",
    destinatario_direccion:recipientAddress||item.creditor_address||"",
    acreedor_nombre:item.creditor_name||"",
    numero_cuenta:item.account_number||"",
    motivo_disputa:reason
  };
}

async function status(db,clientId){
  const [{results:items=[]},{results:letters=[]}]=await Promise.all([
    db.prepare(`SELECT * FROM credit_items WHERE client_id=? AND COALESCE(removed_status,'') NOT IN ('removed','deleted','eliminado') ORDER BY id`).bind(clientId).all(),
    db.prepare(`SELECT * FROM letters WHERE client_id=? AND notes LIKE 'simple_strategy_v13_5%' ORDER BY id DESC`).bind(clientId).all()
  ]);
  const eligible=items.filter(i=>routeFor(i));
  const ready=letters.filter(l=>l.status==="lista").length;
  const missingAddress=letters.filter(l=>!String(l.recipient_address||"").trim()).length;
  return {
    negatives:eligible.length,
    generated:letters.length,
    ready,
    drafts:letters.filter(l=>l.status==="borrador").length,
    missing_address:missingAddress,
    letters
  };
}

async function startStrategy(db,clientId){
  const client=await db.prepare(`SELECT * FROM clients WHERE id=?`).bind(clientId).first();
  if(!client)return {error:"Cliente no encontrado",status:404};

  const {results:items=[]}=await db.prepare(`
    SELECT * FROM credit_items
    WHERE client_id=? AND COALESCE(removed_status,'') NOT IN ('removed','deleted','eliminado')
    ORDER BY id
  `).bind(clientId).all();

  let created=0,reused=0;
  for(const item of items){
    const route=routeFor(item); if(!route)continue;
    const existing=await db.prepare(`
      SELECT id FROM letters
      WHERE client_id=? AND credit_item_id=? AND template_id=?
        AND notes LIKE 'simple_strategy_v13_5%'
        AND status IN ('borrador','lista','enviado')
      LIMIT 1
    `).bind(clientId,item.id,route.template_id).first();
    if(existing){reused++;continue}

    const tpl=await db.prepare(`SELECT * FROM letter_templates WHERE id=? AND is_active=1`).bind(route.template_id).first();
    if(!tpl)continue;

    const recipientName=item.creditor_name||tpl.recipient_hint||"";
    const recipientAddress=item.creditor_address||"";
    const letterBody=renderTemplate(tpl.body,mapFor(client,item,recipientName,recipientAddress));
    const title=`${route.label} — ${item.creditor_name||item.account_number||"Account"}`;

    await db.prepare(`
      INSERT INTO letters(
        client_id,template_id,credit_item_id,title,recipient_name,recipient_address,
        round_number,body,status,include_id_copy,include_address_proof,include_ssn_copy,notes
      ) VALUES(?,?,?,?,?,?,1,?,'borrador',?,?,?,?)
    `).bind(
      clientId,route.template_id,item.id,title,recipientName,recipientAddress,letterBody,
      tpl.include_id_copy||0,tpl.include_address_proof||0,tpl.include_ssn_copy||0,
      `simple_strategy_v13_5:${route.code}:${route.recipient_type}`
    ).run();
    created++;
  }

  let rc=await db.prepare(`SELECT * FROM repair_cases WHERE client_id=? LIMIT 1`).bind(clientId).first();
  if(!rc){
    rc=await db.prepare(`
      INSERT INTO repair_cases(
        client_id,status,automation_mode,current_stage,next_action,approval_required,
        approved_for_auto_send,certified_mail_status,started_at,last_transition_at
      ) VALUES(?,'active','automatic','approval_required','Revisar y enviar cartas',TRUE,FALSE,'not_started',NOW(),NOW())
      RETURNING *
    `).bind(clientId).first();
  }else{
    await db.prepare(`
      UPDATE repair_cases
      SET status='active',automation_mode='automatic',current_stage='approval_required',
          next_action='Revisar y enviar cartas',approval_required=TRUE,
          approved_for_auto_send=FALSE,last_transition_at=NOW(),updated_at=NOW()
      WHERE client_id=?
    `).bind(clientId).run();
  }

  return {ok:true,created,reused,...await status(db,clientId)};
}

async function approveAll(db,clientId){
  const {results:letters=[]}=await db.prepare(`
    SELECT * FROM letters
    WHERE client_id=? AND notes LIKE 'simple_strategy_v13_5%' AND status='borrador'
  `).bind(clientId).all();

  let ready=0,missingAddress=0;
  for(const l of letters){
    if(String(l.recipient_address||"").trim()){
      await db.prepare(`UPDATE letters SET status='lista',updated_at=NOW() WHERE id=?`).bind(l.id).run();
      ready++;
    }else{
      missingAddress++;
    }
  }

  await db.prepare(`
    UPDATE repair_cases
    SET current_stage='mailing_ready',next_action='Abrir Envíos certificados',
        approval_required=FALSE,approved_for_auto_send=TRUE,last_transition_at=NOW(),updated_at=NOW()
    WHERE client_id=?
  `).bind(clientId).run();

  return {ok:true,ready,missing_address:missingAddress,...await status(db,clientId)};
}

export default{
  async fetch(request,env,ctx){
    const u=new URL(request.url),m=request.method.toUpperCase();
    let hit=u.pathname.match(/^\/api\/simple-strategy\/client\/(\d+)\/status$/);
    if(hit&&m==="GET"){
      if(!(await auth(request,env,ctx)))return out({error:"No autorizado"},401);
      try{return out(await status(createD1Shim(env),Number(hit[1])))}
      catch(e){return out({error:"No se pudo cargar la estrategia",detail:String(e?.message||e)},500)}
    }

    hit=u.pathname.match(/^\/api\/simple-strategy\/client\/(\d+)\/start$/);
    if(hit&&m==="POST"){
      if(!(await auth(request,env,ctx)))return out({error:"No autorizado"},401);
      try{const r=await startStrategy(createD1Shim(env),Number(hit[1]));return out(r,r.error?(r.status||400):200)}
      catch(e){return out({error:"No se pudo iniciar la estrategia",detail:String(e?.message||e)},500)}
    }

    hit=u.pathname.match(/^\/api\/simple-strategy\/client\/(\d+)\/approve-all$/);
    if(hit&&m==="POST"){
      if(!(await auth(request,env,ctx)))return out({error:"No autorizado"},401);
      try{return out(await approveAll(createD1Shim(env),Number(hit[1])))}
      catch(e){return out({error:"No se pudieron preparar las cartas para Envíos",detail:String(e?.message||e)},500)}
    }

    return v134.fetch(request,env,ctx);
  }
};
