import { api } from "../api.js";
import { toast } from "../toast.js";
import { openModal } from "../modal.js";
import { escapeHtml } from "../utils.js";

const ACCURACY=[
 ["inaccurate","Información incorrecta"],
 ["incomplete","Información incompleta"],
 ["not_mine","No pertenece al cliente"],
 ["post_payment_mismatch","Saldo/estatus incorrecto después de pago"],
 ["accurate_negative","Correcto / no disputar"],
 ["unauthorized_inquiry","Inquiry no reconocida/no autorizada"],
 ["identity_theft","Posible identity theft — requiere confirmación"],
 ["duplicate","Duplicado"],
 ["obsolete","Posiblemente obsoleto"],
];
const ISSUES=[
 ["unknown","Sin clasificar"],["balance_mismatch","Balance incorrecto"],
 ["status_mismatch","Estatus incorrecto"],["payment_history","Historial de pagos incorrecto"],
 ["date_mismatch","Fechas incorrectas"],["ownership_liability","Ownership / liability"],
 ["duplicate_reporting","Reporte duplicado"],["mixed_file","Mixed file"],
 ["prior_verified","Previamente verificado"],["new_evidence","Nueva evidencia"],
 ["furnisher_data_mismatch","Discrepancia con furnisher"],["other","Otro"],
];
const EVIDENCE=[
 ["none","Sin evidencia"],["consumer_statement","Declaración del cliente"],
 ["report_comparison","Contradicción entre reportes"],["statement","Estado de cuenta"],
 ["payment_proof","Comprobante de pago"],["settlement","Settlement / acuerdo"],
 ["identity_theft_report","Identity Theft Report"],["other_document","Otro documento"],
];

function money(v){
 const n=Number(String(v??"").replace(/[^0-9.-]/g,""));
 return Number.isFinite(n)?new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(n):String(v||"—");
}
function maskAccount(v){
 const s=String(v||"").trim(); if(!s)return "—";
 if(s.length<=4)return "••••"+s;
 return "•••• "+s.slice(-4);
}
function label(list,v){return list.find(x=>x[0]===v)?.[1]||String(v||"—")}
function reviewed(item){return !!item.assessment?.human_verified}

function assessmentModal(item,onSaved){
 const a=item.assessment||{};
 const {close,body}=openModal({
  title:`Auditar — ${item.creditor_name||"Ítem"}`,wide:true,
  bodyHtml:`<form id="cf117-form" class="cf117-form">
   <div class="cf117-modal-summary">
    <div><span>Acreedor</span><strong>${escapeHtml(item.creditor_name||"—")}</strong></div>
    <div><span>Cuenta</span><strong>${escapeHtml(maskAccount(item.account_number))}</strong></div>
    <div><span>Buró(s)</span><strong>${escapeHtml(item.bureaus||"—")}</strong></div>
    <div><span>Balance</span><strong>${escapeHtml(money(item.balance))}</strong></div>
    <div><span>Categoría</span><strong>${escapeHtml(item.category||"—")}</strong></div>
    <div><span>Estado reportado</span><strong>${escapeHtml(item.status_raw||item.status||"—")}</strong></div>
   </div>
   <div class="form-grid">
    <div class="field"><label>Conclusión de la auditoría *</label><select name="accuracy_status" required>
      <option value="">Seleccionar…</option>${ACCURACY.map(([v,l])=>`<option value="${v}" ${a.accuracy_status===v?"selected":""}>${l}</option>`).join("")}
    </select></div>
    <div class="field"><label>Problema específico</label><select name="issue_type">${ISSUES.map(([v,l])=>`<option value="${v}" ${a.issue_type===v?"selected":""}>${l}</option>`).join("")}</select></div>
    <div class="field"><label>Evidencia disponible</label><select name="evidence_status">${EVIDENCE.map(([v,l])=>`<option value="${v}" ${a.evidence_status===v?"selected":""}>${l}</option>`).join("")}</select></div>
    <div class="field"><label>Confianza</label><select name="confidence">
      ${[50,60,70,80,90,100].map(v=>`<option value="${v}" ${Number(a.confidence||80)===v?"selected":""}>${v}%</option>`).join("")}
    </select></div>
    <div class="field" style="grid-column:1/-1"><label>¿Qué está incorrecto o qué confirmó el cliente? *</label>
      <textarea name="dispute_basis" rows="4" placeholder="Describe hechos concretos. Si la cuenta es correcta, indica que fue revisada y confirmada.">${escapeHtml(a.dispute_basis||item.notes||"")}</textarea></div>
    <div class="field" style="grid-column:1/-1"><label>Evidencia / notas internas</label>
      <textarea name="evidence_notes" rows="3" placeholder="Documento, statement, comprobante, comparación, conversación con el cliente…">${escapeHtml(a.evidence_notes||"")}</textarea></div>
    <div class="field" style="grid-column:1/-1"><label>Resolución esperada</label>
      <input name="desired_resolution" value="${escapeHtml(a.desired_resolution||"")}" placeholder="Ej. corregir balance / eliminar cuenta ajena / no disputar" /></div>
   </div>
   <div class="cf117-confirmations">
    <label><input type="checkbox" name="consumer_confirmed" ${a.consumer_confirmed?"checked":""}> El cliente confirmó estos hechos.</label>
    <label class="cf117-danger"><input type="checkbox" name="identity_theft_confirmed" ${a.identity_theft_confirmed?"checked":""}> Identity theft REAL confirmado y documentado.</label>
   </div>
   <div class="form-actions"><button type="button" class="btn btn-ghost" data-close>Cancelar</button><button class="btn btn-primary" type="submit">Guardar auditoría</button></div>
  </form>`
 });
 body.querySelector("[data-close]").onclick=close;
 body.querySelector("#cf117-form").onsubmit=async e=>{
  e.preventDefault(); const fd=new FormData(e.currentTarget),p=Object.fromEntries(fd.entries());
  if(!p.accuracy_status)return toast("Selecciona una conclusión.","error");
  const factual=String(p.dispute_basis||"").trim();
  if(!factual)return toast("Escribe una nota factual de la revisión.","error");
  p.consumer_confirmed=fd.get("consumer_confirmed")==="on";
  p.identity_theft_confirmed=fd.get("identity_theft_confirmed")==="on";
  p.human_verified=true; p.confidence=Number(p.confidence||80);
  if(p.accuracy_status==="identity_theft"&&!p.identity_theft_confirmed)
    return toast("No confirmes identity theft sin documentación real. Puedes guardar otro diagnóstico mientras se investiga.","error");
  try{
   await api.put(`/strategy/client/${item.client_id}/items/${item.id}/assessment`,p);
   close(); toast("Ítem auditado","success"); await onSaved();
  }catch(err){toast(err.message,"error")}
 };
}

export async function renderRealAuditV117(container,clientId,{onComplete}={}){
 container.innerHTML=`<div class="card">Cargando auditoría real…</div>`;
 let state;
 try{state=await api.get(`/strategy/client/${clientId}`)}catch(e){container.innerHTML=`<div class="auth-error">${escapeHtml(e.message)}</div>`;return}
 const items=(state.items||[]).filter(x=>x.removed_status!=="eliminado");
 const done=items.filter(reviewed).length,total=items.length,pct=total?Math.round(done/total*100):0;
 container.innerHTML=`<section class="cf117-audit">
  <header class="cf117-head"><div><div class="cf7-eyebrow">ETAPA 3 · AUDITORÍA</div><h3>Auditoría del reporte</h3><p>Revisa cada ítem antes de permitir que CreditFlow construya una estrategia.</p></div><div class="cf117-progress"><strong>${done} / ${total}</strong><span>auditados</span></div></header>
  <div class="cf117-progressbar"><i style="width:${pct}%"></i></div>
  <div class="cf117-notice"><strong>No se disputará todo automáticamente.</strong><span>Cada decisión debe tener una base factual. Las cuentas correctas se marcan “Correcto / no disputar”.</span></div>
  <div class="cf117-list">
   ${items.map((item,i)=>`<article class="cf117-item ${reviewed(item)?"is-done":""}">
    <div class="cf117-index">${reviewed(item)?"✓":i+1}</div>
    <div class="cf117-main"><div class="cf117-name"><strong>${escapeHtml(item.creditor_name||"Ítem sin nombre")}</strong><span>${escapeHtml(maskAccount(item.account_number))} · ${escapeHtml(item.bureaus||"Buró no indicado")}</span></div>
     <div class="cf117-meta"><span><small>Categoría</small><b>${escapeHtml(item.category||"—")}</b></span><span><small>Balance</small><b>${escapeHtml(money(item.balance))}</b></span><span><small>Estado</small><b>${escapeHtml(item.status_raw||item.status||"—")}</b></span></div>
     ${reviewed(item)?`<div class="cf117-result"><b>${escapeHtml(label(ACCURACY,item.assessment.accuracy_status))}</b><span>${escapeHtml(item.assessment.dispute_basis||"Revisado")}</span></div>`:""}
    </div>
    <button class="btn ${reviewed(item)?"btn-ghost":"btn-primary"} btn-sm" data-audit="${item.id}">${reviewed(item)?"Editar":"Auditar"}</button>
   </article>`).join("")||`<div class="empty">No hay ítems activos para auditar.</div>`}
  </div>
  <footer class="cf117-footer"><div><strong>${done===total&&total>0?"Auditoría completa":"Auditoría pendiente"}</strong><span>${done===total&&total>0?"Todos los ítems tienen diagnóstico humano.":"Debes revisar todos los ítems antes de avanzar."}</span></div>
   <button id="cf117-complete" class="btn btn-primary" ${done===total&&total>0?"":"disabled"}>Completar auditoría y continuar</button>
  </footer>
 </section>`;
 container.querySelectorAll("[data-audit]").forEach(b=>b.onclick=()=>{
  const item=items.find(x=>String(x.id)===String(b.dataset.audit));
  assessmentModal(item,()=>renderRealAuditV117(container,clientId,{onComplete}));
 });
 container.querySelector("#cf117-complete")?.addEventListener("click",async e=>{
  e.currentTarget.disabled=true;e.currentTarget.textContent="Validando…";
  try{
   await api.post(`/repair-cases/${clientId}/action`,{action:"complete_report_audit"});
   toast("Auditoría completada. Ahora sí podemos preparar la estrategia.","success");
   if(onComplete)await onComplete(); else location.reload();
  }catch(err){toast(err.message,"error");e.currentTarget.disabled=false;e.currentTarget.textContent="Completar auditoría y continuar"}
 });
}
