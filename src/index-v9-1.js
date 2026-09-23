import v9Worker from "./index-v9.js";
import { createD1Shim } from "./db-shim.js";

function json(data,status=200){
  return new Response(JSON.stringify(data),{
    status,
    headers:{"content-type":"application/json; charset=utf-8"}
  });
}

async function authOk(request,env,ctx){
  const u=new URL(request.url);
  u.pathname="/api/auth/status";
  u.search="";
  const probe=new Request(u.toString(),{method:"GET",headers:request.headers});
  const resp=await v9Worker.fetch(probe,env,ctx);
  if(!resp.ok)return false;
  try{return !!(await resp.json()).authenticated}catch{return false}
}

async function getCase(db,clientId){
  return db.prepare(`SELECT * FROM repair_cases WHERE client_id=? LIMIT 1`).bind(clientId).first();
}

async function pauseCase(request,db,clientId){
  const repairCase=await getCase(db,clientId);
  if(!repairCase)return json({error:"Este cliente no tiene una reparación iniciada."},404);
  let body={}; try{body=await request.json()}catch{}
  const reason=String(body.reason||"Pausado manualmente").trim().slice(0,500);

  await db.prepare(`
    UPDATE repair_cases
    SET status='paused', paused_reason=?, updated_at=NOW()
    WHERE id=?
  `).bind(reason,repairCase.id).run();

  await db.prepare(`
    INSERT INTO repair_case_events
      (repair_case_id,client_id,event_type,from_stage,to_stage,detail,metadata_json)
    VALUES (?,?, 'case_paused', ?, ?, ?, ?)
  `).bind(
    repairCase.id,clientId,repairCase.current_stage,repairCase.current_stage,
    reason,JSON.stringify({source:"manual"})
  ).run();

  return json({ok:true,case:await getCase(db,clientId)});
}

async function resumeCase(db,clientId){
  const repairCase=await getCase(db,clientId);
  if(!repairCase)return json({error:"Este cliente no tiene una reparación iniciada."},404);

  await db.prepare(`
    UPDATE repair_cases
    SET status='active', paused_reason=NULL, updated_at=NOW()
    WHERE id=?
  `).bind(repairCase.id).run();

  await db.prepare(`
    INSERT INTO repair_case_events
      (repair_case_id,client_id,event_type,from_stage,to_stage,detail,metadata_json)
    VALUES (?,?, 'case_resumed', ?, ?, 'Caso reanudado manualmente.', ?)
  `).bind(
    repairCase.id,clientId,repairCase.current_stage,repairCase.current_stage,
    JSON.stringify({source:"manual"})
  ).run();

  return json({ok:true,case:await getCase(db,clientId)});
}

async function resetCase(db,clientId){
  const client=await db.prepare(`SELECT id,full_name FROM clients WHERE id=?`).bind(clientId).first();
  if(!client)return json({error:"Cliente no encontrado."},404);

  const repairCase=await getCase(db,clientId);
  if(!repairCase){
    return json({ok:true,already_reset:true,message:"Este cliente ya está listo para empezar desde cero."});
  }

  // 1) Identify strategy-generated letters that are still safe to remove.
  // Sent/delivered/responded/completed letters are NEVER deleted.
  const {results:linkedLetters}=await db.prepare(`
    SELECT DISTINCT l.id,l.status
    FROM strategy_actions sa
    JOIN letters l ON l.id=sa.letter_id
    WHERE sa.client_id=?
  `).bind(clientId).all();

  const removable=(linkedLetters||[])
    .filter(l=>["borrador","lista"].includes(l.status))
    .map(l=>l.id);

  let removedDrafts=0;
  for(const letterId of removable){
    const mailed=await db.prepare(`
      SELECT id FROM mailings WHERE letter_id=? LIMIT 1
    `).bind(letterId).first();

    const providerJob=await db.prepare(`
      SELECT id,status FROM certified_mail_jobs
      WHERE letter_id=? LIMIT 1
    `).bind(letterId).first();

    // If a mailing already exists, or provider job has progressed beyond pre-send,
    // preserve the letter and history.
    const unsafeProvider = providerJob && !["awaiting_approval","approved_waiting_provider","cancelled"].includes(providerJob.status);
    if(mailed || unsafeProvider) continue;

    await db.prepare(`DELETE FROM certified_mail_jobs WHERE letter_id=?`).bind(letterId).run();
    await db.prepare(`DELETE FROM letters WHERE id=? AND status IN ('borrador','lista')`).bind(letterId).run();
    removedDrafts++;
  }

  // 2) Remove only v8/v9 workflow state.
  // Historical client/report/credit data is intentionally untouched.
  await db.prepare(`DELETE FROM certified_mail_jobs WHERE client_id=? AND status IN ('awaiting_approval','approved_waiting_provider','cancelled')`).bind(clientId).run();
  await db.prepare(`DELETE FROM strategy_actions WHERE client_id=?`).bind(clientId).run();
  await db.prepare(`DELETE FROM strategy_runs WHERE client_id=?`).bind(clientId).run();
  await db.prepare(`DELETE FROM dispute_assessments WHERE client_id=?`).bind(clientId).run();
  await db.prepare(`DELETE FROM repair_case_events WHERE client_id=?`).bind(clientId).run();
  await db.prepare(`DELETE FROM repair_cases WHERE client_id=?`).bind(clientId).run();

  // 3) Write a generic activity record so the administrative reset itself is auditable.
  await db.prepare(`
    INSERT INTO activity_log(entity_type,entity_id,action,detail)
    VALUES ('client',?,'repair_workflow_reset',?)
  `).bind(
    clientId,
    `Flujo de reparación reiniciado. ${removedDrafts} borrador(es) de estrategia sin enviar fueron eliminados.`
  ).run();

  return json({
    ok:true,
    client_id:Number(clientId),
    client_name:client.full_name,
    removed_strategy_drafts:removedDrafts,
    preserved:{
      client:true,
      credit_report:true,
      credit_items:true,
      documents:true,
      addresses:true,
      scores:true,
      sent_letters:true,
      mailing_history:true
    }
  });
}

export default {
  async fetch(request,env,ctx){
    const runtimeEnv={...env,DB:createD1Shim(env)};
    const db=runtimeEnv.DB;
    const url=new URL(request.url);
    const path=url.pathname;
    const method=request.method.toUpperCase();

    if(!path.startsWith("/api/")){
      return v9Worker.fetch(request,runtimeEnv,ctx);
    }

    const authenticated=await authOk(request,runtimeEnv,ctx);
    if(!authenticated && !path.startsWith("/api/auth/") && !path.startsWith("/api/portal/")){
      return v9Worker.fetch(request,runtimeEnv,ctx);
    }

    const reset=path.match(/^\/api\/repair-cases\/(\d+)\/reset$/);
    if(reset && method==="POST") return resetCase(db,reset[1]);

    const pause=path.match(/^\/api\/repair-cases\/(\d+)\/pause$/);
    if(pause && method==="POST") return pauseCase(request,db,pause[1]);

    const resume=path.match(/^\/api\/repair-cases\/(\d+)\/resume$/);
    if(resume && method==="POST") return resumeCase(db,resume[1]);

    return v9Worker.fetch(request,runtimeEnv,ctx);
  }
};
