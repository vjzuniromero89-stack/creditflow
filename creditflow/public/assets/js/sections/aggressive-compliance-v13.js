import { api } from "../api.js";
import { escapeHtml } from "../utils.js";
import { toast } from "../toast.js";

function style(){
 if(document.getElementById("cf131-style"))return;
 const s=document.createElement("style");s.id="cf131-style";
 s.textContent=`
 .cf13-shell{display:grid;gap:14px}.cf13-hero{padding:18px;border:1px solid rgba(255,155,55,.28);border-radius:16px;background:linear-gradient(135deg,rgba(255,145,45,.08),rgba(92,86,255,.07));display:flex;justify-content:space-between;gap:16px;align-items:center}
 .cf13-hero h3{margin:4px 0 6px;font-size:20px}.cf13-hero p{margin:0;color:var(--cf7-muted);font-size:12px;max-width:850px;line-height:1.55}.cf13-hero-actions{display:flex;gap:8px;flex-wrap:wrap}
 .cf13-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.cf13-kpi,.cf13-card{border:1px solid rgba(120,150,170,.18);background:rgba(8,23,34,.56);border-radius:13px;padding:13px}
 .cf13-kpi span{font-size:24px;font-weight:800;display:block;line-height:1.1;margin-bottom:5px}.cf13-kpi strong{display:block;font-size:12px}.cf13-kpi small{display:block;color:var(--cf7-muted);font-size:10px;margin-top:3px;line-height:1.3}
 .cf13-list{display:grid;gap:10px}.cf13-card.high{border-color:rgba(255,91,91,.32)}.cf13-card.actionable{border-color:rgba(78,200,135,.35)}.cf13-card.evidence_required{border-color:rgba(245,190,70,.35)}
 .cf13-top{display:flex;justify-content:space-between;gap:12px}.cf13-top small{display:block;color:var(--cf7-muted);margin-top:3px}.cf13-chip{font-size:10px;padding:5px 8px;border-radius:999px;border:1px solid rgba(120,150,170,.25);height:max-content}
 .cf13-body{display:grid;gap:8px;margin-top:10px}.cf13-body p{margin:0;font-size:11px;color:var(--cf7-muted);line-height:1.5}.cf13-label{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--cf7-muted)}
 .cf13-result{margin-top:10px;padding:10px 12px;border-radius:10px;background:rgba(100,130,160,.07)}.cf13-result.actionable{background:rgba(78,200,135,.08)}.cf13-result.evidence_required{background:rgba(245,190,70,.07)}
 .cf13-actions{display:flex;justify-content:flex-end;margin-top:10px}.cf13-note{font-size:11px;color:var(--cf7-muted);padding:10px 12px;border-left:3px solid rgba(255,155,55,.45)}
 @media(max-width:900px){.cf13-kpis{grid-template-columns:repeat(2,1fr)}}@media(max-width:650px){.cf13-hero{flex-direction:column;align-items:flex-start}.cf13-kpis{grid-template-columns:1fr}}
 `;document.head.appendChild(s);
}
const label=x=>x==="actionable"?"OPORTUNIDAD ACCIONABLE":x==="evidence_required"?"REQUIERE EVIDENCIA":x==="review"?"REVISIÓN":"PENDIENTE";

async function load(panel,clientId){
 panel.innerHTML=`<div class="cf13-shell"><div class="cf13-card">Cargando Aggressive Compliance Engine…</div></div>`;
 try{
  const data=await api.get(`/aggressive-compliance/client/${clientId}`);
  const f=data.findings||[];
  const actionable=f.filter(x=>x.actionability==="actionable").length;
  const evidence=f.filter(x=>x.actionability==="evidence_required").length;
  const adopted=f.filter(x=>x.status==="adopted").length;
  const investigated=f.filter(x=>x.investigation_status==="completed").length;
  panel.innerHTML=`<div class="cf13-shell">
   <section class="cf13-hero">
    <div><div class="cf7-eyebrow">AGGRESSIVE COMPLIANCE ENGINE · v13.1</div><h3>Investigación automática separada</h3>
    <p>Busca oportunidades adicionales sin modificar Auditoría, Estrategia, Cartas ni Envíos. Primero detecta señales; después las investiga con los datos ya disponibles en CreditFlow.</p></div>
    <div class="cf13-hero-actions">
      <button class="btn btn-ghost" id="cf13-run">${data.run?"Reanalizar señales":"Analizar expediente"}</button>
      ${data.run?`<button class="btn btn-primary" id="cf131-investigate">Investigar automáticamente</button>`:""}
    </div>
   </section>
   <div class="cf13-note">Una oportunidad “accionable” significa que CreditFlow encontró una base concreta que merece seguimiento. “Requiere evidencia” significa que faltan documentos o una fuente oficial antes de usarla.</div>
   <section class="cf13-kpis">
    <div class="cf13-kpi"><span>${f.length}</span><strong>Hallazgos</strong><small>señales detectadas</small></div>
    <div class="cf13-kpi"><span>${investigated}</span><strong>Investigados</strong><small>analizados automáticamente</small></div>
    <div class="cf13-kpi"><span>${actionable}</span><strong>Accionables</strong><small>pueden continuar a estrategia</small></div>
    <div class="cf13-kpi"><span>${evidence}</span><strong>Requieren evidencia</strong><small>faltan documentos o fuente oficial</small></div>
   </section>
   <div class="cf13-list">${f.length?f.map(x=>`<article class="cf13-card ${escapeHtml(x.severity)} ${escapeHtml(x.actionability||"")}">
     <div class="cf13-top"><div><strong>${escapeHtml(x.title)}</strong><small>${escapeHtml(x.creditor_name||"Expediente")} ${x.account_number?`· ${escapeHtml(x.account_number)}`:""} ${x.bureau?`· ${escapeHtml(x.bureau)}`:""}</small></div><span class="cf13-chip">${escapeHtml(label(x.actionability||"pending"))}</span></div>
     <div class="cf13-body">
      <div><div class="cf13-label">Señal detectada</div><p>${escapeHtml(x.detail)}</p></div>
      ${x.legal_basis?`<div><div class="cf13-label">Área de compliance</div><p>${escapeHtml(x.legal_basis)}</p></div>`:""}
      ${x.investigation_result?`<div class="cf13-result ${escapeHtml(x.actionability||"")}"><div class="cf13-label">Resultado de la investigación automática</div><p>${escapeHtml(x.investigation_result)}</p></div>`:""}
      ${x.evidence_needed?`<div><div class="cf13-label">Evidencia necesaria</div><p>${escapeHtml(x.evidence_needed)}</p></div>`:""}
     </div>
     <div class="cf13-actions">
       ${x.actionability==="actionable"
         ?`<button class="btn ${x.status==="adopted"?"btn-ghost":"btn-primary"} btn-sm" data-adopt="${x.id}" ${x.status==="adopted"?"disabled":""}>${x.status==="adopted"?"Estrategia seleccionada":"Usar esta estrategia"}</button>`
         :`<button class="btn btn-ghost btn-sm" disabled>${x.actionability==="evidence_required"?"Esperando evidencia":"Sin acción automática"}</button>`}
     </div>
   </article>`).join(""):`<div class="cf13-card"><strong>Aún no hay análisis.</strong><p>Presiona “Analizar expediente”.</p></div>`}</div>
  </div>`;

  panel.querySelector("#cf13-run")?.addEventListener("click",async e=>{
    const b=e.currentTarget;b.disabled=true;b.textContent="Analizando señales…";
    try{const r=await api.post(`/aggressive-compliance/client/${clientId}/analyze`);toast(`${r.findings_count} hallazgo(s) encontrados`,"success");await load(panel,clientId)}
    catch(err){toast(err.message||"No se pudo analizar","error");b.disabled=false}
  });
  panel.querySelector("#cf131-investigate")?.addEventListener("click",async e=>{
    const b=e.currentTarget;b.disabled=true;b.textContent="Investigando hallazgos…";
    try{
      const r=await api.post(`/aggressive-compliance/client/${clientId}/investigate`);
      toast(`${r.actionable} accionable(s), ${r.evidence_required} requieren evidencia`,"success");
      await load(panel,clientId);
    }catch(err){toast(err.message||"No se pudo investigar","error");b.disabled=false}
  });
  panel.querySelectorAll("[data-adopt]").forEach(b=>b.onclick=async()=>{
    try{await api.post(`/aggressive-compliance/client/${clientId}/findings/${b.dataset.adopt}/adopt`);toast("Estrategia seleccionada dentro de Aggressive Compliance","success");await load(panel,clientId)}
    catch(err){toast(err.message||"No se pudo seleccionar","error")}
  });
 }catch(e){panel.innerHTML=`<div class="cf13-card"><strong>No se pudo cargar Aggressive Compliance Engine.</strong><p>${escapeHtml(e.message||String(e))}</p></div>`}
}
export async function installAggressiveComplianceTab(container,clientId){
 style();
 const nav=container.querySelector(".cf7-client-tabs"),panels=container.querySelector(".cf7-client-panels");
 if(!nav||!panels||nav.querySelector('[data-tab="aggressive"]'))return;
 const btn=document.createElement("button");btn.dataset.tab="aggressive";btn.textContent="Aggressive Compliance";nav.appendChild(btn);
 const panel=document.createElement("section");panel.className="cf7-client-panel";panel.dataset.panel="aggressive";panel.setAttribute("aria-label","Aggressive Compliance Engine");panels.appendChild(panel);
 btn.addEventListener("click",async()=>{
   nav.querySelectorAll("button").forEach(x=>x.classList.remove("active"));btn.classList.add("active");
   panels.querySelectorAll(".cf7-client-panel").forEach(p=>p.classList.toggle("active",p===panel));await load(panel,clientId);
 });
}
