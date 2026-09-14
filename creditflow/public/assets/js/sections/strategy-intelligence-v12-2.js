import { api } from "../api.js";
import { escapeHtml } from "../utils.js";

function norm(v){return String(v??"").trim().toLowerCase().replace(/\s+/g," ")}
function key(item){const d=String(item.account_number||"").replace(/\D/g,"");return `${norm(item.creditor_name)}|${d.slice(-4)||norm(item.account_number)}`}
function bureau(v){const s=norm(v);if(s.includes("experian"))return"Experian";if(s.includes("equifax"))return"Equifax";if(s.includes("transunion")||s.includes("trans union"))return"TransUnion";return String(v||"Otro")}
function isCollection(i){const c=norm(i.category),s=norm(i.status_raw||i.status),n=norm(i.creditor_name);return c.includes("collection")||s.includes("collection")||c.includes("charge")||s.includes("charge off")||n.includes("collection")||n.includes("recovery")||n.includes("receivable")}
function groups(items){const m=new Map();for(const i of items){const k=key(i);if(!m.has(k))m.set(k,[]);m.get(k).push(i)}return[...m.values()]}
function compare(g){
 const defs=[["balance","Balance"],["status_raw","Estado"],["date_opened","Fecha de apertura"],["opened_date","Fecha de apertura"],["date_of_first_delinquency","Primera morosidad"],["first_delinquency_date","Primera morosidad"],["last_payment_date","Último pago"],["original_creditor","Acreedor original"],["account_type","Tipo de cuenta"],["payment_status","Payment status"]];
 const out=[],seen=new Set();
 for(const[k,l]of defs){if(seen.has(l))continue;const vals=g.map(x=>({b:bureau(x.bureaus),v:x[k]})).filter(x=>x.v!==null&&x.v!==undefined&&String(x.v).trim()!=="");if(vals.length>=2&&new Set(vals.map(x=>norm(x.v))).size>1){out.push({label:l,values:vals});seen.add(l)}}
 return out;
}
function complianceFor(g,checks){const f=g[0];return checks.find(c=>String(c.credit_item_id||"")===String(f.id))||checks.find(c=>norm(c.collector_name)===norm(f.creditor_name))||null}
function assessmentFor(g){return g.find(x=>x.assessment?.human_verified)?.assessment||g.find(x=>x.assessment?.auto_ready)?.assessment||g[0]?.assessment}
function rec(g,f,c){
 const a=assessmentFor(g);
 if(a?.accuracy_status==="accurate_negative")return{level:"neutral",title:"No disputar por inexactitud",text:"La información fue clasificada como correcta. No se crea una disputa factual."};
 if(f.length&&a&&(a.human_verified||a.auto_ready))return{level:"ready",title:"Inconsistencia factual detectada",text:`CreditFlow detectó ${f.length} diferencia(s) entre burós y la auditoría está lista para estrategia.`};
 if(a?.auto_ready&&a?.accuracy_status==="unknown"){
   if(isCollection(g[0]))return{level:"review",title:"Sin inconsistencia CRA — revisar ruta collector",text:"La comparación automática no encontró diferencia material entre burós. CreditFlow no inventará una disputa; la ruta del collector/compliance se evalúa por separado."};
   return{level:"neutral",title:"Sin base factual automática",text:"No se detectó una inconsistencia material con los campos disponibles. La cuenta no debe disputarse automáticamente solo por ser negativa."};
 }
 if(isCollection(g[0])&&!c)return{level:"review",title:"Compliance pendiente",text:"No hay una verificación regulatoria guardada. Esto no convierte la deuda en inválida y se mantiene separado de la exactitud del reporte."};
 if(c?.human_verified&&c.license_required_status==="required"&&["inactive","not_found"].includes(c.license_status))return{level:"high",title:"Hallazgo regulatorio para revisión",text:`Estado registrado: ${c.license_status}. Revisar la fuente oficial antes de usar este hallazgo.`};
 return{level:"neutral",title:"Sin señal adicional",text:"No se detectó una señal adicional con los datos disponibles."};
}
function ensureStyles(){
 if(document.getElementById("cf127-style"))return;const s=document.createElement("style");s.id="cf127-style";s.textContent=`
 #cf122-intelligence{margin-bottom:18px}.cf122-wrap{border:1px solid rgba(120,150,170,.22);border-radius:16px;padding:16px;background:rgba(5,18,28,.48)}
 .cf122-head,.cf122-top{display:flex;justify-content:space-between;gap:14px;align-items:flex-start}.cf122-head{margin-bottom:12px}.cf122-head h3{margin:2px 0 4px;font-size:18px}.cf122-head p{margin:0;color:var(--cf7-muted);font-size:12px}
 .cf122-badge,.cf122-state{font-size:10px;padding:6px 9px;border:1px solid rgba(120,150,170,.25);border-radius:999px;white-space:nowrap}.cf122-grid{display:grid;gap:10px}.cf122-card{padding:12px;border:1px solid rgba(120,150,170,.18);border-radius:12px;background:rgba(9,26,38,.55)}
 .cf122-top span{display:block;color:var(--cf7-muted);font-size:10px;margin-top:2px}.cf122-findings{margin-top:9px;display:grid;gap:5px}.cf122-findings div{font-size:10px;color:var(--cf7-muted)}.cf122-rec{margin-top:10px;padding-top:9px;border-top:1px solid rgba(120,150,170,.15)}.cf122-rec strong{display:block;font-size:11px}.cf122-rec span{display:block;color:var(--cf7-muted);font-size:10px;line-height:1.45;margin-top:3px}
 @media(max-width:800px){.cf122-head,.cf122-top{flex-direction:column}}`;document.head.appendChild(s)
}
export async function renderStrategyIntelligenceV122(container,clientId){
 ensureStyles();container.innerHTML=`<div class="cf122-wrap">Analizando auditoría automática…</div>`;
 try{
  const[state,comp]=await Promise.all([api.get(`/strategy/client/${clientId}`),api.get(`/collector-compliance/client/${clientId}`).catch(()=>({checks:[]}))]);
  const items=(state.items||[]).filter(x=>x.removed_status!=="eliminado"),checks=comp.checks||[],gs=groups(items);
  let ready=0,review=0,neutral=0;
  const rows=gs.map(g=>{const f=compare(g),c=complianceFor(g,checks),r=rec(g,f,c),first=g[0];if(r.level==="ready"||r.level==="high")ready++;else if(r.level==="review")review++;else neutral++;
   return `<article class="cf122-card"><div class="cf122-top"><div><strong>${escapeHtml(first.creditor_name||"Cuenta")}</strong><span>${escapeHtml(first.account_number||"")} · ${escapeHtml([...new Set(g.map(x=>bureau(x.bureaus)))].join(", "))}</span></div><b class="cf122-state ${r.level}">${escapeHtml(r.title)}</b></div>${f.length?`<div class="cf122-findings">${f.map(x=>`<div><b>${escapeHtml(x.label)}:</b> ${x.values.map(v=>`${escapeHtml(v.b)} ${escapeHtml(String(v.v))}`).join(" · ")}</div>`).join("")}</div>`:""}<div class="cf122-rec"><strong>Recomendación CreditFlow</strong><span>${escapeHtml(r.text)}</span></div></article>`}).join("");
  container.innerHTML=`<section class="cf122-wrap"><div class="cf122-head"><div><div class="cf7-eyebrow">STRATEGY INTELLIGENCE v12.7</div><h3>Decisiones automáticas antes de las cartas</h3><p>Separa inconsistencias factuales, cuentas sin base automática y hallazgos regulatorios. No crea disputas falsas.</p></div><div class="cf122-badge">${ready} acción(es) con señal · ${review} revisión · ${neutral} sin disputa automática</div></div><div class="cf122-grid">${rows||`<div class="empty">No hay cuentas activas.</div>`}</div></section>`;
 }catch(e){container.innerHTML=`<div class="cf122-wrap"><strong>No se pudo cargar Strategy Intelligence.</strong><p>${escapeHtml(e.message||String(e))}</p></div>`}
}
