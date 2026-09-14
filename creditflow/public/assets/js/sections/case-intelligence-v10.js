import { api } from "../api.js";
import { toast } from "../toast.js";
import { openModal } from "../modal.js";
import { escapeHtml,formatDate } from "../utils.js";

const TYPES=[
 ["verified","Verified / permanece igual"],["corrected","Corregido"],["deleted","Eliminado"],
 ["needs_more_information","Solicitan más información"],["identity_theft_blocked","Bloqueado por identity theft"],
 ["no_response","Sin respuesta"],["other","Otra respuesta"]
];

function responseModal(clientId,state,onSaved){
 const {close,body}=openModal({title:"Registrar respuesta",wide:true,bodyHtml:`
 <form id="cf10-response-form">
  <div class="form-grid">
   <div class="field"><label>Carta relacionada</label><select name="letter_id"><option value="">Sin carta específica</option>${state.letters.map(l=>`<option value="${l.id}">${escapeHtml(l.title)}</option>`).join("")}</select></div>
   <div class="field"><label>Resultado *</label><select name="response_type" required>${TYPES.map(([v,l])=>`<option value="${v}">${l}</option>`).join("")}</select></div>
   <div class="field"><label>Respondió</label><select name="responder_type"><option value="cra">Credit bureau</option><option value="furnisher">Furnisher / creditor</option><option value="collector">Collector</option><option value="other">Otro</option></select></div>
   <div class="field"><label>Nombre</label><input name="responder_name" placeholder="Experian, Equifax, creditor..." /></div>
   <div class="field"><label>Fecha recibida</label><input type="date" name="received_at" /></div>
   <div class="field"><label>Outcome interno</label><select name="outcome"><option value="pending_review">Pendiente de revisar</option><option value="favorable">Favorable</option><option value="partial">Parcial</option><option value="unfavorable">No favorable</option></select></div>
   <div class="field" style="grid-column:1/-1"><label>Resumen de la respuesta</label><textarea name="summary" style="min-height:90px" placeholder="Resume exactamente lo que contestaron."></textarea></div>
   <div class="field" style="grid-column:1/-1"><label><input type="checkbox" name="new_evidence"/> La respuesta contiene o produjo nueva evidencia relevante</label><textarea name="evidence_notes" style="min-height:70px" placeholder="Describe la evidencia nueva."></textarea></div>
  </div>
  <div class="form-actions"><button type="button" class="btn btn-ghost" data-close>Cancelar</button><button class="btn btn-primary" type="submit">Guardar y analizar</button></div>
 </form>`});
 body.querySelector("[data-close]").onclick=close;
 const letterSelect=body.querySelector('[name="letter_id"]');
 body.querySelector("#cf10-response-form").onsubmit=async e=>{
  e.preventDefault();const fd=new FormData(e.target),payload=Object.fromEntries(fd.entries());
  payload.new_evidence=fd.get("new_evidence")==="on";
  const letter=state.letters.find(l=>String(l.id)===String(payload.letter_id));
  if(letter?.credit_item_id)payload.credit_item_id=letter.credit_item_id;
  try{await api.post(`/case-intelligence/${clientId}/responses`,payload);toast("Respuesta registrada y analizada","success");close();await onSaved()}catch(err){toast(err.message,"error")}
 };
}

export async function renderCaseIntelligenceV10(container,clientId){
 let state;try{state=await api.get(`/case-intelligence/${clientId}`)}catch(err){container.innerHTML=`<div class="card">${escapeHtml(err.message)}</div>`;return}
 const open=state.recommendations.filter(r=>r.status==="open");
 const reports=state.chronology.reports||[];
 container.innerHTML=`
 <section class="cf10-hero"><div><div class="cf7-eyebrow">Case Intelligence v10</div><h2>Resultados, respuestas y siguiente acción</h2><p>CreditFlow conserva el historial y evita avanzar por tiempo solamente. Cada respuesta o reporte nuevo produce una recomendación revisable.</p></div><button class="btn btn-primary" id="cf10-add-response">+ Registrar respuesta</button></section>
 <div class="cf10-kpis"><div><b>${open.length}</b><span>Acciones pendientes</span></div><div><b>${state.responses.length}</b><span>Respuestas</span></div><div><b>${reports.length}</b><span>Reportes importados</span></div><div><b>${reports.filter(r=>r.chronology_status==="historical").length}</b><span>Reportes históricos</span></div></div>
 <section class="cf10-section"><div class="cf10-title"><div><strong>Siguiente acción inteligente</strong><span>No se generan rounds repetitivos automáticamente.</span></div></div>
 ${open.length?`<div class="cf10-recs">${open.map(r=>`<article><div><em>${escapeHtml(r.recommendation_type.replaceAll("_"," "))}</em><strong>${escapeHtml(r.title)}</strong><p>${escapeHtml(r.reason||"")}</p>${r.creditor_name?`<small>${escapeHtml(r.creditor_name)} ${escapeHtml(r.account_number||"")}</small>`:""}</div><button class="btn btn-ghost btn-sm" data-resolve="${r.id}">Marcar revisado</button></article>`).join("")}</div>`:`<div class="empty">No hay recomendaciones pendientes.</div>`}
 </section>
 <section class="cf10-grid">
  <div class="cf10-section"><div class="cf10-title"><div><strong>Respuestas recibidas</strong><span>Historial de resultados.</span></div></div>
   ${state.responses.length?state.responses.map(r=>`<div class="cf10-row"><div><strong>${escapeHtml(TYPES.find(x=>x[0]===r.response_type)?.[1]||r.response_type)}</strong><span>${escapeHtml(r.responder_name||r.responder_type||"")} · ${formatDate(r.received_at||r.created_at)}</span><p>${escapeHtml(r.summary||"Sin resumen")}</p></div><em>${escapeHtml(r.outcome||"")}</em></div>`).join(""):`<div class="empty">Aún no hay respuestas registradas.</div>`}
  </div>
  <div class="cf10-section"><div class="cf10-title"><div><strong>Cronología de reportes</strong><span>Solo el más reciente gobierna el caso.</span></div></div>
   ${reports.length?reports.map(r=>`<div class="cf10-report ${r.is_authoritative?"current":""}"><div><strong>${escapeHtml(r.file_name||"Reporte")}</strong><span>${formatDate(r.report_date||r.created_at)}</span></div><b>${r.is_authoritative?"VIGENTE":r.chronology_status==="historical"?"HISTÓRICO":"ANTERIOR"}</b></div>`).join(""):`<div class="empty">No hay reportes registrados.</div>`}
  </div>
 </section>`;
 container.querySelector("#cf10-add-response").onclick=()=>responseModal(clientId,state,()=>renderCaseIntelligenceV10(container,clientId));
 container.querySelectorAll("[data-resolve]").forEach(b=>b.onclick=async()=>{try{await api.post(`/case-intelligence/${clientId}/recommendations/${b.dataset.resolve}/resolve`);await renderCaseIntelligenceV10(container,clientId)}catch(err){toast(err.message,"error")}});
}