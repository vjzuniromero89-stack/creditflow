// CreditFlow v13.6 — Dual Track Strategy: CRA + Creditor/Collector
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
  return String(body||"")
    .replace(/\\n/g,"\n")
    .replace(/\{\{([a-zA-Z0-9_]+)\}\}/g,(_,k)=>map[k]??"");
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


function directRouteFor(item){
  const c=norm(item.category).replace(/\s+/g,"_");
  if(["coleccion","collection","collections"].includes(c))
    return {template_id:64,code:"ACE40",label:"Collector Validation / Information Challenge",recipient_type:"collector"};
  if(["charge_off","chargeoff","charged_off"].includes(c))
    return {template_id:67,code:"ACE61",label:"Charge-Off Reporting Review",recipient_type:"creditor"};
  if(["pago_tardio","late_payment","late","late_payments"].includes(c))
    return {template_id:68,code:"ACE62",label:"Late Payment Reporting Review",recipient_type:"creditor"};
  if(["liquidada","liquidado","settled","settled_account"].includes(c))
    return {template_id:70,code:"ACE64",label:"Settled Account Reporting Review",recipient_type:"creditor"};
  if(["inquiry","inquiries","consulta","hard_inquiry"].includes(c))
    return {template_id:69,code:"ACE63",label:"Permissible-Purpose Information Request",recipient_type:"creditor"};
  return null;
}
function normalizedPostal(v){
  return String(v||"").replace(/\\n/g,"\n").replace(/\r/g,"").trim();
}
function directAccountKey(item){
  return `${entityKey(item.creditor_name)}|${String(item.account_number||"").trim().toLowerCase()}`;
}
function directMapFor(client,item,recipient){
  const cityStateZip=[client.city||"",[client.state||"",client.zip||""].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const reason=[
    `This request concerns the reporting for ${item.creditor_name||"the account"}.`,
    item.status_raw?`Reported status: ${item.status_raw}.`:"",
    item.balance?`Reported balance: ${item.balance}.`:"",
    item.past_due?`Reported past due: ${item.past_due}.`:"",
    item.date_reported?`Date reported: ${item.date_reported}.`:"",
    item.date_opened?`Date opened: ${item.date_opened}.`:"",
    `The account is appearing on the consumer report. Please review the specific reporting above and provide the results and any responsive account information in writing.`
  ].filter(Boolean).join(" ");
  return {
    fecha:new Date().toLocaleDateString("en-US"),
    cliente_nombre:client.full_name||"",
    cliente_direccion:client.address||"",
    cliente_ciudad_estado_zip:cityStateZip,
    cliente_fecha_nacimiento:client.date_of_birth||"",
    cliente_id_last4:client.id_last4||"",
    destinatario_nombre:recipient.name,
    destinatario_direccion:recipient.address,
    acreedor_nombre:item.creditor_name||"",
    numero_cuenta:item.account_number||"",
    motivo_disputa:reason
  };
}
async function ensureDirectLetters(db,client,items){
  const unique=new Map();
  for(const item of items){
    const route=directRouteFor(item);
    if(!route)continue;
    const key=directAccountKey(item);
    if(!unique.has(key))unique.set(key,{item,route,key});
  }

  let created=0,updated=0,unresolved=0;
  const details=[];
  for(const entry of unique.values()){
    const {item,route,key}=entry;
    const entity=await resolveCreditorCollector(db,item.creditor_name);
    if(!entity){
      unresolved++;
      details.push({account_key:key,creditor:item.creditor_name,resolved:false});
      continue;
    }
    const recipientName=String(entity.mailing_name||entity.canonical_name||item.creditor_name||"")
      .replace(/\\n/g," ").replace(/\s+/g," ").trim();
    const recipientAddress=normalizedPostal(entity.mailing_address||item.creditor_address);
    if(!recipientAddress){
      unresolved++;
      details.push({account_key:key,creditor:item.creditor_name,resolved:false,reason:"missing_address"});
      continue;
    }

    const tpl=await db.prepare(`SELECT * FROM letter_templates WHERE id=? AND is_active=1`).bind(route.template_id).first();
    if(!tpl){
      unresolved++;
      details.push({account_key:key,creditor:item.creditor_name,resolved:false,reason:"missing_template"});
      continue;
    }

    const body=renderTemplate(tpl.body,directMapFor(client,item,{name:recipientName,address:recipientAddress}));
    const title=`${route.label} — ${item.creditor_name||item.account_number||"Account"}`;
    const note=`simple_strategy_v13_5:DIRECT:${route.code}:${key}`;

    const existing=await db.prepare(`
      SELECT * FROM letters
      WHERE client_id=? AND notes=?
        AND status IN ('borrador','lista','enviada','en_transito','entregada','respondida','completada')
      ORDER BY id DESC LIMIT 1
    `).bind(client.id,note).first();

    if(existing){
      if(["borrador","lista"].includes(existing.status)){
        await db.prepare(`
          UPDATE letters
          SET template_id=?,credit_item_id=?,title=?,recipient_name=?,recipient_address=?,
              body=?,notes=?,updated_at=NOW()
          WHERE id=?
        `).bind(route.template_id,item.id,title,recipientName,recipientAddress,body,note,existing.id).run();
        updated++;
      }
    }else{
      await db.prepare(`
        INSERT INTO letters(
          client_id,template_id,credit_item_id,title,recipient_name,recipient_address,
          round_number,body,status,include_id_copy,include_address_proof,include_ssn_copy,notes
        ) VALUES(?,?,?,?,?,?,1,?,'borrador',?,?,?,?)
      `).bind(
        client.id,route.template_id,item.id,title,recipientName,recipientAddress,body,
        tpl.include_id_copy||0,tpl.include_address_proof||0,tpl.include_ssn_copy||0,note
      ).run();
      created++;
    }
    details.push({
      account_key:key,creditor:item.creditor_name,resolved:true,
      recipient_name:recipientName,recipient_address:recipientAddress,
      category:item.category
    });
  }
  return {expected:unique.size,created,updated,unresolved,details};
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
      WHERE client_id=? AND credit_item_id=? AND notes LIKE 'simple_strategy_v13_5:CRA_ROUND1%'
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
  const direct=await ensureDirectLetters(db,client,items);
  return {
    ok:true,created,updated,unresolved,total:items.length,
    entities_resolved:entityResolution.resolved,
    entities_unresolved:entityResolution.unresolved,
    entity_resolution:entityResolution.entities,
    direct
  };
}

async function status(db,clientId){
  const [{results:items=[]},{results:letters=[]}]=await Promise.all([
    db.prepare(`SELECT * FROM credit_items WHERE client_id=? AND COALESCE(removed_status,'') NOT IN ('removed','deleted','eliminado') ORDER BY id`).bind(clientId).all(),
    db.prepare(`SELECT * FROM letters WHERE client_id=? AND notes LIKE 'simple_strategy_v13_5:%' ORDER BY id DESC`).bind(clientId).all()
  ]);
  const eligible=items.filter(i=>eligibleCategory(i.category));

  const uniqueDirect=new Map();
  for(const item of eligible){
    if(directRouteFor(item))uniqueDirect.set(directAccountKey(item),item);
  }

  let entitiesResolved=0,entitiesUnresolved=0;
  for(const item of uniqueDirect.values()){
    if(await resolveCreditorCollector(db,item.creditor_name))entitiesResolved++;
    else entitiesUnresolved++;
  }

  const craLetters=letters.filter(l=>String(l.notes||"").startsWith("simple_strategy_v13_5:CRA_ROUND1"));
  const directLetters=letters.filter(l=>String(l.notes||"").startsWith("simple_strategy_v13_5:DIRECT:"));
  const expectedCra=eligible.length;
  const expectedDirect=uniqueDirect.size;
  const expectedTotal=expectedCra+expectedDirect;

  return {
    negatives:eligible.length,
    cra_expected:expectedCra,
    cra_generated:craLetters.length,
    direct_expected:expectedDirect,
    direct_generated:directLetters.length,
    expected_total:expectedTotal,
    generated:letters.length,
    remaining:Math.max(0,expectedTotal-letters.length),
    complete:expectedTotal>0 && letters.length>=expectedTotal,
    ready:letters.filter(l=>l.status==="lista").length,
    drafts:letters.filter(l=>l.status==="borrador").length,
    missing_address:letters.filter(l=>!String(l.recipient_address||"").trim()).length,
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
  // v13.5.5 HOTFIX:
  // Approval must be lightweight. v13.5.4 re-ran full normalization + entity
  // resolution during approval, producing dozens of Supabase subrequests.
  // By this point the 21 draft letters already contain their bureau addresses.
  const summary=await db.prepare(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status='borrador')::int AS drafts,
      COUNT(*) FILTER (WHERE COALESCE(TRIM(recipient_address),'')='')::int AS missing_address
    FROM letters
    WHERE client_id=? AND notes LIKE 'simple_strategy_v13_5%'
  `).bind(clientId).first();

  const total=Number(summary?.total||0);
  const drafts=Number(summary?.drafts||0);
  const missing=Number(summary?.missing_address||0);

  if(total===0)
    return {error:"No hay cartas de estrategia para aprobar.",status:409};
  if(missing>0)
    return {error:`Faltan ${missing} dirección(es) postales.`,status:409,missing_address:missing};

  // One bulk DB operation instead of one UPDATE per letter.
  await db.prepare(`
    UPDATE letters
    SET status='lista',updated_at=NOW()
    WHERE client_id=?
      AND notes LIKE 'simple_strategy_v13_5%'
      AND status='borrador'
      AND COALESCE(TRIM(recipient_address),'')<>''
  `).bind(clientId).run();

  await db.prepare(`
    UPDATE repair_cases
    SET current_stage='mailing_ready',
        next_action='Abrir Envíos certificados',
        approval_required=FALSE,
        approved_for_auto_send=TRUE,
        certified_mail_status='ready',
        updated_at=NOW()
    WHERE client_id=?
  `).bind(clientId).run();

  const finalCounts=await db.prepare(`
    SELECT
      COUNT(*)::int AS generated,
      COUNT(*) FILTER (WHERE status='lista')::int AS ready,
      COUNT(*) FILTER (WHERE status='borrador')::int AS drafts,
      COUNT(*) FILTER (WHERE COALESCE(TRIM(recipient_address),'')='')::int AS missing_address
    FROM letters
    WHERE client_id=? AND notes LIKE 'simple_strategy_v13_5%'
  `).bind(clientId).first();

  return {
    ok:true,
    approved:drafts,
    generated:Number(finalCounts?.generated||total),
    ready:Number(finalCounts?.ready||0),
    drafts:Number(finalCounts?.drafts||0),
    missing_address:Number(finalCounts?.missing_address||0)
  };
}

// -----------------------------------------------------------------------------
// v13.5.6 — Grouped Certified Mail Packages
// One PostGrid letter/envelope per client + recipient + round.
// Multiple dispute letters are rendered as separate pages inside the same envelope.
// -----------------------------------------------------------------------------
const PG_PACKAGE_BASE="https://api.postgrid.com/print-mail/v1";

function pgEsc(s){
  return String(s??"").replace(/[&<>"']/g,c=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[c]));
}
function recipientKey(name,address,round=1){
  return `${String(name||"").trim().toLowerCase()}|${String(address||"").replace(/\s+/g," ").trim().toLowerCase()}|r${round}`;
}
function splitClientName(full){
  const p=String(full||"").trim().split(/\s+/).filter(Boolean);
  return {firstName:p[0]||"CreditFlow",lastName:p.slice(1).join(" ")||undefined};
}
function parsePostalAddress(raw,name){
  const s=String(raw||"").replace(/\r/g,"").trim();
  if(!s)return null;
  const lines=s.split("\n").map(x=>x.trim()).filter(Boolean);
  let addressLine1="",addressLine2,city,provinceOrState,postalOrZip;
  if(lines.length>=2){
    const m=lines.at(-1).match(/^(.+?),\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
    if(m){
      city=m[1].trim(); provinceOrState=m[2].toUpperCase(); postalOrZip=m[3];
      const a=lines.slice(0,-1);
      if(a[0]?.toLowerCase()===String(name||"").toLowerCase())a.shift();
      addressLine1=a[0]||"";
      addressLine2=a.slice(1).join(", ")||undefined;
    }
  }
  if(!addressLine1){
    const m=s.match(/^(.*?)(?:,\s*)?([^,\n]+?),\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
    if(m){
      const chunks=m[1].replace(/,\s*$/,"").split(/,\s*/).filter(Boolean);
      if(chunks[0]?.toLowerCase()===String(name||"").toLowerCase())chunks.shift();
      addressLine1=chunks[0]||m[1];
      addressLine2=chunks.slice(1).join(", ")||undefined;
      city=m[2].trim(); provinceOrState=m[3].toUpperCase(); postalOrZip=m[4];
    }
  }
  if(!addressLine1||!city||!provinceOrState||!postalOrZip)return null;
  return {companyName:name||"Recipient",addressLine1,addressLine2,city,provinceOrState,postalOrZip,countryCode:"US"};
}
async function pgPackage(env,path,opt={}){
  const key=env.POSTGRID_TEST_API_KEY;
  if(!key)throw new Error("POSTGRID_TEST_API_KEY no está configurada en Cloudflare.");
  const h=new Headers(opt.headers||{});
  h.set("X-API-Key",key);
  if(opt.body&&!h.has("Content-Type"))h.set("Content-Type","application/json");
  const r=await fetch(`${PG_PACKAGE_BASE}${path}`,{...opt,headers:h});
  let d={}; try{d=await r.json()}catch{}
  if(!r.ok){
    const e=new Error(d?.message||d?.error?.message||d?.error||`PostGrid HTTP ${r.status}`);
    e.status=r.status;e.payload=d;throw e;
  }
  return d;
}
function packagePayload(pkg,client,letters){
  const to=parsePostalAddress(pkg.recipient_address,pkg.recipient_name);
  if(!to)throw new Error("No se pudo interpretar la dirección del destinatario.");
  if(!client.address||!client.city||!client.state||!client.zip)
    throw new Error("El cliente necesita dirección, ciudad, estado y ZIP completos.");

  const n=splitClientName(client.full_name);
  const from={
    firstName:n.firstName,lastName:n.lastName,addressLine1:client.address,
    city:client.city,provinceOrState:client.state,postalOrZip:client.zip,
    countryCode:"US",phoneNumber:client.phone||undefined
  };

  const pages=letters.map((l,i)=>`
    <section class="cf-letter ${i?"new-page":""}">
      <div class="letter">${pgEsc(l.body||"")}</div>
    </section>`).join("\n");

  const html=`<!doctype html><html><head><meta charset="utf-8"><style>
    @page{size:Letter;margin:.75in}
    body{font-family:Arial,Helvetica,sans-serif;font-size:11pt;line-height:1.45;color:#111}
    .letter{white-space:pre-wrap}
    .new-page{break-before:page;page-break-before:always}
  </style></head><body>${pages}</body></html>`;

  const ids=letters.map(l=>String(l.id));
  return {
    from,to,html,addressPlacement:"top_first_page",
    mailingClass:pkg.mailing_class||"certified_return_receipt",
    description:`CreditFlow ${pkg.internal_reference} - ${letters.length} cartas para ${pkg.recipient_name}`.slice(0,200),
    color:false,doubleSided:false,
    metadata:{
      creditflowPackageId:String(pkg.id),
      creditflowClientId:String(pkg.client_id),
      creditflowLetterIds:ids.join(","),
      internalReference:String(pkg.internal_reference)
    }
  };
}

async function groupedPackageStatus(db){
  const {results:ready=[]}=await db.prepare(`
    SELECT l.id,l.client_id,l.title,l.recipient_name,l.recipient_address,l.round_number,l.status,
           c.full_name AS client_name
    FROM letters l
    JOIN clients c ON c.id=l.client_id
    WHERE l.status='lista'
      AND NOT EXISTS (
        SELECT 1 FROM certified_mail_package_letters pl WHERE pl.letter_id=l.id
      )
    ORDER BY c.full_name,l.recipient_name,l.round_number,l.id
  `).all();

  const groupsMap=new Map();
  for(const l of ready){
    const key=`${l.client_id}::${recipientKey(l.recipient_name,l.recipient_address,l.round_number||1)}`;
    if(!groupsMap.has(key)){
      groupsMap.set(key,{
        group_key:key,client_id:l.client_id,client_name:l.client_name,
        recipient_name:l.recipient_name,recipient_address:l.recipient_address,
        round_number:Number(l.round_number||1),letter_ids:[],letters:[]
      });
    }
    const g=groupsMap.get(key);
    g.letter_ids.push(Number(l.id));
    g.letters.push({id:Number(l.id),title:l.title});
  }
  const groups=[...groupsMap.values()].map(g=>({...g,letter_count:g.letter_ids.length}));

  const {results:packages=[]}=await db.prepare(`
    SELECT p.*,c.full_name AS client_name,
      COALESCE((SELECT COUNT(*)::int FROM certified_mail_package_letters pl WHERE pl.package_id=p.id),0) AS letter_count,
      COALESCE((SELECT json_agg(json_build_object('id',l.id,'title',l.title) ORDER BY l.id)
                FROM certified_mail_package_letters pl
                JOIN letters l ON l.id=pl.letter_id
                WHERE pl.package_id=p.id),'[]'::json) AS letters
    FROM certified_mail_packages p
    LEFT JOIN clients c ON c.id=p.client_id
    WHERE p.provider='postgrid'
    ORDER BY p.created_at DESC
    LIMIT 100
  `).all();

  return {
    ready_letters_count:ready.length,
    ready_packages_count:groups.length,
    groups,
    packages:packages||[]
  };
}

async function preparePackage(db,body={}){
  const ids=Array.isArray(body.letter_ids)?body.letter_ids.map(Number).filter(Number.isFinite):[];
  if(!ids.length)return {error:"No se recibieron cartas para el paquete.",status:400};
  const placeholders=ids.map(()=>"?").join(",");
  const {results:letters=[]}=await db.prepare(`
    SELECT l.*,c.full_name,c.address,c.city,c.state,c.zip,c.phone
    FROM letters l JOIN clients c ON c.id=l.client_id
    WHERE l.id IN (${placeholders})
    ORDER BY l.id
  `).bind(...ids).all();

  if(letters.length!==ids.length)return {error:"Una o más cartas no fueron encontradas.",status:404};
  if(letters.some(l=>l.status!=="lista"))return {error:"Todas las cartas del paquete deben estar en estado Lista.",status:409};

  const first=letters[0];
  const round=Number(first.round_number||1);
  const key=recipientKey(first.recipient_name,first.recipient_address,round);
  const mismatch=letters.some(l=>
    Number(l.client_id)!==Number(first.client_id) ||
    Number(l.round_number||1)!==round ||
    recipientKey(l.recipient_name,l.recipient_address,l.round_number||1)!==key
  );
  if(mismatch)return {error:"Solo se pueden agrupar cartas del mismo cliente, destinatario y ronda.",status:409};

  const {results:claimed=[]}=await db.prepare(`
    SELECT letter_id FROM certified_mail_package_letters WHERE letter_id IN (${placeholders})
  `).bind(...ids).all();
  if(claimed.length)return {error:"Una o más cartas ya pertenecen a otro paquete certificado.",status:409};

  const mailingClass=body.mailing_class==="certified"?"certified":"certified_return_receipt";
  let pkg=await db.prepare(`
    INSERT INTO certified_mail_packages(
      repair_case_id,client_id,provider,status,provider_environment,
      recipient_name,recipient_address,recipient_key,round_number,mailing_class,internal_reference
    ) VALUES(
      (SELECT id FROM repair_cases WHERE client_id=? LIMIT 1),?,
      'postgrid','prepared_test','test',?,?,?,?,?,NULL
    ) RETURNING *
  `).bind(
    first.client_id,first.client_id,first.recipient_name,first.recipient_address,
    key,round,mailingClass
  ).first();

  const ref=`CFP-${pkg.id}-C${first.client_id}-R${round}`;
  await db.prepare(`UPDATE certified_mail_packages SET internal_reference=?,updated_at=NOW() WHERE id=?`)
    .bind(ref,pkg.id).run();
  pkg={...pkg,internal_reference:ref,mailing_class:mailingClass};

  const values=ids.map(()=>"(?,?)").join(",");
  const params=[];
  for(const id of ids){params.push(pkg.id,id)}
  await db.prepare(`INSERT INTO certified_mail_package_letters(package_id,letter_id) VALUES ${values}`)
    .bind(...params).run();

  const payload=packagePayload(pkg,first,letters);
  await db.prepare(`
    UPDATE certified_mail_packages
    SET payload_json=?,updated_at=NOW()
    WHERE id=?
  `).bind(JSON.stringify(payload),pkg.id).run();

  return {
    ok:true,package_id:Number(pkg.id),internal_reference:ref,
    letter_count:letters.length,recipient_name:first.recipient_name
  };
}

async function submitPackage(db,env,id){
  const pkg=await db.prepare(`SELECT * FROM certified_mail_packages WHERE id=? AND provider='postgrid' LIMIT 1`).bind(id).first();
  if(!pkg)return {error:"Paquete no encontrado.",status:404};
  if(pkg.provider_environment!=="test")return {error:"LIVE está bloqueado en esta versión.",status:409};
  if(pkg.provider_job_id)return {error:"Este paquete ya tiene una orden en PostGrid. Usa Sincronizar.",status:409};

  const client=await db.prepare(`SELECT * FROM clients WHERE id=?`).bind(pkg.client_id).first();
  const {results:letters=[]}=await db.prepare(`
    SELECT l.* FROM certified_mail_package_letters pl
    JOIN letters l ON l.id=pl.letter_id
    WHERE pl.package_id=?
    ORDER BY l.id
  `).bind(id).all();

  let payload;
  try{payload=typeof pkg.payload_json==="string"?JSON.parse(pkg.payload_json):pkg.payload_json}catch{payload=null}
  if(!payload?.to)payload=packagePayload(pkg,client,letters);

  await db.prepare(`
    UPDATE certified_mail_packages
    SET provider_attempts=provider_attempts+1,updated_at=NOW()
    WHERE id=?
  `).bind(id).run();

  try{
    const d=await pgPackage(env,"/letters",{
      method:"POST",
      headers:{"Idempotency-Key":`creditflow-package-test-${pkg.id}`},
      body:JSON.stringify(payload)
    });
    const tracking=d?.trackingNumber||d?.tracking_number||null;
    await db.prepare(`
      UPDATE certified_mail_packages
      SET status='submitted_test',provider_job_id=?,provider_status=?,tracking_number=?,
          provider_live=${d?.live?"TRUE":"FALSE"},response_json=?,submitted_at=NOW(),updated_at=NOW(),error_message=NULL
      WHERE id=?
    `).bind(
      d?.id||null,d?.status||"created",tracking,JSON.stringify(d),id
    ).run();
    return {ok:true,test:true,live:!!d?.live,letter_count:letters.length,postgrid:d};
  }catch(e){
    await db.prepare(`
      UPDATE certified_mail_packages
      SET status='error',error_message=?,response_json=?,updated_at=NOW()
      WHERE id=?
    `).bind(String(e.message).slice(0,2000),JSON.stringify(e.payload||{}),id).run();
    return {error:e.message,details:e.payload||null,status:e.status&&e.status<500?400:502};
  }
}

async function syncPackage(db,env,id){
  const pkg=await db.prepare(`SELECT * FROM certified_mail_packages WHERE id=? AND provider='postgrid' LIMIT 1`).bind(id).first();
  if(!pkg)return {error:"Paquete no encontrado.",status:404};
  if(!pkg.provider_job_id)return {error:"Todavía no tiene ID de PostGrid.",status:409};
  try{
    const d=await pgPackage(env,`/letters/${encodeURIComponent(pkg.provider_job_id)}`,{method:"GET"});
    const tracking=d?.trackingNumber||d?.tracking_number||pkg.tracking_number||null;
    await db.prepare(`
      UPDATE certified_mail_packages
      SET provider_status=?,tracking_number=?,provider_live=${d?.live?"TRUE":"FALSE"},response_json=?,
          last_tracking_at=NOW(),updated_at=NOW(),error_message=NULL
      WHERE id=?
    `).bind(
      d?.status||pkg.provider_status,tracking,JSON.stringify(d),id
    ).run();
    return {ok:true,postgrid:d};
  }catch(e){
    return {error:e.message,status:e.status&&e.status<500?400:502};
  }
}

export default{
  async fetch(request,env,ctx){

    const u=new URL(request.url),m=request.method.toUpperCase();

    // v13.5.6 grouped certified mail package routes.
    if(u.pathname==="/api/postgrid/package-status"&&m==="GET"){
      if(!(await auth(request,env,ctx)))return out({error:"No autorizado"},401);
      try{return out(await groupedPackageStatus(createD1Shim(env)))}
      catch(e){return out({error:"No se pudieron cargar los paquetes certificados",detail:String(e?.message||e)},500)}
    }
    if(u.pathname==="/api/postgrid/packages/prepare"&&m==="POST"){
      if(!(await auth(request,env,ctx)))return out({error:"No autorizado"},401);
      try{
        let body={}; try{body=await request.json()}catch{}
        const r=await preparePackage(createD1Shim(env),body);
        return out(r,r.error?(r.status||400):200);
      }catch(e){return out({error:"No se pudo preparar el paquete",detail:String(e?.message||e)},500)}
    }
    let packageHit=u.pathname.match(/^\/api\/postgrid\/packages\/(\d+)\/(submit|sync)$/);
    if(packageHit&&m==="POST"){
      if(!(await auth(request,env,ctx)))return out({error:"No autorizado"},401);
      try{
        const db=createD1Shim(env),id=Number(packageHit[1]),action=packageHit[2];
        const r=action==="submit"?await submitPackage(db,env,id):await syncPackage(db,env,id);
        return out(r,r.error?(r.status||400):200);
      }catch(e){return out({error:"Falló la operación del paquete PostGrid",detail:String(e?.message||e)},500)}
    }
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
