// CreditFlow v12.5.2 — Strategy Engine batched writes
import v12 from "./index-v12.js";
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
function norm(v){return String(v??"").trim().toLowerCase().replace(/\s+/g," ")}
function itemKey(item){
  const digits=String(item.account_number||"").replace(/\D/g,"");
  return `${norm(item.creditor_name)}|${digits.slice(-4)||norm(item.account_number)}`;
}
function bureauList(raw){
  const s=norm(raw),out=[];
  if(s.includes("experian"))out.push("Experian");
  if(s.includes("equifax"))out.push("Equifax");
  if(s.includes("transunion")||s.includes("trans union"))out.push("TransUnion");
  return out;
}
function compareGroup(group){
  const defs=[
    ["balance","Balance"],["status_raw","Estado"],["category","Categoría"],
    ["date_opened","Fecha de apertura"],["opened_date","Fecha de apertura"],
    ["date_of_first_delinquency","Primera morosidad"],["first_delinquency_date","Primera morosidad"],
    ["last_payment_date","Último pago"],["original_creditor","Acreedor original"],
    ["account_type","Tipo de cuenta"],["payment_status","Payment status"]
  ];
  const findings=[],seen=new Set();
  for(const [k,label] of defs){
    if(seen.has(label))continue;
    const vals=group.map(x=>({value:x[k]}))
      .filter(x=>x.value!==null&&x.value!==undefined&&String(x.value).trim()!=="");
    if(vals.length<2)continue;
    if(new Set(vals.map(x=>norm(x.value))).size>1){
      findings.push({field:k,label});
      seen.add(label);
    }
  }
  return findings;
}
function isCollectorItem(item){
  const c=norm(item.category),s=norm(item.status_raw||item.status),n=norm(item.creditor_name);
  return c.includes("collection")||c.includes("coleccion")||c.includes("charge")||
         s.includes("collection")||s.includes("charge off")||s.includes("charge-off")||
         n.includes("collection")||n.includes("recovery")||n.includes("receivable");
}
function complianceFor(item,checks){
  return (checks||[]).find(c=>String(c.credit_item_id||"")===String(item.id))||
         (checks||[]).find(c=>norm(c.collector_name)===norm(item.creditor_name))||null;
}

async function enhancedBuild(db,clientId){
  const repairCase=await db.prepare(`SELECT * FROM repair_cases WHERE client_id=? LIMIT 1`).bind(clientId).first();
  if(!repairCase)return {error:"Primero inicia la reparación del cliente.",status:409};

  const [{results:items},{results:assessments}] = await Promise.all([
    db.prepare(`SELECT * FROM credit_items WHERE client_id=? ORDER BY id`).bind(clientId).all(),
    db.prepare(`SELECT * FROM dispute_assessments WHERE client_id=?`).bind(clientId).all()
  ]);

  const activeItems=(items||[]).filter(x=>x.removed_status!=="eliminado");
  const verifiedIds=new Set((assessments||[])
    .filter(a=>a.human_verified||a.auto_ready)
    .map(a=>String(a.credit_item_id)));
  const audited=activeItems.filter(i=>verifiedIds.has(String(i.id))).length;

  if(activeItems.length>0 && audited<activeItems.length){
    return {
      error:`Auditoría incompleta: ${audited} de ${activeItems.length} ítems revisados por humano o sistema.`,
      status:409,audit_required:true,audited,total:activeItems.length
    };
  }

  let removals=[],checks=[];
  try{removals=(await db.prepare(`SELECT * FROM removal_events WHERE client_id=?`).bind(clientId).all()).results||[]}catch{}
  try{checks=(await db.prepare(`SELECT * FROM collector_compliance_checks WHERE client_id=? ORDER BY updated_at DESC,id DESC`).bind(clientId).all()).results||[]}catch{}

  await db.prepare(`DELETE FROM strategy_actions WHERE client_id=? AND status IN ('planned','blocked')`).bind(clientId).run();

  const groups=new Map();
  for(const item of items||[]){
    const k=itemKey(item);
    if(!groups.has(k))groups.set(k,[]);
    groups.get(k).push(item);
  }

  const actions=[];
  let planned=0,blocked=0;

  function pushAction(item,{type,target,code,status="planned",priority=30,reason,bureau=null,targetName=null}){
    actions.push([
      repairCase.id,clientId,item.id,type,target,targetName,bureau,code,status,priority,reason
    ]);
    status==="blocked"?blocked++:planned++;
  }

  for(const group of groups.values()){
    const findings=compareGroup(group);

    for(const item of group){
      const a=(assessments||[]).find(x=>String(x.credit_item_id)===String(item.id));
      const reappeared=(removals||[]).find(x=>String(x.credit_item_id)===String(item.id)&&x.status==="reappeared");
      const check=complianceFor(item,checks);

      if(item.removed_status==="eliminado"&&!reappeared)continue;

      if(reappeared){
        const bs=bureauList(item.bureaus);
        if(!bs.length){
          pushAction(item,{type:"reinsertion",target:"cra",code:"32",status:"blocked",priority:80,
            reason:"El ítem reapareció, pero no se detectó el buró para preparar la carta."});
        }else{
          for(const b of bs)pushAction(item,{type:"reinsertion",target:"cra",code:"32",bureau:b,targetName:b,priority:10,
            reason:"El ítem fue removido y reapareció en un reporte posterior."});
        }
        continue;
      }

      if(!a||!(a.human_verified||a.auto_ready)){
        pushAction(item,{type:"assessment_required",target:"internal",code:null,status:"blocked",priority:90,
          reason:"Falta diagnóstico confirmado por humano o Auto Audit."});
        continue;
      }

      if(a.accuracy_status==="identity_theft"||a.identity_theft_confirmed){
        if(!a.identity_theft_confirmed){
          pushAction(item,{type:"identity_theft_review",target:"internal",code:null,status:"blocked",priority:90,
            reason:"Identity theft requiere confirmación real y documentación correspondiente."});
        }else{
          const bs=bureauList(item.bureaus);
          if(!bs.length)pushAction(item,{type:"identity_theft_block",target:"cra",code:"12",status:"blocked",priority:80,
            reason:"Identity theft confirmado, pero no se detectó buró para el ítem."});
          else for(const b of bs)pushAction(item,{type:"identity_theft_block",target:"cra",code:"12",bureau:b,targetName:b,priority:10,
            reason:"Identity theft confirmado y documentado."});
        }
        continue;
      }

      if(a.accuracy_status==="unauthorized_inquiry"){
        if(!a.consumer_confirmed){
          pushAction(item,{type:"consumer_confirmation",target:"internal",code:null,status:"blocked",priority:90,
            reason:"Confirma que el consumidor no reconoce/autorizó la inquiry."});
        }else{
          const bs=bureauList(item.bureaus);
          if(!bs.length)pushAction(item,{type:"unauthorized_inquiry",target:"cra",code:"11",status:"blocked",priority:80,
            reason:"Inquiry confirmada, pero falta identificar el buró."});
          else for(const b of bs)pushAction(item,{type:"unauthorized_inquiry",target:"cra",code:"11",bureau:b,targetName:b,priority:20,
            reason:"Inquiry confirmada como no reconocida/no autorizada."});
        }
        continue;
      }

      if(a.accuracy_status==="accurate_negative"){
        if(item.category==="pago_tardio"){
          pushAction(item,{type:"goodwill",target:"furnisher",code:"40",targetName:item.creditor_name||null,
            status:item.creditor_address?"planned":"blocked",priority:item.creditor_address?30:80,
            reason:item.creditor_address?"Información correcta; goodwill discrecional, no disputa.":"Goodwill posible, pero falta dirección postal."});
        }else if(isCollectorItem(item)&&check?.human_verified&&
                 check.license_required_status==="required"&&["inactive","not_found"].includes(check.license_status)){
          pushAction(item,{type:"collector_compliance_review",target:"internal",code:null,status:"blocked",priority:15,
            reason:`La deuda fue reconocida como correcta, pero existe un hallazgo regulatorio confirmado (${check.license_status}). Revisar compliance por separado.`});
        }else{
          pushAction(item,{type:"no_dispute",target:"internal",code:null,status:"blocked",priority:90,
            reason:"No hay base para disputar información negativa confirmada como correcta."});
        }
        continue;
      }

      if(a.accuracy_status==="post_payment_mismatch"){
        pushAction(item,{type:"post_payment_correction",target:"furnisher",code:"41",targetName:item.creditor_name||null,
          status:item.creditor_address?"planned":"blocked",priority:item.creditor_address?20:80,
          reason:item.creditor_address?"El balance/estatus posterior al pago no coincide con la evidencia.":"Discrepancia post-pago; falta dirección postal del furnisher."});
        continue;
      }

      if(a.issue_type==="prior_verified"){
        const bs=bureauList(item.bureaus);
        if(!bs.length)pushAction(item,{type:"procedure_request",target:"cra",code:"31",status:"blocked",priority:80,
          reason:"Previamente verificado, pero falta identificar el buró."});
        else for(const b of bs)pushAction(item,{type:"procedure_request",target:"cra",code:"31",bureau:b,targetName:b,priority:25,
          reason:"El ítem fue reportado como verificado; revisar el procedimiento usado."});
        continue;
      }

      if(a.issue_type==="new_evidence"){
        const bs=bureauList(item.bureaus);
        if(!bs.length)pushAction(item,{type:"reinvestigation_new_evidence",target:"cra",code:"30",status:"blocked",priority:80,
          reason:"Existe nueva evidencia, pero falta identificar el buró."});
        else for(const b of bs)pushAction(item,{type:"reinvestigation_new_evidence",target:"cra",code:"30",bureau:b,targetName:b,priority:20,
          reason:"Existe nueva evidencia relevante."});
        continue;
      }

      if(a.issue_type==="furnisher_data_mismatch"){
        pushAction(item,{type:"direct_furnisher",target:"furnisher",code:"21",targetName:item.creditor_name||null,
          status:item.creditor_address?"planned":"blocked",priority:item.creditor_address?20:80,
          reason:item.creditor_address?"La discrepancia se relaciona directamente con datos del furnisher.":"Discrepancia con furnisher; falta dirección postal."});
        continue;
      }

      if(findings.length){
        const described=findings.map(f=>f.label).join(", ");
        const bs=bureauList(item.bureaus);
        if(!bs.length){
          pushAction(item,{type:"cra_factual_dispute",target:"cra",code:"10",status:"blocked",priority:80,
            reason:`Se detectaron diferencias entre burós (${described}), pero no se detectó buró en este registro.`});
        }else{
          for(const b of bs)pushAction(item,{type:"cra_factual_dispute",target:"cra",code:"10",bureau:b,targetName:b,priority:15,
            reason:`Inconsistencia inter-buró detectada. Campos a revisar: ${described}. La carta debe citar únicamente diferencias verificadas.`});
        }
        if(isCollectorItem(item)&&["not_mine","inaccurate","incomplete"].includes(a.accuracy_status)){
          pushAction(item,{type:"collector_validation_review",target:"collector",code:"20",targetName:item.creditor_name||null,
            status:item.creditor_address?"planned":"blocked",priority:item.creditor_address?25:80,
            reason:item.creditor_address?"Collection con inexactitud/incompletitud; revisar también información/validación del collector.":"Collection con inexactitud/incompletitud; falta dirección postal del collector."});
        }
      }else{
        const bs=bureauList(item.bureaus);
        if(["inaccurate","incomplete","not_mine","duplicate","obsolete"].includes(a.accuracy_status)){
          if(!bs.length)pushAction(item,{type:"cra_factual_dispute",target:"cra",code:"10",status:"blocked",priority:80,
            reason:"Existe una inexactitud/incompletitud documentada, pero no se detectó buró."});
          else for(const b of bs)pushAction(item,{type:"cra_factual_dispute",target:"cra",code:"10",bureau:b,targetName:b,priority:20,
            reason:"Existe una inexactitud/incompletitud específica documentada."});
        }else{
          pushAction(item,{type:"strategy_review",target:"internal",code:null,status:"blocked",priority:70,
            reason:"No hay señal suficiente para generar una disputa automática. Revisar diagnóstico y evidencia."});
        }
      }

      if(isCollectorItem(item)&&check?.human_verified&&check.license_required_status==="required"&&
         ["inactive","not_found"].includes(check.license_status)){
        pushAction(item,{type:"collector_compliance_review",target:"internal",code:null,status:"blocked",priority:12,
          reason:`Hallazgo regulatorio confirmado (${check.license_status}) en ${check.jurisdiction||"jurisdicción indicada"}. Mantener separado de la disputa de exactitud.`});
      }
    }
  }

  // v12.5.2: ONE Supabase write for all strategy actions.
  if(actions.length){
    const placeholders=actions.map(()=>"(?,?,?,?,?,?,?,?,?,?,?)").join(",");
    await db.prepare(`
      INSERT INTO strategy_actions
      (repair_case_id,client_id,credit_item_id,action_type,target_type,target_name,bureau,template_code,status,priority,reason)
      VALUES ${placeholders}
    `).bind(actions.flat()).run();
  }

  const run=await db.prepare(`
    INSERT INTO strategy_runs (repair_case_id,client_id,status,summary_json)
    VALUES (?,?,'completed',?) RETURNING *
  `).bind(repairCase.id,clientId,JSON.stringify({
    planned,blocked,total_items:(items||[]).length,actions:actions.length,engine:"v12.5.2"
  })).first();

  await db.prepare(`
    UPDATE repair_cases SET current_stage='strategy_ready',
      next_action=?,last_strategy_at=NOW(),updated_at=NOW()
    WHERE id=?
  `).bind(planned?`Revisar ${planned} acción(es) planificada(s) por Strategy Engine v12.5.2`:"Completar revisiones pendientes",repairCase.id).run();

  return {run,planned,blocked,actions:actions.length,engine:"v12.5.2"};
}

export default{async fetch(request,env,ctx){
  const u=new URL(request.url),m=request.method.toUpperCase();
  const match=u.pathname.match(/^\/api\/strategy\/client\/(\d+)\/build$/);
  if(m==="POST"&&match){
    if(!(await auth(request,env,ctx)))return out({error:"No autorizado"},401);
    try{
      const r=await enhancedBuild(createD1Shim(env),Number(match[1]));
      if(r.error)return out({error:r.error,...r},r.status||400);
      return out(r);
    }catch(e){
      return out({error:"Strategy Engine v12.5.2 falló",detail:String(e?.message||e)},500);
    }
  }
  return v12.fetch(request,env,ctx);
}};
