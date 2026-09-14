// CreditFlow v13.5.3 — Automatic Bureau Addressing
// Round 1 goes to the CRA reporting each negative item.
// Bureau name/address are resolved automatically from the report's bureau field.
import v134 from "./index-v13-4.js";
import baseWorker from "./index.js";
import { createD1Shim } from "./db-shim.js";

const out=(x,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{
  "content-type":"application/json; charset=utf-8","cache-control":"no-store"
}});

const BUREAUS={
  experian:{name:"Experian",address:"Experian\nP.O. Box 4500\nAllen, TX 75013"},
  transunion:{name:"TransUnion",address:"TransUnion Consumer Solutions\nP.O. Box 2000\nChester, PA 19016-2000"},
  equifax:{name:"Equifax",address:"Equifax Information Services LLC\nP.O. Box 740256\nAtlanta, GA 30374"}
};

async function auth(req,env,ctx){
  const u=new URL(req.url);u.pathname="/api/auth/status";u.search="";
  const r=await baseWorker.fetch(new Request(u,{method:"GET",headers:req.headers}),env,ctx);
  if(!r.ok)return false;
  try{return !!(await r.json()).authenticated}catch{return false}
}

function norm(v){
  return String(v||"").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
}
function bureauFor(v){
  const x=norm(v).replace(/[^a-z]/g,"");
  if(x.includes("experian"))return BUREAUS.experian;
  if(x.includes("transunion"))return BUREAUS.transunion;
  if(x.includes("equifax"))return BUREAUS.equifax;
  return null;
}
function eligibleCategory(v){
  const c=norm(v).replace(/\s+/g,"_");
  return ["coleccion","collection","collections","charge_off","chargeoff","charged_off",
    "pago_tardio","late_payment","late","late_payments","inquiry","inquiries","consulta",
    "hard_inquiry","liquidada","liquidado","settled","settled_account"].includes(c);
}
function categoryLabel(v){
  const c=norm(v).replace(/\s+/g,"_");
  if(["coleccion","collection","collections"].includes(c))return "Collection";
  if(["charge_off","chargeoff","charged_off"].includes(c))return "Charge-Off";
  if(["pago_tardio","late_payment","late","late_payments"].includes(c))return "Late Payment";
  if(["inquiry","inquiries","consulta","hard_inquiry"].includes(c))return "Inquiry";
  if(["liquidada","liquidado","settled","settled_account"].includes(c))return "Settled Account";
  return "Negative Account";
}
function renderTemplate(body,map){
  return String(body||"").replace(/\{\{([a-zA-Z0-9_]+)\}\}/g,(_,k)=>map[k]??"");
}
function mapFor(client,item,bureau){
  const cityStateZip=[client.city||"",[client.state||"",client.zip||""].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const basis=[
    `Category: ${categoryLabel(item.category)}.`,
    `Creditor/furnisher: ${item.creditor_name||"not shown"}.`,
    `Account/reference: ${item.account_number||"not shown"}.`,
    item.status_raw?`Reported status: ${item.status_raw}.`:"",
    item.balance?`Reported balance: ${item.balance}.`:"",
    item.past_due?`Reported past due: ${item.past_due}.`:"",
    item.date_reported?`Date reported: ${item.date_reported}.`:"",
    item.date_opened?`Date opened: ${item.date_opened}.`:"",
    `This item appears in the ${bureau.name} consumer report. Please conduct the applicable reinvestigation of the information being reported and provide the results in writing.`
  ].filter(Boolean).join(" ");
  return {
    fecha:new Date().toLocaleDateString("en-US"),
    cliente_nombre:client.full_name||"",
    cliente_direccion:client.address||"",
    cliente_ciudad_estado_zip:cityStateZip,
    cliente_fecha_nacimiento:client.date_of_birth||"",
    cliente_id_last4:client.id_last4||"",
    destinatario_nombre:bureau.name,
    destinatario_direccion:bureau.address,
    acreedor_nombre:item.creditor_name||"",
    numero_cuenta:item.account_number||"",
    motivo_disputa:basis
  };
}


function entityKey(v){
  return norm(v).replace(/[^a-z0-9]/g,"");
}
async function resolveCreditorCollector(db,name){
  const key=entityKey(name);
  if(!key)return null;

  let row=await db.prepare(`
    SELECT d.* FROM recipient_aliases a
    JOIN recipient_directory d ON d.id=a.recipient_id
    WHERE a.alias_normalized=? AND d.active=TRUE
    LIMIT 1
  `).bind(key).first();
  if(row)return row;

  // Common report abbreviations such as SYNCB/store-name keep a stable prefix.
  const prefixes=["syncb","lvnvfunding","lvnvfundg","santanderconsumer","brclyodnvy","seccredit"];
  const prefix=prefixes.find(p=>key.startsWith(p));
  if(prefix){
    row=await db.prepare(`
      SELECT d.* FROM recipient_aliases a
      JOIN recipient_directory d ON d.id=a.recipient_id
      WHERE a.alias_normalized=? AND d.active=TRUE
      LIMIT 1
    `).bind(prefix).first();
  }
  return row||null;
}

async function resolveAllEntities(db,items){
  let resolved=0,unresolved=0;
  const entities=[];
  for(const item of items){
    const r=await resolveCreditorCollector(db,item.creditor_name);
    if(r){
      resolved++;
      entities.push({
        credit_item_id:item.id,
        reported_name:item.creditor_name,
        canonical_name:r.canonical_name,
        entity_type:r.entity_type,
        mailing_name:r.mailing_name,
        mailing_address:r.mailing_address,
        address_purpose:r.address_purpose,
        source_url:r.source_url,
        verified_at:r.verified_at
      });
      // Persist the verified directory address on the tradeline for later creditor/collector rounds.
      if(!String(item.creditor_address||"").trim()){
        await db.prepare(`UPDATE credit_items SET creditor_address=? WHERE id=?`).bind(r.mailing_address,item.id).run();
        item.creditor_address=r.mailing_address;
      }
    }else{
      unresolved++;
      entities.push({
        credit_item_id:item.id,
        reported_name:item.creditor_name,
        canonical_name:null,
        entity_type:null,
        mailing_address:null,
        unresolved:true
      });
    }
  }
  return {resolved,unresolved,entities};
}

async function getContext(db,clientId){
  const [client,{results:items=[]},tpl]=await Promise.all([
    db.prepare(`SELECT * FROM clients WHERE id=?`).bind(clientId).first(),
    db.prepare(`SELECT * FROM credit_items WHERE client_id=? AND COALESCE(removed_status,'') NOT IN ('removed','deleted','eliminado') ORDER BY id`).bind(clientId).all(),
    db.prepare(`SELECT * FROM letter_templates WHERE id=61 AND is_active=1`).first()
  ]);
  return {client,items:items.filter(i=>eligibleCategory(i.category)),tpl};
}

async function normalizeLetters(db,clientId){
  const {client,items,tpl}=await getContext(db,clientId);
  if(!client)return {error:"Cliente no encontrado",status:404};
  if(!tpl)return {error:"La plantilla CRA Round 1 no está disponible.",status:500};

  const entityResolution=await resolveAllEntities(db,items);
  let created=0,updated=0,unresolved=0;
  for(const item of items){
    const bureau=bureauFor(item.bureaus);
    if(!bureau){unresolved++;continue}

    const body=renderTemplate(tpl.body,mapFor(client,item,bureau));
    const title=`Round 1 CRA Challenge — ${item.creditor_name||item.account_number||"Account"} — ${bureau.name}`;
    const notes=`simple_strategy_v13_5:CRA_ROUND1:${categoryLabel(item.category)}:${bureau.name}`;

    const existing=await db.prepare(`
      SELECT * FROM letters
      WHERE client_id=? AND credit_item_id=? AND notes LIKE 'simple_strategy_v13_5%'
        AND status IN ('borrador','lista')
      ORDER BY id DESC LIMIT 1
    `).bind(clientId,item.id).first();

    if(existing){
      await db.prepare(`
        UPDATE letters
        SET template_id=61,title=?,recipient_name=?,recipient_address=?,body=?,status='borrador',
            include_id_copy=?,include_address_proof=?,include_ssn_copy=?,notes=?,updated_at=NOW()
        WHERE id=?
      `).bind(
        title,bureau.name,bureau.address,body,
        tpl.include_id_copy||0,tpl.include_address_proof||0,tpl.include_ssn_copy||0,
        notes,existing.id
      ).run();
      updated++;
    }else{
      await db.prepare(`
        INSERT INTO letters(
          client_id,template_id,credit_item_id,title,recipient_name,recipient_address,
          round_number,body,status,include_id_copy,include_address_proof,include_ssn_copy,notes
        ) VALUES(?,61,?,?,?,?,1,?,'borrador',?,?,?,?)
      `).bind(
        clientId,item.id,title,bureau.name,bureau.address,body,
        tpl.include_id_copy||0,tpl.include_address_proof||0,tpl.include_ssn_copy||0,notes
      ).run();
      created++;
    }
  }
  return {
    ok:true,created,updated,unresolved,total:items.length,
    entities_resolved:entityResolution.resolved,
    entities_unresolved:entityResolution.unresolved,
    entity_resolution:entityResolution.entities
  };
}

async function status(db,clientId){
  const [{results:items=[]},{results:letters=[]}]=await Promise.all([
    db.prepare(`SELECT * FROM credit_items WHERE client_id=? AND COALESCE(removed_status,'') NOT IN ('removed','deleted','eliminado') ORDER BY id`).bind(clientId).all(),
    db.prepare(`SELECT * FROM letters WHERE client_id=? AND notes LIKE 'simple_strategy_v13_5%' ORDER BY id DESC`).bind(clientId).all()
  ]);
  const eligible=items.filter(i=>eligibleCategory(i.category));
  let entitiesResolved=0,entitiesUnresolved=0;
  for(const item of eligible){
    if(await resolveCreditorCollector(db,item.creditor_name))entitiesResolved++;
    else entitiesUnresolved++;
  }
  const ready=letters.filter(l=>l.status==="lista").length;
  const missingAddress=letters.filter(l=>!String(l.recipient_address||"").trim()).length;
  return {
    negatives:eligible.length,
    generated:letters.length,
    remaining:Math.max(0,eligible.length-letters.length),
    complete:eligible.length>0 && letters.length>=eligible.length,
    ready,
    drafts:letters.filter(l=>l.status==="borrador").length,
    missing_address:missingAddress,
    entities_resolved:entitiesResolved,
    entities_unresolved:entitiesUnresolved,
    letters
  };
}

async function ensureRepairCase(db,clientId){
  const rc=await db.prepare(`SELECT * FROM repair_cases WHERE client_id=? LIMIT 1`).bind(clientId).first();
  if(!rc){
    await db.prepare(`
      INSERT INTO repair_cases(
        client_id,status,automation_mode,current_stage,next_action,approval_required,
        approved_for_auto_send,certified_mail_status,started_at
      ) VALUES(?,'active','automatic','approval_required','Revisar y enviar cartas',TRUE,FALSE,'not_started',NOW())
    `).bind(clientId).run();
  }else{
    await db.prepare(`
      UPDATE repair_cases
      SET status='active',automation_mode='automatic',current_stage='approval_required',
          next_action='Revisar y enviar cartas',approval_required=TRUE,
          approved_for_auto_send=FALSE,updated_at=NOW()
      WHERE client_id=?
    `).bind(clientId).run();
  }
}

async function startStrategy(db,clientId){
  const r=await normalizeLetters(db,clientId);
  if(r.error)return r;
  await ensureRepairCase(db,clientId);
  return {...r,...await status(db,clientId)};
}

async function approveAll(db,clientId){
  // Always normalize recipient names/addresses immediately before approval.
  const normalized=await normalizeLetters(db,clientId);
  if(normalized.error)return normalized;

  const st=await status(db,clientId);
  if(!st.complete)return {error:`La estrategia está incompleta: faltan ${st.remaining} carta(s).`,status:409,...st};
  if(st.missing_address>0)return {error:`Faltan ${st.missing_address} dirección(es) postales.`,status:409,...st};

  const {results:letters=[]}=await db.prepare(`
    SELECT * FROM letters
    WHERE client_id=? AND notes LIKE 'simple_strategy_v13_5%' AND status='borrador'
  `).bind(clientId).all();

  let ready=0;
  for(const l of letters){
    await db.prepare(`UPDATE letters SET status='lista',updated_at=NOW() WHERE id=?`).bind(l.id).run();
    ready++;
  }

  await db.prepare(`
    UPDATE repair_cases
    SET current_stage='mailing_ready',next_action='Abrir Envíos certificados',
        approval_required=FALSE,approved_for_auto_send=TRUE,updated_at=NOW()
    WHERE client_id=?
  `).bind(clientId).run();

  return {ok:true,ready,normalized,...await status(db,clientId)};
}

export default{
  async fetch(request,env,ctx){
    const u=new URL(request.url),m=request.method.toUpperCase();
    let hit=u.pathname.match(/^\/api\/simple-strategy\/client\/(\d+)\/recipient-resolution$/);
    if(hit&&m==="GET"){
      if(!(await auth(request,env,ctx)))return out({error:"No autorizado"},401);
      try{
        const db=createD1Shim(env);
        const {items=[]}=await getContext(db,Number(hit[1]));
        return out(await resolveAllEntities(db,items));
      }catch(e){return out({error:"No se pudieron resolver acreedores/collectors",detail:String(e?.message||e)},500)}
    }

    hit=u.pathname.match(/^\/api\/simple-strategy\/client\/(\d+)\/status$/);
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
      try{const r=await approveAll(createD1Shim(env),Number(hit[1]));return out(r,r.error?(r.status||400):200)}
      catch(e){return out({error:"No se pudieron preparar las cartas para Envíos",detail:String(e?.message||e)},500)}
    }

    return v134.fetch(request,env,ctx);
  }
};
