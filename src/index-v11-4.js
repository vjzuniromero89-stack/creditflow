// CreditFlow v11.4 — fixes PostGrid status/test Error 500
import v113Worker from "./index-v11-3.js";
import baseWorker from "./index.js";
import { createD1Shim } from "./db-shim.js";

const PG="https://api.postgrid.com/print-mail/v1";
const out=(x,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});

async function auth(request,env,ctx){
  const u=new URL(request.url); u.pathname="/api/auth/status"; u.search="";
  const r=await baseWorker.fetch(new Request(u,{method:"GET",headers:request.headers}),env,ctx);
  if(!r.ok)return false;
  try{return !!(await r.json()).authenticated}catch{return false}
}

async function safeDbState(env){
  const db=createD1Shim(env);
  // One RPC call instead of the multiple chained calls in v11.
  const q=`
    SELECT json_build_object(
      'provider', COALESCE(
        (SELECT row_to_json(p) FROM mail_provider_settings p WHERE p.provider='postgrid' LIMIT 1),
        json_build_object('provider','postgrid','environment','test','connection_status','ready_for_test')
      ),
      'jobs', COALESCE((
        SELECT json_agg(row_to_json(x)) FROM (
          SELECT j.*,l.title,l.recipient_name,l.recipient_address,l.status AS letter_status,c.full_name AS client_name
          FROM certified_mail_jobs j
          LEFT JOIN letters l ON l.id=j.letter_id
          LEFT JOIN clients c ON c.id=j.client_id
          WHERE j.provider='postgrid'
          ORDER BY j.created_at DESC LIMIT 100
        ) x
      ),'[]'::json),
      'ready_letters', COALESCE((
        SELECT json_agg(row_to_json(y)) FROM (
          SELECT l.id,l.client_id,l.title,l.recipient_name,l.recipient_address,l.round_number,l.status,c.full_name AS client_name
          FROM letters l JOIN clients c ON c.id=l.client_id
          WHERE l.status='lista'
          ORDER BY c.full_name,l.created_at DESC
        ) y
      ),'[]'::json)
    ) AS state`;
  const row=await db.prepare(q).first();
  return row?.state || {provider:{provider:"postgrid"},jobs:[],ready_letters:[]};
}

async function status(request,env,ctx){
  if(!(await auth(request,env,ctx)))return out({error:"No autorizado"},401);
  try{
    const state=await safeDbState(env);
    state.provider=state.provider||{};
    state.provider.credentials_configured=typeof env.POSTGRID_TEST_API_KEY==="string"&&env.POSTGRID_TEST_API_KEY.length>0;
    state.provider.environment="test";
    state.provider.live_enabled=false;
    if(state.provider.credentials_configured && state.provider.connection_status==="awaiting_credentials")
      state.provider.connection_status="ready_for_test";
    return out(state);
  }catch(e){
    // Return useful diagnostics instead of an opaque Error 500.
    return out({error:"No se pudo cargar PostGrid",detail:String(e?.message||e),code:"POSTGRID_STATUS_DB_ERROR"},500);
  }
}

async function test(request,env,ctx){
  if(!(await auth(request,env,ctx)))return out({error:"No autorizado"},401);
  const key=env.POSTGRID_TEST_API_KEY;
  if(typeof key!=="string"||!key.trim())return out({error:"POSTGRID_TEST_API_KEY no está disponible en el Worker."},500);
  try{
    const r=await fetch(`${PG}/letters?limit=1`,{headers:{"X-API-Key":key}});
    let data={}; try{data=await r.json()}catch{}
    if(!r.ok)return out({error:data?.message||data?.error?.message||`PostGrid HTTP ${r.status}`,postgrid_status:r.status},400);

    // Connection success is real even if recording the status later fails.
    try{
      const db=createD1Shim(env);
      await db.prepare(`UPDATE mail_provider_settings SET connection_status='connected',credentials_configured=TRUE,last_test_at=NOW(),last_test_status='success',last_test_message='Conexión TEST correcta',updated_at=NOW() WHERE provider='postgrid'`).run();
    }catch{}
    return out({ok:true,message:"PostGrid TEST conectado correctamente.",environment:"test",live:false});
  }catch(e){
    return out({error:String(e?.message||e),code:"POSTGRID_NETWORK_ERROR"},502);
  }
}

export default{
  async fetch(request,env,ctx){
    const u=new URL(request.url);
    if(u.pathname==="/api/postgrid/status"&&request.method==="GET")return status(request,env,ctx);
    if(u.pathname==="/api/postgrid/test"&&request.method==="POST")return test(request,env,ctx);
    return v113Worker.fetch(request,env,ctx);
  }
};
