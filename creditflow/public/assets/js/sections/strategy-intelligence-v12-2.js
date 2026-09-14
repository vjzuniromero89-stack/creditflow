import { api } from "../api.js";
import { escapeHtml } from "../utils.js";

function norm(v){return String(v??"").trim().toLowerCase().replace(/\s+/g," ")}
function key(item){
 const digits=String(item.account_number||"").replace(/\D/g,"");
 return `${norm(item.creditor_name)}|${digits.slice(-4)||norm(item.account_number)}`;
}
function bureau(v){
 const s=norm(v);
 if(s.includes("experian"))return "Experian";
 if(s.includes("equifax"))return "Equifax";
 if(s.includes("transunion")||s.includes("trans union"))return "TransUnion";
 return String(v||"Otro");
}
function isCollection(i){
 const c=norm(i.category),s=norm(i.status_raw||i.status),n=norm(i.creditor_name);
 return c.includes("collection")||s.includes("collection")||c.includes("charge")||
        s.includes("charge off")||n.includes("collection")||n.includes("recovery")||n.includes("receivable");
}
function groups(items){
 const m=new Map();
 for(const i of items){const k=key(i);if(!m.has(k))m.set(k,[]);m.get(k).push(i)}
 return [...m.values()];
}
function compare(g){
 const defs=[
  ["balance","Balance"],["status_raw","Estado"],["date_opened","Fecha de apertura"],
  ["opened_date","Fecha de apertura"],["date_of_first_delinquency","Primera morosidad"],
  ["first_delinquency_date","Primera morosidad"],["last_payment_date","Último pago"],
  ["original_creditor","Acreedor original"],["account_type","Tipo de cuenta"],
  ["payment_status","Payment status"]
 ];
 const out=[],seen=new Set();
 for(const [k,l] of defs){
  if(seen.has(l))continue;
  const vals=g.map(x=>({b:bureau(x.bureaus),v:x[k]})).filter(x=>x.v!==null&&x.v!==undefined&&String(x.v).trim()!=="");
  if(vals.length<2)continue;
  if(new Set(vals.map(x=>norm(x.v))).size>1){out.push({label:l,values:vals});seen.add(l)}
 }
 return out;
}
function complianceFor(g,checks){
 const first=g[0];
 return checks.find(c=>String(c.credit_item_id||"")===String(first.id))||
        checks.find(c=>norm(c.collector_name)===norm(first.creditor_name))||null;
}
function recommendation(g,findings,check){
 const a=g.find(x=>x.assessment?.human_verified)?.assessment || g[0]?.assessment;
 if(a?.accuracy_status==="accurate_negative"){
   if(isCollection(g[0]) && check?.human_verified && check.license_required_status==="required" &&
      ["inactive","not_found"].includes(check.license_status)){
     return {level:"high",title:"Revisión regulatoria prioritaria",
       text:"La cuenta fue reconocida como correcta, pero existe un hallazgo de licencia confirmado. No convierte la deuda en inválida automáticamente; revisar compliance antes de decidir la acción."};
   }
   return {level:"neutral",title:"No disputar por inexactitud",
     text:"El diagnóstico humano indica que la información negativa es correcta. Mantener fuera de una disputa factual."};
 }
 if(findings.length && a?.human_verified){
   return {level:"ready",title:"Posible disputa factual",
     text:`Hay ${findings.length} diferencia(s) entre burós y existe diagnóstico humano. Revisar que la carta cite solamente los campos realmente inconsistentes.`};
 }
 if(findings.length){
   return {level:"review",title:"Inconsistencias detectadas — falta confirmar",
     text:`CreditFlow detectó ${findings.length} diferencia(s) entre burós. Deben revisarse antes de construir una disputa.`};
 }
 if(isCollection(g[0])){
   if(!check)return {level:"review",title:"Verificar collector",text:"No hay una verificación regulatoria guardada para este collector."};
   if(check.human_verified && check.license_required_status==="required" && check.license_status==="inactive")
     return {level:"high",title:"Licencia inactiva confirmada",text:"Hallazgo regulatorio confirmado. Requiere revisión de estrategia; no usarlo automáticamente como afirmación de que la deuda es inválida."};
   if(check.human_verified && check.license_required_status==="required" && check.license_status==="not_found")
     return {level:"high",title:"Licencia no localizada tras revisión",text:"Hallazgo para revisión de compliance. Confirmar nombre legal, jurisdicción y fuente antes de cualquier acción."};
   if(check.license_status==="active")
     return {level:"neutral",title:"Licencia registrada como activa",text:"No hay señal de licencia para usar como hallazgo regulatorio en este momento."};
   return {level:"review",title:"Compliance pendiente",text:"Completar verificación del collector antes de cerrar la estrategia."};
 }
 return {level:"neutral",title:"Sin señal adicional",text:"No se detectó una inconsistencia inter-buró adicional con los campos disponibles."};
}

function ensureStyles(){
 if(document.getElementById("cf122-style"))return;
 const s=document.createElement("style");s.id="cf122-style";
 s.textContent=`
 #cf122-intelligence{margin-bottom:18px}
 .cf122-wrap{border:1px solid rgba(120,150,170,.22);border-radius:16px;padding:16px;background:rgba(5,18,28,.48)}
 .cf122-head{display:flex;justify-content:space-between;gap:14px;align-items:flex-start;margin-bottom:12px}
 .cf122-head h3{margin:2px 0 4px;font-size:18px}.cf122-head p{margin:0;color:var(--cf7-muted);font-size:12px}
 .cf122-badge{font-size:10px;padding:6px 9px;border:1px solid rgba(100,180,255,.3);border-radius:999px;white-space:nowrap}
 .cf122-grid{display:grid;gap:10px}
 .cf122-card{padding:12px;border:1px solid rgba(120,150,170,.18);border-radius:12px;background:rgba(9,26,38,.55)}
 .cf122-top{display:flex;justify-content:space-between;gap:10px}.cf122-top span{display:block;color:var(--cf7-muted);font-size:10px;margin-top:2px}
 .cf122-state{font-size:10px;padding:5px 8px;border-radius:999px;height:max-content;border:1px solid rgba(120,150,170,.25)}
 .cf122-state.high{border-color:rgba(255,95,95,.35)}.cf122-state.ready{border-color:rgba(78,200,135,.35)}
 .cf122-state.review{border-color:rgba(245,190,70,.35)}
 .cf122-findings{margin-top:9px;display:grid;gap:5px}.cf122-findings div{font-size:10px;color:var(--cf7-muted)}
 .cf122-rec{margin-top:10px;padding-top:9px;border-top:1px solid rgba(120,150,170,.15)}
 .cf122-rec strong{display:block;font-size:11px}.cf122-rec span{display:block;color:var(--cf7-muted);font-size:10px;line-height:1.45;margin-top:3px}
 @media(max-width:800px){.cf122-head,.cf122-top{flex-direction:column}}
 `;
 document.head.appendChild(s);
}

export async function renderStrategyIntelligenceV122(container,clientId){
 ensureStyles();
 container.innerHTML=`<div class="cf122-wrap">Analizando inconsistencias y compliance…</div>`;
 try{
  const [state,comp]=await Promise.all([
   api.get(`/strategy/client/${clientId}`),
   api.get(`/collector-compliance/client/${clientId}`).catch(()=>({checks:[]}))
  ]);
  const items=(state.items||[]).filter(x=>x.removed_status!=="eliminado");
  const checks=comp.checks||[];
  const gs=groups(items);
  const rows=gs.map(g=>{
    const f=compare(g),check=complianceFor(g,checks),rec=recommendation(g,f,check),first=g[0];
    const bureaus=[...new Set(g.map(x=>bureau(x.bureaus)))];
    const compliance=isCollection(first)
      ? (check?.human_verified ? `${check.license_status||"review"} · ${check.jurisdiction||""}` : "pendiente")
      : "n/a";
    return `<article class="cf122-card">
      <div class="cf122-top"><div><strong>${escapeHtml(first.creditor_name||"Cuenta")}</strong>
       <span>${escapeHtml(first.account_number||"")} · ${escapeHtml(bureaus.join(", "))}</span></div>
       <b class="cf122-state ${rec.level}">${escapeHtml(rec.title)}</b></div>
      ${f.length?`<div class="cf122-findings">${f.map(x=>`<div><b>${escapeHtml(x.label)}:</b> ${x.values.map(v=>`${escapeHtml(v.b)} ${escapeHtml(String(v.v))}`).join(" · ")}</div>`).join("")}</div>`:""}
      ${isCollection(first)?`<div class="cf122-findings"><div><b>Collector compliance:</b> ${escapeHtml(compliance)}</div></div>`:""}
      <div class="cf122-rec"><strong>Recomendación CreditFlow</strong><span>${escapeHtml(rec.text)}</span></div>
    </article>`;
  }).join("");
  const high=gs.filter(g=>{
    const f=compare(g),c=complianceFor(g,checks),r=recommendation(g,f,c); return r.level==="high"||r.level==="ready";
  }).length;
  container.innerHTML=`<section class="cf122-wrap">
   <div class="cf122-head"><div><div class="cf7-eyebrow">STRATEGY INTELLIGENCE v12.2</div><h3>Hallazgos antes de construir la estrategia</h3>
    <p>Combina comparación entre burós, diagnóstico humano y collector compliance. Los hallazgos regulatorios no se convierten automáticamente en una disputa.</p></div>
    <div class="cf122-badge">${high} hallazgo(s) prioritario(s)</div></div>
   <div class="cf122-grid">${rows||`<div class="empty">No hay cuentas activas.</div>`}</div>
  </section>`;
 }catch(e){
  container.innerHTML=`<div class="cf122-wrap"><strong>No se pudo cargar Strategy Intelligence.</strong><p>${escapeHtml(e.message||String(e))}</p></div>`;
 }
}
