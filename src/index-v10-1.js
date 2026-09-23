import v91Worker from "./index-v9-1.js";
import baseWorker from "./index.js";
import { createD1Shim } from "./db-shim.js";

function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8"}})}
async function authOk(request,env,ctx){
  const u=new URL(request.url);u.pathname="/api/auth/status";u.search="";
  const r=await v91Worker.fetch(new Request(u.toString(),{method:"GET",headers:request.headers}),env,ctx);
  if(!r.ok)return false;try{return !!(await r.json()).authenticated}catch{return false}
}
function fp(item){
  return [item.creditor_name,item.account_number,item.category].map(x=>String(x||"").toLowerCase().replace(/[^a-z0-9]/g,"")).join("|");
}
async function latestAuthoritative(db,clientId){
  return db.prepare(`SELECT * FROM report_imports WHERE client_id=? AND is_authoritative=TRUE ORDER BY report_date DESC NULLS LAST,created_at DESC,id DESC LIMIT 1`).bind(clientId).first();
}
async function chronologyState(db,clientId){
  const {results:reports}=await db.prepare(`SELECT * FROM report_imports WHERE client_id=? ORDER BY report_date DESC NULLS LAST,created_at DESC,id DESC`).bind(clientId).all();
  return {reports:reports||[],authoritative:(reports||[]).find(r=>r.is_authoritative)||null};
}
async function snapshotCurrent(db,clientId,reportId){
  const exists=await db.prepare(`SELECT id FROM report_item_snapshots WHERE report_import_id=? LIMIT 1`).bind(reportId).first();
  if(exists)return;
  const {results:items}=await db.prepare(`SELECT * FROM credit_items WHERE client_id=?`).bind(clientId).all();
  for(const item of items||[]){
    const bs=String(item.bureaus||"").split(",").map(x=>x.trim()).filter(Boolean);
    const list=bs.length?bs:[""];
    for(const bureau of list){
      await db.prepare(`INSERT INTO report_item_snapshots
        (report_import_id,client_id,credit_item_id,fingerprint,creditor_name,account_number,category,bureau,balance,status_raw,present,snapshot_json)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(reportId,clientId,item.id,fp(item),item.creditor_name||null,item.account_number||null,item.category||null,bureau,item.balance||null,item.status_raw||null,item.removed_status!=="eliminado",JSON.stringify(item)).run();
    }
  }
}
async function recommendations(db,clientId){
  const {results}=await db.prepare(`SELECT cr.*,ci.creditor_name,ci.account_number FROM case_recommendations cr LEFT JOIN credit_items ci ON ci.id=cr.credit_item_id WHERE cr.client_id=? ORDER BY CASE WHEN cr.status='open' THEN 0 ELSE 1 END,cr.priority,cr.created_at DESC`).bind(clientId).all();
  return results||[];
}
async function addRecommendation(db,{clientId,caseId,itemId,sourceType,sourceId,type,title,reason,priority=50}){
  const dup=await db.prepare(`SELECT id FROM case_recommendations WHERE client_id=? AND COALESCE(credit_item_id,0)=COALESCE(?,0) AND source_type=? AND COALESCE(source_id,0)=COALESCE(?,0) AND recommendation_type=? AND status='open' LIMIT 1`)
    .bind(clientId,itemId||null,sourceType,sourceId||null,type).first();
  if(dup)return dup;
  return db.prepare(`INSERT INTO case_recommendations(client_id,repair_case_id,credit_item_id,source_type,source_id,recommendation_type,title,reason,priority) VALUES (?,?,?,?,?,?,?,?,?) RETURNING *`)
    .bind(clientId,caseId||null,itemId||null,sourceType,sourceId||null,type,title,reason||null,priority).first();
}
async function recordResponse(request,db,clientId){
  let b={};try{b=await request.json()}catch{}
  if(!b.response_type)return json({error:"Selecciona el tipo de respuesta."},400);
  const repairCase=await db.prepare(`SELECT * FROM repair_cases WHERE client_id=? LIMIT 1`).bind(clientId).first();
  const itemId=b.credit_item_id?Number(b.credit_item_id):null;
  const letterId=b.letter_id?Number(b.letter_id):null;
  const row=await db.prepare(`INSERT INTO dispute_responses
    (client_id,repair_case_id,credit_item_id,letter_id,responder_type,responder_name,response_type,received_at,summary,new_evidence,evidence_notes,outcome)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?) RETURNING *`)
    .bind(clientId,repairCase?.id||null,itemId,letterId,String(b.responder_type||"cra"),String(b.responder_name||"").slice(0,200),
      String(b.response_type),b.received_at||null,String(b.summary||"").slice(0,4000),!!b.new_evidence,String(b.evidence_notes||"").slice(0,4000),String(b.outcome||"pending_review")).first();

  const type=String(b.response_type);
  if(type==="verified"){
    await addRecommendation(db,{clientId,caseId:repairCase?.id,itemId,sourceType:"response",sourceId:row.id,type:"procedure_review",title:"Revisar resultado “verified”",reason:"No repetir automáticamente la misma disputa. Revisar el resultado, la evidencia y si corresponde solicitar descripción del procedimiento o disputar con nueva información.",priority:20});
  }else if(type==="corrected"){
    await addRecommendation(db,{clientId,caseId:repairCase?.id,itemId,sourceType:"response",sourceId:row.id,type:"confirm_correction",title:"Confirmar corrección en nuevo reporte",reason:"La respuesta indica corrección. Confirmar el cambio en el siguiente reporte antes de cerrar el ítem.",priority:20});
  }else if(type==="deleted"){
    await addRecommendation(db,{clientId,caseId:repairCase?.id,itemId,sourceType:"response",sourceId:row.id,type:"confirm_deletion",title:"Confirmar eliminación en nuevo reporte",reason:"La respuesta indica eliminación. Confirmar que el ítem realmente desaparezca del siguiente reporte.",priority:10});
  }else if(type==="identity_theft_blocked"){
    await addRecommendation(db,{clientId,caseId:repairCase?.id,itemId,sourceType:"response",sourceId:row.id,type:"confirm_identity_block",title:"Confirmar bloqueo por identity theft",reason:"Verificar el siguiente reporte y conservar documentación del bloqueo.",priority:10});
  }else if(type==="needs_more_information"){
    await addRecommendation(db,{clientId,caseId:repairCase?.id,itemId,sourceType:"response",sourceId:row.id,type:"evidence_required",title:"Respuesta solicita más información",reason:"Revisar exactamente qué información falta antes de preparar cualquier follow-up.",priority:15});
  }else if(type==="no_response"){
    await addRecommendation(db,{clientId,caseId:repairCase?.id,itemId,sourceType:"response",sourceId:row.id,type:"delivery_and_timing_review",title:"Revisar entrega y plazo",reason:"Antes de escalar, confirmar entrega, fecha efectiva y plazo aplicable.",priority:25});
  }
  if(b.new_evidence){
    await addRecommendation(db,{clientId,caseId:repairCase?.id,itemId,sourceType:"response",sourceId:row.id,type:"new_evidence_strategy",title:"Nueva evidencia disponible",reason:String(b.evidence_notes||"Revisar la nueva evidencia y construir una estrategia materialmente distinta."),priority:12});
  }
  if(repairCase){
    await db.prepare(`UPDATE repair_cases SET current_stage='results_review',next_action='Revisar respuesta y recomendación',updated_at=NOW() WHERE id=?`).bind(repairCase.id).run();
  }
  return json({response:row});
}
async function intelligenceState(db,clientId){
  const [{results:responses},{results:letters},chrono,recs]=await Promise.all([
    db.prepare(`SELECT dr.*,ci.creditor_name,l.title AS letter_title FROM dispute_responses dr LEFT JOIN credit_items ci ON ci.id=dr.credit_item_id LEFT JOIN letters l ON l.id=dr.letter_id WHERE dr.client_id=? ORDER BY dr.created_at DESC`).bind(clientId).all(),
    db.prepare(`SELECT id,title,credit_item_id,recipient_name,status,created_at FROM letters WHERE client_id=? ORDER BY created_at DESC`).bind(clientId).all(),
    chronologyState(db,clientId),recommendations(db,clientId)
  ]);
  return {responses:responses||[],letters:letters||[],chronology:chrono,recommendations:recs};
}
async function resolveRec(db,clientId,id){
  await db.prepare(`UPDATE case_recommendations SET status='resolved',resolved_at=NOW() WHERE id=? AND client_id=?`).bind(id,clientId).run();
  return json({ok:true});
}

export default{
 async fetch(request,env,ctx){
  const runtimeEnv={...env,DB:createD1Shim(env)},db=runtimeEnv.DB,u=new URL(request.url),p=u.pathname,m=request.method.toUpperCase();
  if(!p.startsWith("/api/"))return v91Worker.fetch(request,runtimeEnv,ctx);

  // v10.1 HOTFIX:
  // Auth routes go straight to the base worker instead of traversing every wrapper.
  // This prevents repeated auth-status probes and dramatically cuts Cloudflare subrequests.
  if(p.startsWith("/api/auth/")){
    return baseWorker.fetch(request,runtimeEnv,ctx);
  }

  // Portal and all non-v10 API routes are delegated immediately.
  // Do NOT perform an extra v10 auth probe for routes handled by lower versions.
  if(p.startsWith("/api/portal/")){
    return v91Worker.fetch(request,runtimeEnv,ctx);
  }

  const isV10Route =
    /^\/api\/case-intelligence\//.test(p) ||
    /^\/api\/clients\/\d+\/credit-report\/import$/.test(p);

  if(!isV10Route){
    return v91Worker.fetch(request,runtimeEnv,ctx);
  }

  // Only v10-owned endpoints pay for the v10 authentication check.
  // Report import is authenticated by the lower worker when delegated below.
  const isImport=/^\/api\/clients\/\d+\/credit-report\/import$/.test(p);
  if(!isImport){
    const ok=await authOk(request,runtimeEnv,ctx);
    if(!ok)return v91Worker.fetch(request,runtimeEnv,ctx);
  }

  const st=p.match(/^\/api\/case-intelligence\/(\d+)$/);
  if(st&&m==="GET")return json(await intelligenceState(db,st[1]));
  const resp=p.match(/^\/api\/case-intelligence\/(\d+)\/responses$/);
  if(resp&&m==="POST")return recordResponse(request,db,resp[1]);
  const rr=p.match(/^\/api\/case-intelligence\/(\d+)\/recommendations\/(\d+)\/resolve$/);
  if(rr&&m==="POST")return resolveRec(db,rr[1],rr[2]);

  // Chronology guard: preflight a report import BEFORE legacy reconciliation mutates current state.
  const imp=p.match(/^\/api\/clients\/(\d+)\/credit-report\/import$/);
  if(imp&&m==="POST"){
    const clientId=imp[1];
    const before=await latestAuthoritative(db,clientId);
    const response=await v91Worker.fetch(request,runtimeEnv,ctx);
    if(!response.ok)return response;
    let data;try{data=await response.clone().json()}catch{return response}
    const reportId=data.report_import_id;
    if(!reportId)return response;
    const imported=await db.prepare(`SELECT * FROM report_imports WHERE id=?`).bind(reportId).first();
    // Existing parser derives report_date. If imported date is older than authoritative date,
    // flag it as historical/non-authoritative. v10 does not use it to drive case recommendations.
    if(before?.report_date&&imported?.report_date&&String(imported.report_date)<String(before.report_date)){
      await db.prepare(`UPDATE report_imports SET chronology_status='historical',is_authoritative=FALSE,compared_to_report_id=? WHERE id=?`).bind(before.id,reportId).run();
      await addRecommendation(db,{clientId,caseId:(await db.prepare(`SELECT id FROM repair_cases WHERE client_id=? LIMIT 1`).bind(clientId).first())?.id,sourceType:"report",sourceId:reportId,type:"historical_report_review",title:"Reporte anterior importado",reason:`El reporte ${imported.report_date} es anterior al reporte vigente ${before.report_date}. Se conserva como histórico y no debe gobernar decisiones actuales.`,priority:5});
    }else{
      await db.prepare(`UPDATE report_imports SET chronology_status='current',is_authoritative=TRUE,compared_to_report_id=? WHERE id=?`).bind(before?.id||null,reportId).run();
      if(before)await db.prepare(`UPDATE report_imports SET is_authoritative=FALSE WHERE id=?`).bind(before.id).run();
      await snapshotCurrent(db,clientId,reportId);
      const rc=await db.prepare(`SELECT id FROM repair_cases WHERE client_id=? LIMIT 1`).bind(clientId).first();
      await addRecommendation(db,{clientId,caseId:rc?.id,sourceType:"report",sourceId:reportId,type:"review_new_report",title:"Analizar nuevo reporte",reason:"Nuevo reporte vigente importado. Revisar eliminaciones, correcciones, reinsertions y diferencias antes de decidir la siguiente acción.",priority:8});
      if(rc)await db.prepare(`UPDATE repair_cases SET current_stage='results_review',next_action='Revisar resultados del nuevo reporte',updated_at=NOW() WHERE id=?`).bind(rc.id).run();
    }
    return json({...data,chronology_status:(before?.report_date&&imported?.report_date&&String(imported.report_date)<String(before.report_date))?"historical":"current",authoritative_report_id:(before?.report_date&&imported?.report_date&&String(imported.report_date)<String(before.report_date))?before.id:reportId},response.status);
  }
  return v91Worker.fetch(request,runtimeEnv,ctx);
 }
};