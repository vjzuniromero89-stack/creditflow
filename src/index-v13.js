// CreditFlow v13 — Aggressive Compliance Engine
// Completely separate from the existing Strategy Engine.
// It analyzes opportunities and stores findings in its own tables.
// It does NOT modify dispute_assessments, strategy_actions, letters, mailings, or repair workflow.
import v125 from "./index-v12-5.js";
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
function key(i){
  const digits=String(i.account_number||"").replace(/\D/g,"");
  return `${norm(i.creditor_name)}|${digits.slice(-4)||norm(i.account_number)}`;
}
function bureau(v){
  const s=norm(v);
  if(s.includes("experian"))return "Experian";
  if(s.includes("equifax"))return "Equifax";
  if(s.includes("transunion")||s.includes("trans union"))return "TransUnion";
  return String(v||"");
}
function isCollection(i){
  const c=norm(i.category),s=norm(i.status_raw||i.status),n=norm(i.creditor_name);
  return c.includes("collection")||c.includes("coleccion")||s.includes("collection")||
         n.includes("collection")||n.includes("recovery")||n.includes("receivable")||n.includes("funding");
}
function isChargeoff(i){
  return norm(i.category).includes("charge")||norm(i.status_raw||i.status).includes("charge off");
}
function isLate(i){
  return norm(i.category).includes("pago_tardio")||norm(i.category).includes("late")||
         norm(i.status_raw||i.status).includes("delinq")||norm(i.status_raw||i.status).includes("pd was");
}
function parseDate(v){
  if(!v)return null;
  const d=new Date(v); return isNaN(d)?null:d;
}
function compareGroup(g){
  const defs=[
    ["balance","Balance"],["status_raw","Estado"],["category","Categoría"],
    ["date_opened","Fecha de apertura"],["opened_date","Fecha de apertura"],
    ["date_of_first_delinquency","Primera morosidad"],["first_delinquency_date","Primera morosidad"],
    ["last_payment_date","Último pago"],["original_creditor","Acreedor original"],
    ["account_type","Tipo de cuenta"],["payment_status","Payment status"]
  ];
  const out=[],seen=new Set();
  for(const [field,label] of defs){
    if(seen.has(label))continue;
    const vals=g.map(x=>({bureau:bureau(x.bureaus),value:x[field]}))
      .filter(x=>x.value!==null&&x.value!==undefined&&String(x.value).trim()!=="");
    if(vals.length>=2&&new Set(vals.map(x=>norm(x.value))).size>1){
      out.push({field,label,values:vals});seen.add(label);
    }
  }
  return out;
}
function addFinding(arr,item,props){
  arr.push({
    credit_item_id:item?.id||null,
    creditor_name:item?.creditor_name||null,
    account_number:item?.account_number||null,
    bureau:item?bureau(item.bureaus):null,
    category:item?.category||null,
    severity:"review",
    confidence:70,
    ...props
  });
}
async function analyze(db,clientId){
  const [{results:items}, removalRes, responseRes, complianceRes] = await Promise.all([
    db.prepare(`SELECT * FROM credit_items WHERE client_id=? AND COALESCE(removed_status,'')<>'eliminado' ORDER BY id`).bind(clientId).all(),
    db.prepare(`SELECT * FROM removal_events WHERE client_id=? ORDER BY id DESC`).bind(clientId).all().catch(()=>({results:[]})),
    db.prepare(`SELECT * FROM dispute_responses WHERE client_id=? ORDER BY id DESC`).bind(clientId).all().catch(()=>({results:[]})),
    db.prepare(`SELECT * FROM collector_compliance_checks WHERE client_id=? ORDER BY updated_at DESC,id DESC`).bind(clientId).all().catch(()=>({results:[]}))
  ]);

  const removals=removalRes.results||[],responses=responseRes.results||[],checks=complianceRes.results||[];
  const findings=[];
  const groups=new Map();
  for(const item of items||[]){
    const k=key(item);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(item);
  }

  for(const group of groups.values()){
    const primary=group[0];
    const diffs=compareGroup(group);

    if(diffs.length){
      addFinding(findings,primary,{
        finding_code:"CROSS_BUREAU_MISMATCH",
        finding_type:"reporting_accuracy",
        severity:"high",
        title:`${diffs.length} diferencia(s) entre burós`,
        detail:diffs.map(d=>`${d.label}: ${d.values.map(v=>`${v.bureau}=${v.value}`).join(" | ")}`).join("\n"),
        legal_basis:"FCRA accuracy/reinvestigation review",
        recommended_action:"Revisar cada diferencia y, si es material y verificable, adoptar una disputa factual específica.",
        evidence_needed:"Página(s) del reporte y cualquier documento que confirme el valor correcto.",
        confidence:90
      });
    }

    // Duplicate same account within same bureau.
    const byBureau={};
    for(const i of group){const b=bureau(i.bureaus)||"Unknown";byBureau[b]=(byBureau[b]||0)+1}
    for(const [b,count] of Object.entries(byBureau)){
      if(count>1)addFinding(findings,primary,{
        finding_code:"POSSIBLE_DUPLICATE",
        finding_type:"duplicate_reporting",
        severity:"high",
        title:`Posible duplicado en ${b}`,
        detail:`La misma cuenta aparece ${count} veces para ${b}.`,
        legal_basis:"FCRA accuracy review",
        recommended_action:"Verificar que no sean tradelines legítimos distintos. Si es duplicado real, adoptar disputa por duplicación.",
        evidence_needed:"Reporte completo y número de cuenta/identificadores.",
        confidence:85
      });
    }

    // Re-aging / obsolete review signal.
    const firstDelinq=group.map(i=>parseDate(i.date_of_first_delinquency||i.first_delinquency_date)).filter(Boolean).sort((a,b)=>a-b)[0];
    if(firstDelinq){
      const years=(Date.now()-firstDelinq.getTime())/(365.25*864e5);
      if(years>=6.5){
        addFinding(findings,primary,{
          finding_code:"AGING_REVIEW",
          finding_type:"obsolescence",
          severity:years>=7?"high":"review",
          title:"Revisar antigüedad / posible obsolescencia",
          detail:`La primera morosidad disponible tiene aproximadamente ${years.toFixed(1)} años.`,
          legal_basis:"FCRA obsolescence timing review",
          recommended_action:"Confirmar DOFD y fecha de exclusión. Adoptar solo si los datos sustentan obsolescencia o re-aging.",
          evidence_needed:"DOFD, historial del reporte y reportes anteriores.",
          confidence:80
        });
      }
    }

    if(isCollection(primary)){
      const check=checks.find(c=>String(c.credit_item_id||"")===String(primary.id))||
                  checks.find(c=>norm(c.collector_name)===norm(primary.creditor_name));
      if(!check||!check.human_verified){
        addFinding(findings,primary,{
          finding_code:"COLLECTOR_COMPLIANCE_UNVERIFIED",
          finding_type:"collector_compliance",
          severity:"review",
          title:"Collector compliance sin verificar",
          detail:"No existe una verificación oficial confirmada del collector para este expediente.",
          legal_basis:"State licensing / collector compliance review",
          recommended_action:"Verificar nombre legal, jurisdicción, NMLS/licencia y vigencia. Adoptar una estrategia solo si surge un hallazgo real.",
          evidence_needed:"Fuente oficial del regulador, nombre legal, NMLS/licencia y fecha de consulta.",
          confidence:75
        });
      }else if(check.license_required_status==="required"&&["inactive","not_found"].includes(check.license_status)){
        addFinding(findings,primary,{
          finding_code:"COLLECTOR_LICENSE_SIGNAL",
          finding_type:"collector_compliance",
          severity:"high",
          title:"Hallazgo de licencia del collector",
          detail:`Estado registrado: ${check.license_status}. Jurisdicción: ${check.jurisdiction||"no indicada"}.`,
          legal_basis:"State collector licensing review",
          recommended_action:"Reconfirmar la fuente oficial y, si sigue vigente, adoptar una estrategia de compliance separada.",
          evidence_needed:"Captura/fuente oficial, NMLS/licencia y fecha de revisión.",
          confidence:90
        });
      }

      addFinding(findings,primary,{
        finding_code:"OWNERSHIP_DOCUMENTATION_REVIEW",
        finding_type:"documentation",
        severity:"review",
        title:"Revisar cadena de titularidad y documentación",
        detail:"La cuenta es una collection. El motor recomienda revisar acreedor original, propietario actual, balance y referencias del account.",
        legal_basis:"Documentation/ownership review",
        recommended_action:"Investigar si los datos del reporte y cualquier respuesta del collector identifican claramente la obligación y propietario actual. Adoptar una disputa solo si aparece una inconsistencia concreta.",
        evidence_needed:"Respuesta del collector, estados de cuenta, contrato/assignment si existe, reporte.",
        confidence:70
      });
    }

    if(isChargeoff(primary)){
      addFinding(findings,primary,{
        finding_code:"CHARGEOFF_FIELD_REVIEW",
        finding_type:"furnisher_reporting",
        severity:"review",
        title:"Auditoría profunda del charge-off",
        detail:"Revisar DOFD, balance, amount past due, ownership, fecha de cierre y actualizaciones posteriores al charge-off.",
        legal_basis:"FCRA/Reg V accuracy review",
        recommended_action:"Adoptar direct furnisher/CRA dispute únicamente si se identifica un campo concreto incorrecto o incompleto.",
        evidence_needed:"Reportes anteriores, statements, payment history y documentos del furnisher.",
        confidence:72
      });
    }

    if(isLate(primary)){
      addFinding(findings,primary,{
        finding_code:"LATE_PAYMENT_DEEP_REVIEW",
        finding_type:"payment_history",
        severity:"review",
        title:"Revisar late payment a nivel de mes",
        detail:"Comparar mes reportado, payment history grid, fecha de pago, deferment/forbearance y cualquier ajuste del acreedor.",
        legal_basis:"FCRA/Reg V accuracy review",
        recommended_action:"Si aparece una contradicción específica, adoptar disputa factual. Si todo es correcto, mantener goodwill como ruta separada.",
        evidence_needed:"Estados de cuenta, comprobantes, acuerdos de deferment/forbearance y reporte.",
        confidence:75
      });
    }

    const reinserted=removals.find(r=>String(r.credit_item_id)===String(primary.id)&&r.status==="reappeared");
    if(reinserted)addFinding(findings,primary,{
      finding_code:"REINSERTION",
      finding_type:"reinsertion",
      severity:"high",
      title:"Cuenta reinsertada",
      detail:"Existe historial interno de remoción seguida de reaparición.",
      legal_basis:"FCRA reinsertion review",
      recommended_action:"Revisar notices/reinsertion requirements y adoptar challenge si corresponde.",
      evidence_needed:"Reporte anterior con remoción, reporte nuevo y notificaciones del CRA.",
      confidence:95
    });

    const relatedResponses=responses.filter(r=>String(r.credit_item_id||"")===String(primary.id));
    for(const r of relatedResponses){
      const sent=parseDate(r.sent_at||r.dispute_sent_at||r.created_at);
      const received=parseDate(r.received_at||r.response_date);
      if(sent&&!received){
        const days=(Date.now()-sent.getTime())/864e5;
        if(days>=30)addFinding(findings,primary,{
          finding_code:"RESPONSE_DEADLINE_REVIEW",
          finding_type:"timeline",
          severity:"high",
          title:"Revisar plazo de investigación",
          detail:`Hay una disputa registrada sin respuesta recibida y han transcurrido aproximadamente ${Math.floor(days)} días.`,
          legal_basis:"FCRA reinvestigation timing review",
          recommended_action:"Confirmar fecha de recepción por el CRA, posibles extensiones y si el plazo aplicable expiró antes de adoptar seguimiento.",
          evidence_needed:"Certified mail/delivery date, copia de disputa y cualquier respuesta recibida.",
          confidence:88
        });
      }
    }
  }

  const actionable=findings.filter(f=>f.severity==="high").length;
  const run=await db.prepare(`
    INSERT INTO aggressive_compliance_runs(client_id,status,findings_count,actionable_count,summary_json)
    VALUES (?,'completed',?,?,?) RETURNING *
  `).bind(clientId,findings.length,actionable,JSON.stringify({
    engine:"v13",accounts:(items||[]).length,findings:findings.length,actionable
  })).first();

  if(findings.length){
    const ph=findings.map(()=>"(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").join(",");
    const params=[];
    for(const f of findings)params.push(
      run.id,clientId,f.credit_item_id,f.creditor_name,f.account_number,f.bureau,f.category,
      f.finding_code,f.finding_type,f.severity,f.title,f.detail,f.legal_basis||null,
      f.recommended_action||null,f.evidence_needed||null
    );
    await db.prepare(`
      INSERT INTO aggressive_compliance_findings(
        run_id,client_id,credit_item_id,creditor_name,account_number,bureau,category,
        finding_code,finding_type,severity,title,detail,legal_basis,recommended_action,evidence_needed
      ) VALUES ${ph}
    `).bind(params).run();

    // Confidence update is kept separate/simple.
    for(const f of findings){
      // no-op here; default confidence is sufficient for v13.0 UI
    }
  }
  return {run,findings_count:findings.length,actionable_count:actionable};
}

export default{async fetch(request,env,ctx){
  const u=new URL(request.url),m=request.method.toUpperCase();
  const get=u.pathname.match(/^\/api\/aggressive-compliance\/client\/(\d+)$/);
  if(m==="GET"&&get){
    if(!(await auth(request,env,ctx)))return json({error:"No autorizado"},401);
    const db=createD1Shim(env),id=Number(get[1]);
    const run=await db.prepare(`SELECT * FROM aggressive_compliance_runs WHERE client_id=? ORDER BY id DESC LIMIT 1`).bind(id).first();
    if(!run)return json({run:null,findings:[]});
    const {results:findings}=await db.prepare(`SELECT * FROM aggressive_compliance_findings WHERE run_id=? ORDER BY CASE severity WHEN 'high' THEN 1 WHEN 'review' THEN 2 ELSE 3 END,id`).bind(run.id).all();
    return json({run,findings:findings||[]});
  }
  const analyzeMatch=u.pathname.match(/^\/api\/aggressive-compliance\/client\/(\d+)\/analyze$/);
  if(m==="POST"&&analyzeMatch){
    if(!(await auth(request,env,ctx)))return json({error:"No autorizado"},401);
    try{return json(await analyze(createD1Shim(env),Number(analyzeMatch[1])))}
    catch(e){return json({error:"Aggressive Compliance Engine falló",detail:String(e?.message||e)},500)}
  }
  const adopt=u.pathname.match(/^\/api\/aggressive-compliance\/client\/(\d+)\/findings\/(\d+)\/adopt$/);
  if(m==="POST"&&adopt){
    if(!(await auth(request,env,ctx)))return json({error:"No autorizado"},401);
    const db=createD1Shim(env),clientId=Number(adopt[1]),findingId=Number(adopt[2]);
    const found=await db.prepare(`SELECT * FROM aggressive_compliance_findings WHERE id=? AND client_id=?`).bind(findingId,clientId).first();
    if(!found)return json({error:"Hallazgo no encontrado"},404);
    await db.prepare(`UPDATE aggressive_compliance_findings SET status='adopted',adopted_at=NOW() WHERE id=?`).bind(findingId).run();
    return json({ok:true,status:"adopted"});
  }
  return v125.fetch(request,env,ctx);
}};
