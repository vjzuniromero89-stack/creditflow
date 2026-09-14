import { api } from "../api.js";
import { escapeHtml } from "../utils.js";
import { toast } from "../toast.js";

function style(){
 if(document.getElementById("cf13-style"))return;
 const s=document.createElement("style");s.id="cf13-style";
 s.textContent=`
 .cf13-shell{display:grid;gap:14px}.cf13-hero{padding:18px;border:1px solid rgba(255,155,55,.28);border-radius:16px;background:linear-gradient(135deg,rgba(255,145,45,.08),rgba(92,86,255,.07));display:flex;justify-content:space-between;gap:16px;align-items:center}
 .cf13-hero h3{margin:4px 0 6px;font-size:20px}.cf13-hero p{margin:0;color:var(--cf7-muted);font-size:12px;max-width:850px;line-height:1.55}.cf13-kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
 .cf13-kpi,.cf13-card{border:1px solid rgba(120,150,170,.18);background:rgba(8,23,34,.56);border-radius:13px;padding:13px}.cf13-kpi span{font-size:24px;font-weight:800;display:block}.cf13-kpi small{color:var(--cf7-muted)}
 .cf13-list{display:grid;gap:10px}.cf13-card.high{border-color:rgba(255,91,91,.32)}.cf13-top{display:flex;justify-content:space-between;gap:12px}.cf13-top small{display:block;color:var(--cf7-muted);margin-top:3px}.cf13-chip{font-size:10px;padding:5px 8px;border-radius:999px;border:1px solid rgba(120,150,170,.25);height:max-content}
 .cf13-card.high .cf13-chip{border-color:rgba(255,91,91,.4)}.cf13-body{display:grid;gap:8px;margin-top:10px}.cf13-body p{margin:0;font-size:11px;color:var(--cf7-muted);line-height:1.5}.cf13-label{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--cf7-muted)}
 .cf13-actions{display:flex;justify-content:flex-end;margin-top:10px}.cf13-note{font-size:11px;color:var(--cf7-muted);padding:10px 12px;border-left:3px solid rgba(255,155,55,.45)}
 @media(max-width:800px){.cf13-hero{flex-direction:column;align-items:flex-start}.cf13-kpis{grid-template-columns:1fr}}
 `;document.head.appendChild(s);
}
async function load(panel,clientId){
 panel.innerHTML=`<div class="cf13-shell"><div class="cf13-card">Cargando Aggressive Compliance Engine…</div></div>`;
 try{
  const data=await api.get(`/aggressive-compliance/client/${clientId}`);
  const findings=data.findings||[],high=findings.filter(x=>x.severity==="high").length,adopted=findings.filter(x=>x.status==="adopted").length;
  panel.innerHTML=`<div class="cf13-shell">
   <section class="cf13-hero">
    <div><div class="cf7-eyebrow">AGGRESSIVE COMPLIANCE ENGINE · SEPARADO</div><h3>Buscar oportunidades adicionales sin alterar la estrategia actual</h3>
    <p>Este módulo analiza reporting, antigüedad, duplicados, reinserciones, documentación, collector compliance y plazos. No modifica Auditoría, Estrategia, Cartas ni Envíos hasta que tú adoptes un hallazgo.</p></div>
    <button class="btn btn-primary" id="cf13-run">${data.run?"Volver a analizar":"Analizar expediente"}</button>
   </section>
   <div class="cf13-note">“Adoptar hallazgo” solo lo marca para seguimiento dentro de este módulo. En v13.0 todavía no crea cartas ni modifica Strategy Engine.</div>
   <section class="cf13-kpis">
    <div class="cf13-kpi"><span>${findings.length}</span><strong>Hallazgos</strong><small>oportunidades investigadas</small></div>
    <div class="cf13-kpi"><span>${high}</span><strong>Prioritarios</strong><small>requieren revisión primero</small></div>
    <div class="cf13-kpi"><span>${adopted}</span><strong>Adoptados</strong><small>seleccionados para continuar</small></div>
   </section>
   <div class="cf13-list">${findings.length?findings.map(f=>`<article class="cf13-card ${escapeHtml(f.severity)}">
     <div class="cf13-top"><div><strong>${escapeHtml(f.title)}</strong><small>${escapeHtml(f.creditor_name||"Expediente")} ${f.account_number?`· ${escapeHtml(f.account_number)}`:""} ${f.bureau?`· ${escapeHtml(f.bureau)}`:""}</small></div><span class="cf13-chip">${escapeHtml(f.severity==="high"?"PRIORITARIO":"REVISAR")}</span></div>
     <div class="cf13-body">
      <div><div class="cf13-label">Qué encontró</div><p>${escapeHtml(f.detail)}</p></div>
      ${f.legal_basis?`<div><div class="cf13-label">Área de compliance</div><p>${escapeHtml(f.legal_basis)}</p></div>`:""}
      ${f.recommended_action?`<div><div class="cf13-label">Siguiente investigación</div><p>${escapeHtml(f.recommended_action)}</p></div>`:""}
      ${f.evidence_needed?`<div><div class="cf13-label">Evidencia necesaria</div><p>${escapeHtml(f.evidence_needed)}</p></div>`:""}
     </div>
     <div class="cf13-actions"><button class="btn ${f.status==="adopted"?"btn-ghost":"btn-primary"} btn-sm" data-adopt="${f.id}" ${f.status==="adopted"?"disabled":""}>${f.status==="adopted"?"Hallazgo adoptado":"Adoptar hallazgo"}</button></div>
   </article>`).join(""):`<div class="cf13-card"><strong>Aún no hay análisis.</strong><p>Presiona “Analizar expediente”.</p></div>`}</div>
  </div>`;
  panel.querySelector("#cf13-run").onclick=async e=>{
    const b=e.currentTarget;b.disabled=true;b.textContent="Analizando…";
    try{const r=await api.post(`/aggressive-compliance/client/${clientId}/analyze`);toast(`${r.findings_count} hallazgo(s) encontrados`,"success");await load(panel,clientId)}
    catch(err){toast(err.message||"No se pudo analizar","error");b.disabled=false}
  };
  panel.querySelectorAll("[data-adopt]").forEach(b=>b.onclick=async()=>{
    try{await api.post(`/aggressive-compliance/client/${clientId}/findings/${b.dataset.adopt}/adopt`);toast("Hallazgo adoptado dentro de Aggressive Compliance","success");await load(panel,clientId)}
    catch(err){toast(err.message||"No se pudo adoptar","error")}
  });
 }catch(e){panel.innerHTML=`<div class="cf13-card"><strong>No se pudo cargar Aggressive Compliance Engine.</strong><p>${escapeHtml(e.message||String(e))}</p></div>`}
}
export async function installAggressiveComplianceTab(container,clientId){
 style();
 const nav=container.querySelector(".cf7-client-tabs");
 const panels=container.querySelector(".cf7-client-panels");
 if(!nav||!panels||nav.querySelector('[data-tab="aggressive"]'))return;
 const btn=document.createElement("button");btn.dataset.tab="aggressive";btn.textContent="Aggressive Compliance";
 nav.appendChild(btn);
 const panel=document.createElement("section");panel.className="cf7-client-panel";panel.dataset.panel="aggressive";panel.setAttribute("aria-label","Aggressive Compliance Engine");
 panels.appendChild(panel);
 btn.addEventListener("click",async()=>{
   nav.querySelectorAll("button").forEach(x=>x.classList.remove("active"));btn.classList.add("active");
   panels.querySelectorAll(".cf7-client-panel").forEach(p=>p.classList.toggle("active",p===panel));
   await load(panel,clientId);
 });
}
