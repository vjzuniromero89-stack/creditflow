// CreditFlow v13.1 — Automated Investigation
// Keeps Aggressive Compliance isolated from the normal strategy workflow.
import v13 from "./index-v13.js";
import baseWorker from "./index.js";
import { createD1Shim } from "./db-shim.js";

const json=(x,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{
  "content-type":"application/json; charset=utf-8","cache-control":"no-store"
}});

async function auth(req,env,ctx){
  const u=new URL(req.url);u.pathname="/api/auth/status";u.search="";
  const r=await baseWorker.fetch(new Request(u,{method:"GET",headers:req.headers}),env,ctx);
  if(!r.ok)return false;
  try{return !!(await r.json()).authenticated}catch{return false}
}

function norm(v){return String(v??"").trim().toLowerCase().replace(/\s+/g," ")}
function classify(f,item,compliance,responseCount,removalCount){
  const code=f.finding_code;
  let actionability="review",status="completed",result="",checks=[];

  if(code==="CROSS_BUREAU_MISMATCH"){
    actionability="actionable";
    result="Existe una diferencia concreta entre burós. El hallazgo puede convertirse en estrategia si la diferencia es material y el expediente conserva el reporte que la muestra.";
    checks=["cross_bureau_difference_present"];
  }else if(code==="POSSIBLE_DUPLICATE"){
    actionability="actionable";
    result="El motor detectó posible duplicación del mismo tradeline dentro de un buró. Debe confirmarse que no sean obligaciones distintas antes de usar la estrategia.";
    checks=["possible_same_bureau_duplicate"];
  }else if(code==="AGING_REVIEW"){
    const dofd=item?.date_of_first_delinquency||item?.first_delinquency_date||null;
    actionability=dofd?"actionable":"evidence_required";
    result=dofd
      ? `Existe una fecha de primera morosidad disponible (${dofd}). El motor puede comparar antigüedad y exclusión; revisar antes de adoptar.`
      : "No existe DOFD suficiente en los datos importados. Se requiere reporte/documentación adicional.";
    checks=["aging_review",dofd?"dofd_present":"dofd_missing"];
  }else if(code==="COLLECTOR_LICENSE_SIGNAL"){
    actionability="actionable";
    result=`Ya existe un hallazgo regulatorio confirmado en Collector Compliance: ${compliance?.license_status||"estado registrado"}. Debe reconfirmarse la fuente oficial antes de usarlo.`;
    checks=["collector_compliance_record_present"];
  }else if(code==="COLLECTOR_COMPLIANCE_UNVERIFIED"){
    actionability="evidence_required";
    result="No existe una verificación oficial guardada. CreditFlow no puede convertir esto en una estrategia hasta contar con fuente oficial, nombre legal y estado de licencia.";
    checks=["official_license_source_missing"];
  }else if(code==="OWNERSHIP_DOCUMENTATION_REVIEW"){
    actionability=responseCount>0?"review":"evidence_required";
    result=responseCount>0
      ? `Hay ${responseCount} respuesta(s) registrada(s) relacionadas con el expediente. Deben revisarse para ownership, acreedor actual y balance.`
      : "No hay respuesta/documentación del collector registrada para verificar ownership o cadena de titularidad.";
    checks=["ownership_review",responseCount>0?"response_available":"collector_response_missing"];
  }else if(code==="CHARGEOFF_FIELD_REVIEW"){
    const hasDates=Boolean(item?.date_of_first_delinquency||item?.first_delinquency_date||item?.date_opened||item?.opened_date);
    actionability=hasDates?"review":"evidence_required";
    result=hasDates
      ? "Hay fechas/campos suficientes para una revisión profunda del charge-off, pero no se detectó todavía una inexactitud concreta."
      : "Los datos importados no contienen suficientes fechas/campos para convertir este hallazgo en una disputa específica.";
    checks=["chargeoff_deep_review",hasDates?"report_fields_present":"report_fields_missing"];
  }else if(code==="LATE_PAYMENT_DEEP_REVIEW"){
    actionability="evidence_required";
    result="El reporte identifica el late payment, pero para convertirlo en disputa factual se necesitan documentos de pago, deferment, forbearance u otra evidencia que contradiga el reporting.";
    checks=["late_payment_review","external_payment_evidence_needed"];
  }else if(code==="REINSERTION"){
    actionability=removalCount>0?"actionable":"review";
    result=removalCount>0
      ? "Existe historial interno de remoción/reaparición. Es una oportunidad accionable para revisión de reinserción."
      : "La señal de reinserción requiere confirmar el historial anterior.";
    checks=["reinsertion_history"];
  }else if(code==="RESPONSE_DEADLINE_REVIEW"){
    actionability="actionable";
    result="El expediente tiene una señal de plazo de respuesta. Debe confirmarse la fecha real de recepción y cualquier extensión aplicable antes de usar la estrategia.";
    checks=["deadline_signal"];
  }else{
    actionability="review";
    result="Hallazgo analizado. No existe todavía base suficiente para convertirlo automáticamente en estrategia.";
    checks=["manual_review"];
  }

  return {status,actionability,result,checks};
}

async function investigate(db,clientId){
  const run=await db.prepare(`SELECT * FROM aggressive_compliance_runs WHERE client_id=? ORDER BY id DESC LIMIT 1`).bind(clientId).first();
  if(!run)return {error:"Primero ejecuta Analizar expediente.",status:409};

  const [{results:findings},{results:items},responseRes,removalRes,complianceRes]=await Promise.all([
    db.prepare(`SELECT * FROM aggressive_compliance_findings WHERE run_id=? ORDER BY id`).bind(run.id).all(),
    db.prepare(`SELECT * FROM credit_items WHERE client_id=? ORDER BY id`).bind(clientId).all(),
    db.prepare(`SELECT * FROM dispute_responses WHERE client_id=?`).bind(clientId).all().catch(()=>({results:[]})),
    db.prepare(`SELECT * FROM removal_events WHERE client_id=?`).bind(clientId).all().catch(()=>({results:[]})),
    db.prepare(`SELECT * FROM collector_compliance_checks WHERE client_id=? ORDER BY updated_at DESC,id DESC`).bind(clientId).all().catch(()=>({results:[]}))
  ]);
  const responses=responseRes.results||[],removals=removalRes.results||[],checks=complianceRes.results||[];
  let actionable=0,evidence=0,review=0;

  for(const f of findings||[]){
    const item=(items||[]).find(i=>String(i.id)===String(f.credit_item_id));
    const compliance=checks.find(c=>String(c.credit_item_id||"")===String(f.credit_item_id))||
      checks.find(c=>norm(c.collector_name)===norm(f.creditor_name));
    const responseCount=responses.filter(r=>String(r.credit_item_id||"")===String(f.credit_item_id)).length;
    const removalCount=removals.filter(r=>String(r.credit_item_id||"")===String(f.credit_item_id)).length;
    const x=classify(f,item,compliance,responseCount,removalCount);
    if(x.actionability==="actionable")actionable++;
    else if(x.actionability==="evidence_required")evidence++;
    else review++;
    await db.prepare(`
      UPDATE aggressive_compliance_findings
      SET investigation_status=?,investigation_result=?,actionability=?,
          investigation_json=?,investigated_at=NOW()
      WHERE id=?
    `).bind(x.status,x.result,x.actionability,JSON.stringify({
      checks:x.checks,responseCount,removalCount,
      compliance_status:compliance?.license_status||null
    }),f.id).run();
  }

  await db.prepare(`
    UPDATE aggressive_compliance_runs
    SET status='investigated',actionable_count=?,
        summary_json=?
    WHERE id=?
  `).bind(actionable,JSON.stringify({
    engine:"v13.1",findings:(findings||[]).length,actionable,
    evidence_required:evidence,review
  }),run.id).run();

  return {ok:true,run_id:run.id,total:(findings||[]).length,actionable,evidence_required:evidence,review};
}

export default{async fetch(request,env,ctx){
  const u=new URL(request.url),m=request.method.toUpperCase();
  const hit=u.pathname.match(/^\/api\/aggressive-compliance\/client\/(\d+)\/investigate$/);
  if(m==="POST"&&hit){
    if(!(await auth(request,env,ctx)))return json({error:"No autorizado"},401);
    try{
      const r=await investigate(createD1Shim(env),Number(hit[1]));
      if(r.error)return json({error:r.error},r.status||400);
      return json(r);
    }catch(e){return json({error:"Automated Investigation v13.1 falló",detail:String(e?.message||e)},500)}
  }
  return v13.fetch(request,env,ctx);
}};
