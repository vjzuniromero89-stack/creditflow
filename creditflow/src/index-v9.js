import v8Worker from "./index-v8.js";
import { createD1Shim } from "./db-shim.js";

const BUREAU_ADDRESS = {
  Equifax: "Equifax Information Services LLC\nP.O. Box 740256\nAtlanta, GA 30374",
  Experian: "Experian\nP.O. Box 4500\nAllen, TX 75013",
  TransUnion: "TransUnion Consumer Solutions\nP.O. Box 2000\nChester, PA 19016-2000",
};

const PROFESSIONAL_TEMPLATES = [
  {
    code:"01", name:"[PRO 01] Personal Information Correction", category:"01 — Identity & File Accuracy",
    recipient_hint:"Credit Reporting Company", subject:"Correction of Inaccurate Personal Identifying Information",
    include_id_copy:1, include_address_proof:1, include_ssn_copy:0,
    body:`{{fecha}}

{{cliente_nombre}}
{{cliente_direccion}}
{{cliente_ciudad_estado_zip}}

{{destinatario_nombre}}
{{destinatario_direccion}}

Re: Correction of inaccurate personal identifying information

To Whom It May Concern:

I am writing to request correction of personal identifying information in my consumer file that is inaccurate, incomplete, or does not belong to me.

Correct information:
Name: {{cliente_nombre}}
Current address: {{cliente_direccion}}, {{cliente_ciudad_estado_zip}}
Date of birth: {{cliente_fecha_nacimiento}}
Last four digits: {{cliente_id_last4}}

Information disputed:
{{motivo_disputa}}

Please conduct a reasonable reinvestigation of the specific identifying information above and correct or remove information that is inaccurate or does not belong to me. I have included identification and proof of current address to assist in identifying my file.

Please send me the results and an updated consumer report.

Sincerely,

{{cliente_nombre}}`
  },
  {
    code:"02", name:"[PRO 02] Mixed File Correction", category:"01 — Identity & File Accuracy",
    recipient_hint:"Credit Reporting Company", subject:"Possible Mixed Consumer File",
    include_id_copy:1, include_address_proof:1, include_ssn_copy:0,
    body:`{{fecha}}

{{cliente_nombre}}
{{cliente_direccion}}
{{cliente_ciudad_estado_zip}}

{{destinatario_nombre}}
{{destinatario_direccion}}

Re: Possible mixed consumer file

To Whom It May Concern:

My consumer report appears to contain information that may belong to another consumer.

Specific information at issue:
{{motivo_disputa}}

Please conduct a reasonable reinvestigation to ensure that my file contains only information accurately associated with me. Correct or remove information that cannot be matched to my identity accurately.

I have included identification and proof of current address.

Sincerely,

{{cliente_nombre}}`
  },
  {
    code:"10", name:"[PRO 10] CRA Factual Dispute — Initial", category:"10 — CRA Factual Dispute",
    recipient_hint:"Credit Reporting Company", subject:"Dispute of Inaccurate or Incomplete Credit Information",
    include_id_copy:1, include_address_proof:1, include_ssn_copy:0,
    body:`{{fecha}}

{{cliente_nombre}}
{{cliente_direccion}}
{{cliente_ciudad_estado_zip}}

{{destinatario_nombre}}
{{destinatario_direccion}}

Re: {{acreedor_nombre}} / {{numero_cuenta}}

To Whom It May Concern:

I am disputing specific information appearing in my consumer report because I believe it is inaccurate or incomplete.

Account: {{acreedor_nombre}}
Reference: {{numero_cuenta}}

Specific information disputed and factual basis:
{{motivo_disputa}}

Please conduct a reasonable reinvestigation, review the supporting information provided, and correct or delete information that is inaccurate, incomplete, or cannot be verified.

Please provide the results and an updated consumer report.

Sincerely,

{{cliente_nombre}}`
  },
  {
    code:"11", name:"[PRO 11] Unauthorized Inquiry Dispute", category:"11 — Inquiry",
    recipient_hint:"Credit Reporting Company", subject:"Dispute of Unrecognized Inquiry",
    include_id_copy:1, include_address_proof:1, include_ssn_copy:0,
    body:`{{fecha}}

{{cliente_nombre}}
{{cliente_direccion}}
{{cliente_ciudad_estado_zip}}

{{destinatario_nombre}}
{{destinatario_direccion}}

Re: Unrecognized inquiry — {{acreedor_nombre}}

To Whom It May Concern:

I do not recognize or authorize the inquiry identified below.

Company: {{acreedor_nombre}}
Reference/date: {{numero_cuenta}}

Details:
{{motivo_disputa}}

Please investigate whether this inquiry belongs to me and whether there was a permissible basis for it. Correct or remove it if it was reported in error or does not belong to me.

Sincerely,

{{cliente_nombre}}`
  },
  {
    code:"12", name:"[PRO 12] Identity Theft Block — FCRA 605B", category:"12 — Identity Theft",
    recipient_hint:"Credit Reporting Company", subject:"Identity Theft Block Request",
    include_id_copy:1, include_address_proof:1, include_ssn_copy:1,
    body:`{{fecha}}

{{cliente_nombre}}
{{cliente_direccion}}
{{cliente_ciudad_estado_zip}}

{{destinatario_nombre}}
{{destinatario_direccion}}

Re: Identity theft block request

To Whom It May Concern:

I am a victim of identity theft and request that information resulting from identity theft be blocked from my consumer file.

Fraudulent information:
{{motivo_disputa}}

I am providing the supporting identity-theft documentation required for this request. The information identified above did not result from transactions made or authorized by me.

Please provide written confirmation of the action taken.

Sincerely,

{{cliente_nombre}}`
  },
  {
    code:"20", name:"[PRO 20] Debt Validation Information Request", category:"20 — Debt Collector",
    recipient_hint:"Debt Collector", subject:"Dispute and Request for Debt Validation Information",
    include_id_copy:0, include_address_proof:0, include_ssn_copy:0,
    body:`{{fecha}}

{{cliente_nombre}}
{{cliente_direccion}}
{{cliente_ciudad_estado_zip}}

{{destinatario_nombre}}
{{destinatario_direccion}}

Re: Alleged account {{numero_cuenta}}

To Whom It May Concern:

I am writing regarding the alleged debt referenced above. I dispute the account as described below and request the information necessary to identify and understand the debt.

{{motivo_disputa}}

Please provide the current creditor, amount claimed, account reference, and the information supporting the claim that I owe the debt. This letter is not an acknowledgment of liability or a promise to pay.

Sincerely,

{{cliente_nombre}}`
  },
  {
    code:"21", name:"[PRO 21] Direct Furnisher Dispute", category:"21 — Furnisher",
    recipient_hint:"Furnisher / Creditor", subject:"Direct Dispute of Furnished Credit Information",
    include_id_copy:1, include_address_proof:0, include_ssn_copy:0,
    body:`{{fecha}}

{{cliente_nombre}}
{{cliente_direccion}}
{{cliente_ciudad_estado_zip}}

{{destinatario_nombre}}
{{destinatario_direccion}}

Re: Direct dispute — {{acreedor_nombre}} / {{numero_cuenta}}

To Whom It May Concern:

I am submitting a direct dispute concerning information furnished about the account referenced above.

Specific information disputed:
{{motivo_disputa}}

Please conduct a reasonable investigation, review the supporting information provided, and correct any inaccurate information. If a correction is required, please update the consumer reporting companies to which the information was furnished.

Sincerely,

{{cliente_nombre}}`
  },
  {
    code:"30", name:"[PRO 30] CRA Reinvestigation — New Evidence", category:"30 — Follow-up",
    recipient_hint:"Credit Reporting Company", subject:"Follow-up Dispute With New Relevant Information",
    include_id_copy:1, include_address_proof:1, include_ssn_copy:0,
    body:`{{fecha}}

{{cliente_nombre}}
{{cliente_direccion}}
{{cliente_ciudad_estado_zip}}

{{destinatario_nombre}}
{{destinatario_direccion}}

Re: Follow-up dispute — {{acreedor_nombre}} / {{numero_cuenta}}

To Whom It May Concern:

I previously disputed this information. This follow-up contains new relevant information and/or a materially different factual basis.

New information or unresolved issue:
{{motivo_disputa}}

Please conduct a reasonable reinvestigation considering this new information and provide the results in writing.

Sincerely,

{{cliente_nombre}}`
  },
  {
    code:"31", name:"[PRO 31] FCRA 611(a)(7) Procedure Description Request", category:"31 — Procedure Review",
    recipient_hint:"Credit Reporting Company", subject:"Request for Description of Reinvestigation Procedure",
    include_id_copy:0, include_address_proof:0, include_ssn_copy:0,
    body:`{{fecha}}

{{cliente_nombre}}
{{cliente_direccion}}
{{cliente_ciudad_estado_zip}}

{{destinatario_nombre}}
{{destinatario_direccion}}

Re: Procedure request — {{acreedor_nombre}} / {{numero_cuenta}}

To Whom It May Concern:

I received the results of a reinvestigation concerning the account above and the disputed information was reported as verified.

I request a description of the procedure used to determine the accuracy and completeness of the disputed information, including the business name, address, and telephone number of each furnisher contacted, if reasonably available.

Dispute details:
{{motivo_disputa}}

Sincerely,

{{cliente_nombre}}`
  },
  {
    code:"32", name:"[PRO 32] Reinsertion Challenge", category:"32 — Reinsertion",
    recipient_hint:"Credit Reporting Company", subject:"Previously Deleted Information Has Reappeared",
    include_id_copy:1, include_address_proof:1, include_ssn_copy:0,
    body:`{{fecha}}

{{cliente_nombre}}
{{cliente_direccion}}
{{cliente_ciudad_estado_zip}}

{{destinatario_nombre}}
{{destinatario_direccion}}

Re: Previously deleted information reappearing — {{acreedor_nombre}} / {{numero_cuenta}}

To Whom It May Concern:

The information identified above was previously removed from my consumer report and has appeared again.

Details:
{{motivo_disputa}}

Please investigate the reinsertion and provide the information and notices applicable to previously deleted information that is reinserted. Correct or remove the information if the reinsertion requirements were not satisfied or the information is inaccurate.

Sincerely,

{{cliente_nombre}}`
  },
  {
    code:"40", name:"[PRO 40] Goodwill Adjustment Request", category:"40 — Goodwill",
    recipient_hint:"Creditor / Lender", subject:"Goodwill Request Regarding Payment History",
    include_id_copy:0, include_address_proof:0, include_ssn_copy:0,
    body:`{{fecha}}

{{cliente_nombre}}
{{cliente_direccion}}
{{cliente_ciudad_estado_zip}}

{{destinatario_nombre}}
{{destinatario_direccion}}

Re: Goodwill request — {{acreedor_nombre}} / {{numero_cuenta}}

To Whom It May Concern:

I am requesting a discretionary goodwill adjustment concerning the payment history on the account above. I am not alleging that accurate information is erroneous.

Background:
{{motivo_disputa}}

I respectfully ask whether your company would consider a goodwill adjustment based on the circumstances described above and my subsequent account history.

Thank you for your consideration.

Sincerely,

{{cliente_nombre}}`
  },
  {
    code:"41", name:"[PRO 41] Post-Payment Reporting Correction", category:"41 — Account Status",
    recipient_hint:"Furnisher / Creditor", subject:"Request to Correct Balance or Status After Payment",
    include_id_copy:1, include_address_proof:0, include_ssn_copy:0,
    body:`{{fecha}}

{{cliente_nombre}}
{{cliente_direccion}}
{{cliente_ciudad_estado_zip}}

{{destinatario_nombre}}
{{destinatario_direccion}}

Re: Reporting correction — {{acreedor_nombre}} / {{numero_cuenta}}

To Whom It May Concern:

I request an investigation and correction of the balance and/or status being furnished for the account above.

Specific discrepancy:
{{motivo_disputa}}

My supporting records reflect the payment, settlement, or account status described above. Please review the records and correct inaccurate balance, status, or payment information.

Sincerely,

{{cliente_nombre}}`
  },
  {
    code:"50", name:"[PRO 50] CFPB Complaint Evidence Narrative", category:"50 — Escalation",
    recipient_hint:"CFPB Complaint", subject:"Documented Credit Reporting Inaccuracy Not Resolved",
    include_id_copy:0, include_address_proof:0, include_ssn_copy:0,
    body:`Consumer: {{cliente_nombre}}
Company involved: {{acreedor_nombre}}
Account/reference: {{numero_cuenta}}

What happened:
{{motivo_disputa}}

Prior steps:
- Specific dispute submitted.
- Supporting evidence retained.
- Delivery/tracking and investigation results retained.
- The documented issue remains unresolved.

Resolution requested:
Review the documented issue and correct or delete information that is inaccurate or incomplete.

Recommended attachments:
Relevant report pages, prior correspondence, supporting evidence, delivery confirmation, investigation results, and updated report.`
  },
];

function json(data, status=200){
  return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8"}});
}

async function authOk(request, env, ctx){
  const u=new URL(request.url);u.pathname="/api/auth/status";u.search="";
  const probe=new Request(u.toString(),{method:"GET",headers:request.headers});
  const resp=await v8Worker.fetch(probe,env,ctx);
  if(!resp.ok)return false;
  try{return !!(await resp.json()).authenticated}catch{return false}
}

function bureaus(raw){
  const s=String(raw||"").toLowerCase();
  return ["Equifax","Experian","TransUnion"].filter(b=>s.includes(b.toLowerCase()));
}

function today(){
  return new Intl.DateTimeFormat("en-US",{month:"long",day:"numeric",year:"numeric",timeZone:"UTC"}).format(new Date());
}

function fmtDob(v){
  const m=String(v||"").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m?`${m[2]}/${m[3]}/${m[1]}`:String(v||"");
}

function renderTemplate(body,map){
  return String(body||"").replace(/\{\{([a-zA-Z0-9_]+)\}\}/g,(_,k)=>map[k]??"");
}

async function installTemplates(db){
  let inserted=0;
  for(const t of PROFESSIONAL_TEMPLATES){
    const found=await db.prepare(`SELECT id FROM letter_templates WHERE name=? LIMIT 1`).bind(t.name).first();
    if(found)continue;
    await db.prepare(`
      INSERT INTO letter_templates
      (name,category,recipient_hint,subject,body,is_active,include_id_copy,include_address_proof,include_ssn_copy)
      VALUES (?,?,?,?,?,1,?,?,?)
    `).bind(t.name,t.category,t.recipient_hint,t.subject,t.body,t.include_id_copy,t.include_address_proof,t.include_ssn_copy).run();
    inserted++;
  }
  return inserted;
}

async function getAssessment(db,clientId,itemId){
  return db.prepare(`SELECT * FROM dispute_assessments WHERE client_id=? AND credit_item_id=? LIMIT 1`)
    .bind(clientId,itemId).first();
}

async function saveAssessment(request,db,clientId,itemId){
  const item=await db.prepare(`SELECT id FROM credit_items WHERE id=? AND client_id=?`).bind(itemId,clientId).first();
  if(!item)return json({error:"Ítem no encontrado."},404);
  let b={};try{b=await request.json()}catch{}
  const allowedAccuracy=["unknown","inaccurate","incomplete","not_mine","accurate_negative","identity_theft","duplicate","obsolete","unauthorized_inquiry","post_payment_mismatch"];
  const accuracy=allowedAccuracy.includes(b.accuracy_status)?b.accuracy_status:"unknown";
  const confidence=Math.max(0,Math.min(100,Number(b.confidence||0)));
  const existing=await getAssessment(db,clientId,itemId);
  if(existing){
    await db.prepare(`
      UPDATE dispute_assessments SET
        issue_type=?,accuracy_status=?,evidence_status=?,consumer_confirmed=?,
        identity_theft_confirmed=?,confidence=?,dispute_basis=?,evidence_notes=?,
        desired_resolution=?,recommended_route=?,human_verified=?,updated_at=NOW()
      WHERE id=?
    `).bind(
      String(b.issue_type||"unknown"),accuracy,String(b.evidence_status||"none"),
      !!b.consumer_confirmed,!!b.identity_theft_confirmed,confidence,
      String(b.dispute_basis||"").slice(0,3000),String(b.evidence_notes||"").slice(0,3000),
      String(b.desired_resolution||"").slice(0,1000),String(b.recommended_route||"").slice(0,120),
      !!b.human_verified,existing.id
    ).run();
  }else{
    await db.prepare(`
      INSERT INTO dispute_assessments
      (client_id,credit_item_id,issue_type,accuracy_status,evidence_status,consumer_confirmed,
       identity_theft_confirmed,confidence,dispute_basis,evidence_notes,desired_resolution,
       recommended_route,human_verified)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).bind(
      clientId,itemId,String(b.issue_type||"unknown"),accuracy,String(b.evidence_status||"none"),
      !!b.consumer_confirmed,!!b.identity_theft_confirmed,confidence,
      String(b.dispute_basis||"").slice(0,3000),String(b.evidence_notes||"").slice(0,3000),
      String(b.desired_resolution||"").slice(0,1000),String(b.recommended_route||"").slice(0,120),
      !!b.human_verified
    ).run();
  }
  return json({assessment:await getAssessment(db,clientId,itemId)});
}

function decide(item,a,reappeared){
  if(item.removed_status==="eliminado" && !reappeared)return [];
  if(reappeared)return [{type:"reinsertion",target:"cra",code:"32",reason:"El ítem fue removido y reapareció en un reporte posterior."}];
  if(!a || !a.human_verified)return [{type:"assessment_required",target:"internal",code:null,blocked:true,reason:"Falta diagnóstico humano confirmado."}];

  if(a.accuracy_status==="identity_theft" || a.identity_theft_confirmed){
    if(!a.identity_theft_confirmed)return [{type:"identity_theft_review",target:"internal",code:null,blocked:true,reason:"Identity theft requiere confirmación real y documentación correspondiente."}];
    return [{type:"identity_theft_block",target:"cra",code:"12",reason:"Identity theft confirmado."}];
  }

  if(a.accuracy_status==="unauthorized_inquiry"){
    if(!a.consumer_confirmed)return [{type:"consumer_confirmation",target:"internal",code:null,blocked:true,reason:"Confirma que el consumidor no reconoce/autorizó la inquiry."}];
    return [{type:"unauthorized_inquiry",target:"cra",code:"11",reason:"Inquiry confirmada como no reconocida/no autorizada."}];
  }

  if(a.accuracy_status==="accurate_negative"){
    if(item.category==="pago_tardio")return [{type:"goodwill",target:"furnisher",code:"40",reason:"La información parece correcta; goodwill es una solicitud discrecional, no una disputa."}];
    return [{type:"no_dispute",target:"internal",code:null,blocked:true,reason:"No hay base para disputar información negativa confirmada como correcta."}];
  }

  if(a.accuracy_status==="post_payment_mismatch"){
    return [{type:"post_payment_correction",target:"furnisher",code:"41",reason:"El balance/estatus posterior al pago o settlement no coincide con la evidencia."}];
  }

  if(a.issue_type==="prior_verified"){
    return [{type:"procedure_request",target:"cra",code:"31",reason:"El ítem fue reportado como verificado; revisar procedimiento usado."}];
  }

  if(a.issue_type==="new_evidence"){
    return [{type:"reinvestigation_new_evidence",target:"cra",code:"30",reason:"Existe nueva evidencia relevante."}];
  }

  if(a.issue_type==="furnisher_data_mismatch"){
    return [{type:"direct_furnisher",target:"furnisher",code:"21",reason:"La discrepancia se relaciona directamente con datos del furnisher."}];
  }

  const actions=[{type:"cra_factual_dispute",target:"cra",code:"10",reason:"Existe una inexactitud/incompletitud específica documentada."}];
  if(item.category==="coleccion" && ["not_mine","inaccurate","incomplete"].includes(a.accuracy_status)){
    actions.push({type:"collector_validation_review",target:"collector",code:"20",reason:"Collection: revisar también información/validación del collector cuando corresponda."});
  }
  return actions;
}

async function buildStrategy(db,clientId){
  const repairCase=await db.prepare(`SELECT * FROM repair_cases WHERE client_id=? LIMIT 1`).bind(clientId).first();
  if(!repairCase)return {error:"Primero inicia la reparación del cliente.",status:409};

  const {results:items}=await db.prepare(`SELECT * FROM credit_items WHERE client_id=? ORDER BY id`).bind(clientId).all();
  const {results:assessments}=await db.prepare(`SELECT * FROM dispute_assessments WHERE client_id=?`).bind(clientId).all();
  const {results:removals}=await db.prepare(`SELECT * FROM removal_events WHERE client_id=?`).bind(clientId).all();

  // Rebuild only unexecuted planning rows. Generated/sent history is preserved.
  await db.prepare(`
    DELETE FROM strategy_actions
    WHERE client_id=? AND status IN ('planned','blocked')
  `).bind(clientId).run();

  let planned=0,blocked=0;
  for(const item of items||[]){
    const a=(assessments||[]).find(x=>String(x.credit_item_id)===String(item.id));
    const reappeared=(removals||[]).find(x=>String(x.credit_item_id)===String(item.id)&&x.status==="reappeared");
    const decisions=decide(item,a,reappeared);
    for(const d of decisions){
      if(d.target==="cra" && d.code){
        const bs=bureaus(item.bureaus);
        if(!bs.length){
          await db.prepare(`
            INSERT INTO strategy_actions
            (repair_case_id,client_id,credit_item_id,action_type,target_type,template_code,status,priority,reason)
            VALUES (?,?,?,?,?,?, 'blocked',50,?)
          `).bind(repairCase.id,clientId,item.id,d.type,"cra",d.code,"No se detectó buró para este ítem.").run();
          blocked++;continue;
        }
        for(const bureau of bs){
          await db.prepare(`
            INSERT INTO strategy_actions
            (repair_case_id,client_id,credit_item_id,action_type,target_type,target_name,bureau,template_code,status,priority,reason)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)
          `).bind(repairCase.id,clientId,item.id,d.type,"cra",bureau,bureau,d.code,d.blocked?"blocked":"planned",d.blocked?80:20,d.reason).run();
          d.blocked?blocked++:planned++;
        }
      }else{
        let status=d.blocked?"blocked":"planned";
        let targetName=null;
        if(["furnisher","collector"].includes(d.target)){
          targetName=item.creditor_name||null;
          if(!item.creditor_address){
            status="blocked";
            d.reason=`${d.reason} Falta dirección postal del destinatario.`;
          }
        }
        await db.prepare(`
          INSERT INTO strategy_actions
          (repair_case_id,client_id,credit_item_id,action_type,target_type,target_name,template_code,status,priority,reason)
          VALUES (?,?,?,?,?,?,?,?,?,?)
        `).bind(repairCase.id,clientId,item.id,d.type,d.target,targetName,d.code,status,status==="blocked"?80:30,d.reason).run();
        status==="blocked"?blocked++:planned++;
      }
    }
  }

  const run=await db.prepare(`
    INSERT INTO strategy_runs (repair_case_id,client_id,status,summary_json)
    VALUES (?,?,'completed',?) RETURNING *
  `).bind(repairCase.id,clientId,JSON.stringify({planned,blocked,total_items:(items||[]).length})).first();

  await db.prepare(`
    UPDATE repair_cases SET current_stage='strategy_ready',
      next_action=?, last_strategy_at=NOW(), updated_at=NOW()
    WHERE id=?
  `).bind(planned?`Revisar ${planned} acción(es) planificada(s)`:"Completar diagnósticos pendientes",repairCase.id).run();

  return {run,planned,blocked};
}

async function strategyState(db,clientId){
  const [{results:items},{results:assessments},{results:actions}] = await Promise.all([
    db.prepare(`SELECT * FROM credit_items WHERE client_id=? ORDER BY category,creditor_name,id`).bind(clientId).all(),
    db.prepare(`SELECT * FROM dispute_assessments WHERE client_id=?`).bind(clientId).all(),
    db.prepare(`SELECT sa.*,l.title AS letter_title,l.status AS letter_status
                FROM strategy_actions sa LEFT JOIN letters l ON l.id=sa.letter_id
                WHERE sa.client_id=? ORDER BY sa.priority,sa.created_at,sa.id`).bind(clientId).all()
  ]);
  return {
    items:(items||[]).map(item=>({
      ...item,
      assessment:(assessments||[]).find(a=>String(a.credit_item_id)===String(item.id))||null,
      actions:(actions||[]).filter(a=>String(a.credit_item_id)===String(item.id))
    })),
    actions:actions||[],
    summary:{
      items:(items||[]).length,
      assessed:(assessments||[]).filter(a=>a.human_verified).length,
      planned:(actions||[]).filter(a=>a.status==="planned").length,
      blocked:(actions||[]).filter(a=>a.status==="blocked").length,
      generated:(actions||[]).filter(a=>a.status==="draft_created").length,
    }
  };
}

function mapFor(client,item,targetName,targetAddress,a){
  const basis=[a?.dispute_basis,a?.evidence_notes,a?.desired_resolution].filter(Boolean).join("\n\n");
  return {
    cliente_nombre:client.full_name||"",
    cliente_direccion:client.address||"",
    cliente_ciudad_estado_zip:[client.city,client.state,client.zip].filter(Boolean).join(", "),
    cliente_id_last4:client.id_last4||"",
    cliente_fecha_nacimiento:fmtDob(client.date_of_birth),
    fecha:today(),
    destinatario_nombre:targetName||"",
    destinatario_direccion:targetAddress||"",
    numero_cuenta:item?.account_number||"",
    acreedor_nombre:item?.creditor_name||"",
    motivo_disputa:basis||item?.notes||"",
    ronda:"1",
  };
}

async function generateDrafts(db,clientId){
  await installTemplates(db);
  const client=await db.prepare(`SELECT * FROM clients WHERE id=?`).bind(clientId).first();
  if(!client)return {error:"Cliente no encontrado.",status:404};
  const {results:actions}=await db.prepare(`
    SELECT * FROM strategy_actions WHERE client_id=? AND status='planned' ORDER BY priority,id
  `).bind(clientId).all();

  let created=0,blocked=0;
  for(const action of actions||[]){
    if(!action.template_code){continue}
    const item=await db.prepare(`SELECT * FROM credit_items WHERE id=?`).bind(action.credit_item_id).first();
    const assessment=await getAssessment(db,clientId,action.credit_item_id);
    const template=await db.prepare(`SELECT * FROM letter_templates WHERE name LIKE ? ORDER BY id DESC LIMIT 1`)
      .bind(`[PRO ${action.template_code}]%`).first();
    if(!template){
      await db.prepare(`UPDATE strategy_actions SET status='blocked',reason=reason || ' Falta plantilla profesional.',updated_at=NOW() WHERE id=?`).bind(action.id).run();
      blocked++;continue;
    }

    let recipientName=action.target_name||"";
    let recipientAddress="";
    if(action.target_type==="cra"){
      recipientName=action.bureau;
      recipientAddress=BUREAU_ADDRESS[action.bureau]||"";
    }else{
      recipientName=item?.creditor_name||action.target_name||"";
      recipientAddress=item?.creditor_address||"";
    }
    if(!recipientAddress){
      await db.prepare(`UPDATE strategy_actions SET status='blocked',reason=reason || ' Falta dirección postal.',updated_at=NOW() WHERE id=?`).bind(action.id).run();
      blocked++;continue;
    }

    const body=renderTemplate(template.body,mapFor(client,item,recipientName,recipientAddress,assessment));
    const title=`${template.name} — ${item?.creditor_name||recipientName}`.trim();
    const letter=await db.prepare(`
      INSERT INTO letters
      (client_id,template_id,credit_item_id,title,recipient_name,recipient_address,round_number,body,status,
       include_id_copy,include_address_proof,include_ssn_copy)
      VALUES (?,?,?,?,?,?,1,?,'borrador',?,?,?)
      RETURNING *
    `).bind(
      clientId,template.id,item?.id||null,title,recipientName,recipientAddress,body,
      template.include_id_copy?1:0,template.include_address_proof?1:0,template.include_ssn_copy?1:0
    ).first();

    await db.prepare(`
      UPDATE strategy_actions SET status='draft_created',letter_id=?,updated_at=NOW() WHERE id=?
    `).bind(letter.id,action.id).run();
    created++;
  }

  const repairCase=await db.prepare(`SELECT * FROM repair_cases WHERE client_id=? LIMIT 1`).bind(clientId).first();
  if(repairCase && created){
    await db.prepare(`
      UPDATE repair_cases SET current_stage='approval_required',
        next_action='Revisar y aprobar borradores',updated_at=NOW()
      WHERE id=?
    `).bind(repairCase.id).run();
  }
  return {created,blocked};
}

export default {
  async fetch(request,env,ctx){
    const runtimeEnv={...env,DB:createD1Shim(env)};
    const db=runtimeEnv.DB;
    const url=new URL(request.url),path=url.pathname,method=request.method.toUpperCase();

    if(!path.startsWith("/api/"))return v8Worker.fetch(request,runtimeEnv,ctx);
    const authenticated=await authOk(request,runtimeEnv,ctx);
    if(!authenticated && !path.startsWith("/api/auth/") && !path.startsWith("/api/portal/"))
      return v8Worker.fetch(request,runtimeEnv,ctx);

    if(path==="/api/pro-templates/install" && method==="POST"){
      return json({inserted:await installTemplates(db),total:PROFESSIONAL_TEMPLATES.length});
    }

    const state=path.match(/^\/api\/strategy\/client\/(\d+)$/);
    if(state && method==="GET")return json(await strategyState(db,state[1]));

    const assess=path.match(/^\/api\/strategy\/client\/(\d+)\/items\/(\d+)\/assessment$/);
    if(assess && method==="PUT")return saveAssessment(request,db,assess[1],assess[2]);

    const build=path.match(/^\/api\/strategy\/client\/(\d+)\/build$/);
    if(build && method==="POST"){
      const r=await buildStrategy(db,build[1]);
      if(r.error)return json({error:r.error},r.status||400);
      return json(r);
    }

    const gen=path.match(/^\/api\/strategy\/client\/(\d+)\/generate-drafts$/);
    if(gen && method==="POST"){
      const r=await generateDrafts(db,gen[1]);
      if(r.error)return json({error:r.error},r.status||400);
      return json(r);
    }

    return v8Worker.fetch(request,runtimeEnv,ctx);
  }
};
