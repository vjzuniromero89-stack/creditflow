import { api } from "../api.js";
import { icon } from "../icons.js";
import { toast } from "../toast.js";
import { openModal } from "../modal.js";
import { escapeHtml } from "../utils.js";

const ACCURACY = [
  ["unknown","Sin diagnosticar"],
  ["inaccurate","Dato incorrecto"],
  ["incomplete","Información incompleta"],
  ["not_mine","No pertenece al cliente"],
  ["duplicate","Duplicado"],
  ["obsolete","Posiblemente obsoleto"],
  ["unauthorized_inquiry","Inquiry no autorizada"],
  ["post_payment_mismatch","Saldo/estatus incorrecto después de pago"],
  ["accurate_negative","Negativo correcto — no disputar"],
  ["identity_theft","Identity theft real"],
];

const ISSUES = [
  ["unknown","Sin clasificar"],
  ["balance_mismatch","Balance incorrecto"],
  ["status_mismatch","Estatus incorrecto"],
  ["payment_history","Historial de pagos incorrecto"],
  ["date_mismatch","Fechas incorrectas"],
  ["ownership_liability","Ownership / liability"],
  ["duplicate_reporting","Reporte duplicado"],
  ["mixed_file","Mixed file"],
  ["prior_verified","Previamente verificado"],
  ["new_evidence","Nueva evidencia"],
  ["furnisher_data_mismatch","Discrepancia con furnisher"],
  ["other","Otro"],
];

const EVIDENCE = [
  ["none","Sin evidencia adjunta"],
  ["consumer_statement","Declaración del cliente"],
  ["report_comparison","Contradicción entre reportes"],
  ["statement","Statement / estado de cuenta"],
  ["payment_proof","Comprobante de pago"],
  ["settlement","Settlement / acuerdo"],
  ["identity_theft_report","Identity Theft Report"],
  ["other_document","Otro documento"],
];

function statusLabel(a){
  if(!a)return `<span class="cf9-status unreviewed">Sin diagnosticar</span>`;
  if(!a.human_verified)return `<span class="cf9-status review">Revisión pendiente</span>`;
  if(a.accuracy_status==="accurate_negative")return `<span class="cf9-status neutral">Correcto / no disputar</span>`;
  if(a.accuracy_status==="identity_theft")return `<span class="cf9-status danger">Identity theft</span>`;
  return `<span class="cf9-status ready">Diagnóstico confirmado</span>`;
}

function actionLabel(a){
  const m={
    cra_factual_dispute:"Disputa factual CRA",
    collector_validation_review:"Revisión / validación collector",
    direct_furnisher:"Direct furnisher dispute",
    unauthorized_inquiry:"Inquiry no autorizada",
    identity_theft_block:"Identity Theft Block",
    reinvestigation_new_evidence:"Reinvestigación con nueva evidencia",
    procedure_request:"Procedure Description Request",
    reinsertion:"Reinsertion Challenge",
    goodwill:"Goodwill",
    post_payment_correction:"Corrección post-pago",
    assessment_required:"Diagnóstico requerido",
    no_dispute:"No disputar",
    consumer_confirmation:"Confirmación del consumidor",
    identity_theft_review:"Revisión Identity Theft",
  };
  return m[a]||a?.replaceAll("_"," ")||"";
}

function openAssessment({item,onSaved}){
  const a=item.assessment||{};
  const {close,body}=openModal({
    title:`Diagnóstico — ${item.creditor_name||"ítem"}`,
    wide:true,
    bodyHtml:`
      <form id="cf9-assessment-form">
        <div class="cf9-assessment-head">
          <div><span>Cuenta</span><strong>${escapeHtml(item.account_number||"—")}</strong></div>
          <div><span>Burós</span><strong>${escapeHtml(item.bureaus||"—")}</strong></div>
          <div><span>Saldo</span><strong>${escapeHtml(item.balance||"—")}</strong></div>
          <div><span>Categoría</span><strong>${escapeHtml(item.category||"—")}</strong></div>
        </div>
        <div class="form-grid">
          <div class="field">
            <label>Conclusión sobre exactitud *</label>
            <select name="accuracy_status" required>
              ${ACCURACY.map(([v,l])=>`<option value="${v}" ${a.accuracy_status===v?"selected":""}>${l}</option>`).join("")}
            </select>
          </div>
          <div class="field">
            <label>Tipo de problema</label>
            <select name="issue_type">
              ${ISSUES.map(([v,l])=>`<option value="${v}" ${a.issue_type===v?"selected":""}>${l}</option>`).join("")}
            </select>
          </div>
          <div class="field">
            <label>Evidencia disponible</label>
            <select name="evidence_status">
              ${EVIDENCE.map(([v,l])=>`<option value="${v}" ${a.evidence_status===v?"selected":""}>${l}</option>`).join("")}
            </select>
          </div>
          <div class="field">
            <label>Confianza del diagnóstico (0–100)</label>
            <input type="number" min="0" max="100" name="confidence" value="${Number(a.confidence||0)}" />
          </div>
          <div class="field" style="grid-column:1/-1">
            <label>Base factual específica *</label>
            <textarea name="dispute_basis" style="min-height:100px" placeholder="Ej. Experian reporta balance $4,812, pero statement del 08/15/2026 muestra $0.">${escapeHtml(a.dispute_basis||item.notes||"")}</textarea>
          </div>
          <div class="field" style="grid-column:1/-1">
            <label>Evidencia / notas</label>
            <textarea name="evidence_notes" style="min-height:80px" placeholder="Qué documento respalda el diagnóstico y dónde está.">${escapeHtml(a.evidence_notes||"")}</textarea>
          </div>
          <div class="field" style="grid-column:1/-1">
            <label>Resolución solicitada</label>
            <input name="desired_resolution" value="${escapeHtml(a.desired_resolution||"")}" placeholder="Ej. corregir balance a $0 / eliminar cuenta que no pertenece al cliente" />
          </div>
        </div>
        <div class="cf9-confirmations">
          <label><input type="checkbox" name="consumer_confirmed" ${a.consumer_confirmed?"checked":""}/> El cliente confirmó los hechos anteriores.</label>
          <label><input type="checkbox" name="human_verified" ${a.human_verified?"checked":""}/> Revisé este diagnóstico y autorizo que CreditFlow lo use para la estrategia.</label>
          <label class="cf9-identity-warning"><input type="checkbox" name="identity_theft_confirmed" ${a.identity_theft_confirmed?"checked":""}/> Identity theft REAL confirmado y documentado. No marcar para una deuda simplemente disputada.</label>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" data-close>Cancelar</button>
          <button type="submit" class="btn btn-primary">${icon("check")} Guardar diagnóstico</button>
        </div>
      </form>
    `
  });
  body.querySelector("[data-close]").addEventListener("click",close);
  body.querySelector("#cf9-assessment-form").addEventListener("submit",async(e)=>{
    e.preventDefault();
    const fd=new FormData(e.target);
    const payload=Object.fromEntries(fd.entries());
    payload.consumer_confirmed=fd.get("consumer_confirmed")==="on";
    payload.human_verified=fd.get("human_verified")==="on";
    payload.identity_theft_confirmed=fd.get("identity_theft_confirmed")==="on";
    payload.confidence=Number(fd.get("confidence")||0);
    if(payload.human_verified && !String(payload.dispute_basis||"").trim() && !["accurate_negative","identity_theft"].includes(payload.accuracy_status)){
      return toast("Escribe la base factual antes de confirmar el diagnóstico.","error");
    }
    try{
      await api.put(`/strategy/client/${item.client_id}/items/${item.id}/assessment`,payload);
      toast("Diagnóstico guardado","success");
      close();
      await onSaved();
    }catch(err){toast(err.message,"error")}
  });
}

export async function renderProfessionalStrategyV9(container,clientId){
  container.innerHTML=`<div class="card">Cargando motor profesional…</div>`;
  const state=await api.get(`/strategy/client/${clientId}`);
  const s=state.summary||{};

  container.innerHTML=`
    <section class="cf9-strategy-hero">
      <div>
        <div class="cf7-eyebrow">Professional Dispute Engine</div>
        <h2>Estrategia basada en hechos, no en rondas automáticas</h2>
        <p>Diagnostica cada negativo. CreditFlow utiliza ese diagnóstico para decidir CRA, collector, furnisher, goodwill, identity theft, nueva evidencia, procedure request o reinsertion.</p>
      </div>
      <div class="cf9-strategy-actions">
        <button class="btn btn-ghost" id="cf9-install-library">${icon("file")} Instalar biblioteca profesional</button>
        <button class="btn btn-primary" id="cf9-build-plan">${icon("spark")} Construir estrategia</button>
      </div>
    </section>

    <div class="cf9-kpis">
      <div><span>${s.items||0}</span><strong>Negativos</strong><small>en expediente</small></div>
      <div><span>${s.assessed||0}</span><strong>Diagnosticados</strong><small>revisión humana</small></div>
      <div><span>${s.planned||0}</span><strong>Acciones listas</strong><small>planificadas</small></div>
      <div><span>${s.blocked||0}</span><strong>Bloqueadas</strong><small>falta información</small></div>
      <div><span>${s.generated||0}</span><strong>Borradores</strong><small>creados por estrategia</small></div>
    </div>

    ${s.planned ? `<div class="cf9-generate-bar"><div><strong>${s.planned} acción(es) listas para carta</strong><span>Se crearán como borrador. Nada se envía sin aprobación.</span></div><button class="btn btn-primary" id="cf9-generate-drafts">Generar borradores</button></div>`:""}

    <div class="cf9-item-list">
      ${(state.items||[]).map(item=>{
        const actions=item.actions||[];
        return `
          <article class="cf9-item-card">
            <div class="cf9-item-main">
              <div class="cf9-item-name">
                <strong>${escapeHtml(item.creditor_name||"Ítem sin nombre")}</strong>
                <span>${escapeHtml(item.account_number||"Sin cuenta")} · ${escapeHtml(item.bureaus||"Buró no indicado")} · ${escapeHtml(item.category||"")}</span>
              </div>
              ${statusLabel(item.assessment)}
              <button class="btn btn-ghost btn-sm" data-assess="${item.id}">${icon("edit")} Diagnosticar</button>
            </div>
            ${item.assessment ? `
              <div class="cf9-diagnosis">
                <div><span>Exactitud</span><strong>${escapeHtml((item.assessment.accuracy_status||"").replaceAll("_"," "))}</strong></div>
                <div><span>Problema</span><strong>${escapeHtml((item.assessment.issue_type||"").replaceAll("_"," "))}</strong></div>
                <div><span>Evidencia</span><strong>${escapeHtml((item.assessment.evidence_status||"").replaceAll("_"," "))}</strong></div>
                <div><span>Confianza</span><strong>${Number(item.assessment.confidence||0)}%</strong></div>
                ${item.assessment.dispute_basis?`<p>${escapeHtml(item.assessment.dispute_basis)}</p>`:""}
              </div>`:""}
            ${actions.length ? `
              <div class="cf9-action-list">
                ${actions.map(a=>`
                  <div class="cf9-action-row status-${a.status}">
                    <div><span>${escapeHtml(a.target_type||"")}${a.bureau?` · ${escapeHtml(a.bureau)}`:""}</span><strong>${escapeHtml(actionLabel(a.action_type))}</strong><small>${escapeHtml(a.reason||"")}</small></div>
                    <div><b>${a.template_code?`PRO ${a.template_code}`:"Sin carta"}</b><em>${escapeHtml(a.status)}</em>${a.letter_id?`<a href="#/cartas/${a.letter_id}">Ver carta →</a>`:""}</div>
                  </div>`).join("")}
              </div>`:""}
          </article>`;
      }).join("") || `<div class="empty">No hay negativos para analizar.</div>`}
    </div>
  `;

  container.querySelectorAll("[data-assess]").forEach(btn=>btn.addEventListener("click",()=>{
    const item=state.items.find(x=>String(x.id)===String(btn.dataset.assess));
    openAssessment({item,onSaved:()=>renderProfessionalStrategyV9(container,clientId)});
  }));

  container.querySelector("#cf9-install-library")?.addEventListener("click",async(e)=>{
    const btn=e.currentTarget;btn.disabled=true;
    try{
      const r=await api.post("/pro-templates/install");
      toast(r.inserted?`${r.inserted} plantilla(s) instalada(s)`:"La biblioteca profesional ya está instalada","success");
    }catch(err){toast(err.message,"error")}
    finally{btn.disabled=false}
  });

  container.querySelector("#cf9-build-plan")?.addEventListener("click",async(e)=>{
    const btn=e.currentTarget;btn.disabled=true;btn.textContent="Analizando…";
    try{
      const r=await api.post(`/strategy/client/${clientId}/build`);
      toast(`${r.planned} acción(es) planificadas; ${r.blocked} requieren revisión`,"success");
      await renderProfessionalStrategyV9(container,clientId);
    }catch(err){toast(err.message,"error");btn.disabled=false}
  });

  container.querySelector("#cf9-generate-drafts")?.addEventListener("click",async(e)=>{
    const btn=e.currentTarget;btn.disabled=true;btn.textContent="Creando…";
    try{
      const r=await api.post(`/strategy/client/${clientId}/generate-drafts`);
      toast(`${r.created} borrador(es) creados${r.blocked?`; ${r.blocked} bloqueado(s)`:""}`,"success");
      await renderProfessionalStrategyV9(container,clientId);
    }catch(err){toast(err.message,"error");btn.disabled=false}
  });
}
