// CreditFlow v11.3 — definitive Cloudflare env propagation fix
import v11Worker from "./index-v11.js";
import { createD1Shim } from "./db-shim.js";

function json(data,status=200){
  return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
}

function envBridge(env){
  // index-v11 currently creates {...env}. Some Cloudflare runtime bindings/secrets
  // are accessible by property lookup but are not guaranteed to survive object spread.
  // This bridge explicitly exposes the bindings v11 needs as enumerable own properties.
  const bridge = Object.create(env);
  const names = [
    "POSTGRID_TEST_API_KEY","POSTGRID_WEBHOOK_SECRET",
    "SUPABASE_URL","SUPABASE_SECRET_KEY","SESSION_SECRET",
    "PII_ENCRYPTION_KEY","AI","ASSETS"
  ];
  for(const name of names){
    if(env[name] !== undefined){
      Object.defineProperty(bridge,name,{
        value:env[name], enumerable:true, configurable:true, writable:true
      });
    }
  }
  Object.defineProperty(bridge,"DB",{
    value:(env.DB && typeof env.DB.prepare==="function") ? env.DB : createD1Shim(env),
    enumerable:true, configurable:true, writable:true
  });
  return bridge;
}

export default {
  async fetch(request,env,ctx){
    const u=new URL(request.url);

    // Safe diagnostic. Never returns the secret itself.
    if(u.pathname==="/api/postgrid/runtime-check" && request.method==="GET"){
      const key=env.POSTGRID_TEST_API_KEY;
      return json({
        ok:true,
        postgrid_test_key_present:typeof key==="string" && key.trim().length>0,
        postgrid_test_key_length:typeof key==="string"?key.length:0,
        environment:"test",
        live_enabled:false,
        worker_version:"11.3"
      });
    }

    return v11Worker.fetch(request,envBridge(env),ctx);
  }
};
