import { api } from "../api.js";
import { icon } from "../icons.js";
import { toast } from "../toast.js";
import { escapeHtml, formatDateTime } from "../utils.js";
import { runSmartGenerateForClient } from "./collections.js";

const STAGES = [
  ["preflight", "Preflight"],
  ["identity_review", "Información personal"],
  ["report_audit", "Auditoría"],
  ["strategy_ready", "Estrategia"],
  ["approval_required", "Aprobación"],
  ["mailing_ready", "Envío"],
  ["provider_setup", "Certified Mail"],
  ["waiting_response", "Espera"],
  ["new_report_due", "Nuevo reporte"],
  ["results_review", "Resultados"],
  ["completed", "Completado"],
];

const STAGE_TEXT = {
  preflight: ["Completar expediente", "Reúne los documentos y datos mínimos antes de disputar."],
  identity_review: ["Revisar información personal", "Confirma nombres, direcciones y datos de identidad antes del primer round."],
  report_audit: ["Auditar reporte", "Revisa los negativos y documenta qué información es realmente incorrecta."],
  strategy_ready: ["Preparar estrategia", "CreditFlow puede generar los borradores apropiados para los ítems elegibles."],
  approval_required: ["Revisar y aprobar cartas", "Los borradores están listos. Revísalos antes de convertirlos en envíos."],
  mailing_ready: ["Aprobar lote de correo", "Las cartas aprobadas están en la cola de Certified Mail."],
  provider_setup: ["Conectar CertifiedMailLabels", "El lote está aprobado. Falta habilitar el conector real del proveedor."],
  waiting_response: ["Esperando respuesta", "No generes una segunda ronda hasta tener resultado o nueva evidencia."],
  new_report_due: ["Importar reporte actualizado", "Compara el nuevo reporte contra el anterior para detectar remociones."],
  results_review: ["Revisar resultados", "Confirma remociones, correcciones, reapariciones y próximos pasos."],
  completed: ["Caso completado", "El expediente está cerrado."],
};

function stageIndex(stage) {
  const i = STAGES.findIndex(([k]) => k === stage);
  return i < 0 ? 0 : i;
}

function primaryAction(stage) {
  return {
    identity_review: ["complete_identity_review", "Confirmar información personal"],
    report_audit: ["complete_report_audit", "Confirmar auditoría"],
    approval_required: ["approve_letters", "Aprobar cartas"],
    mailing_ready: ["approve_mailing", "Aprobar lote de Certified Mail"],
    waiting_response: ["new_report_due", "Solicitar nuevo reporte"],
    new_report_due: [null, "Importar reporte"],
    results_review: [null, "Revisar negativos"],
  }[stage] || [null, null];
}

async function sendAction(clientId, action, extra = {}) {
  return api.post(`/repair-cases/${clientId}/action`, { action, ...extra });
}

export async function renderRepairWorkflowV8(container, clientId, opts = {}) {
  container.innerHTML = `<div class="card">Cargando proceso de reparación…</div>`;
  const state = await api.get(`/repair-cases/${clientId}`);
  const repairCase = state.case;
  const pf = state.preflight;
  const provider = state.provider;

  if (!repairCase) {
    container.innerHTML = `
      <section class="cf8-start-card">
        <div class="cf8-start-icon">⚡</div>
        <div>
          <div class="cf7-eyebrow">CreditFlow Repair Engine</div>
          <h2>Este cliente todavía no ha iniciado reparación</h2>
          <p>Al iniciar, CreditFlow controlará requisitos, estrategia, cartas, aprobaciones, envíos, resultados y cobros desde un solo flujo.</p>
        </div>
        <div class="cf8-start-actions">
          <label>Modo inicial
            <select id="cf8-start-mode">
              <option value="assisted" selected>Asistido — recomendado</option>
              <option value="manual">Manual</option>
              <option value="automatic">Automático</option>
            </select>
          </label>
          <button class="btn btn-primary" id="cf8-start-repair">${icon("spark")} Empezar reparación</button>
        </div>
      </section>
    `;
    container.querySelector("#cf8-start-repair").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = "Iniciando…";
      try {
        await api.post(`/repair-cases/${clientId}/start`, {
          automation_mode: container.querySelector("#cf8-start-mode").value,
        });
        toast("Proceso de reparación iniciado", "success");
        await renderRepairWorkflowV8(container, clientId, opts);
        opts.onChanged?.();
      } catch (err) {
        toast(err.message, "error");
        btn.disabled = false;
        btn.innerHTML = `${icon("spark")} Empezar reparación`;
      }
    });
    return;
  }

  const idx = stageIndex(repairCase.current_stage);
  const [headline, description] = STAGE_TEXT[repairCase.current_stage] || ["Continuar caso", repairCase.next_action || ""];
  const [action, actionLabel] = primaryAction(repairCase.current_stage);
  const recentEvents = (state.events || []).slice(0, 5);

  container.innerHTML = `
    <section class="cf8-workflow">
      <div class="cf8-workflow-head">
        <div>
          <div class="cf7-eyebrow">Repair Engine · ${escapeHtml(repairCase.automation_mode)}</div>
          <h2>${escapeHtml(headline)}</h2>
          <p>${escapeHtml(description)}</p>
        </div>
        <div class="cf8-mode-box">
          <label>Automatización</label>
          <select id="cf8-mode">
            <option value="manual" ${repairCase.automation_mode==="manual"?"selected":""}>Manual</option>
            <option value="assisted" ${repairCase.automation_mode==="assisted"?"selected":""}>Asistido</option>
            <option value="automatic" ${repairCase.automation_mode==="automatic"?"selected":""}>Automático</option>
          </select>
        </div>
      </div>

      <div class="cf8-stage-track">
        ${STAGES.map(([key,label], i) => `
          <div class="${i < idx ? "done" : i === idx ? "current" : ""}">
            <span>${i < idx ? "✓" : i + 1}</span>
            <strong>${label}</strong>
          </div>
        `).join("")}
      </div>

      <div class="cf8-workflow-grid">
        <section class="cf8-preflight">
          <div class="cf8-mini-head">
            <div><strong>Preflight</strong><span>${pf.ready ? "Listo" : `${pf.missing.length} pendiente(s)`}</span></div>
            <span class="${pf.ready ? "ok" : "warn"}">${pf.ready ? "Completo" : "Requiere atención"}</span>
          </div>
          <div class="cf8-checks">
            ${pf.checks.map((c)=>`
              <button data-check="${c.key}" class="${c.ok?"ok":"missing"}">
                <span>${c.ok?"✓":"!"}</span>
                <div><strong>${escapeHtml(c.label)}</strong><small>${escapeHtml(c.detail)}</small></div>
              </button>
            `).join("")}
          </div>
        </section>

        <section class="cf8-next-action">
          <div class="cf8-mini-head"><div><strong>Siguiente acción</strong><span>Estado del caso</span></div></div>
          <div class="cf8-action-body">
            <h3>${escapeHtml(repairCase.next_action || headline)}</h3>
            <p>${escapeHtml(description)}</p>
            <div class="cf8-action-buttons">
              ${repairCase.current_stage === "strategy_ready" ? `<button class="btn btn-primary" id="cf8-generate-strategy">${icon("spark")} Generar estrategia y borradores</button>` : ""}
              ${action ? `<button class="btn btn-primary" id="cf8-primary-action">${escapeHtml(actionLabel)}</button>` : ""}
              ${repairCase.current_stage === "new_report_due" ? `<button class="btn btn-primary" id="cf8-import-report">Importar reporte actualizado</button>` : ""}
              ${repairCase.current_stage === "results_review" ? `<button class="btn btn-primary" id="cf8-open-negatives">Abrir resultados</button>` : ""}
            </div>
          </div>
        </section>

        <section class="cf8-provider">
          <div class="cf8-mini-head"><div><strong>CertifiedMailLabels</strong><span>Automatización de correo</span></div></div>
          <div class="cf8-provider-status ${provider.integration_ready ? "ready" : "pending"}">
            <span>${provider.integration_ready ? "✓" : "!"}</span>
            <div>
              <strong>${provider.integration_ready ? "Conector listo" : "Conector pendiente"}</strong>
              <small>${escapeHtml(provider.note)}</small>
            </div>
          </div>
          <p>CreditFlow ya prepara la cola, la aprobación y las referencias internas. El envío real se activará cuando tengamos el contrato técnico/API de tu cuenta.</p>
          <div class="cf8-job-count">${state.mail_jobs?.length || 0} trabajo(s) de correo en historial/cola</div>
        </section>

        <section class="cf8-case-events">
          <div class="cf8-mini-head"><div><strong>Actividad del proceso</strong><span>Últimos eventos</span></div></div>
          ${recentEvents.length ? recentEvents.map((ev)=>`
            <div class="cf8-event">
              <span></span>
              <div><strong>${escapeHtml(ev.event_type.replaceAll("_"," "))}</strong><small>${escapeHtml(ev.detail || "")}</small><em>${formatDateTime(ev.created_at)}</em></div>
            </div>
          `).join("") : `<div class="text-sm text-muted">Sin eventos adicionales.</div>`}
        </section>
      </div>
    </section>
  `;

  container.querySelector("#cf8-mode")?.addEventListener("change", async (e) => {
    try {
      await api.put(`/repair-cases/${clientId}/mode`, { automation_mode: e.target.value });
      toast("Modo de automatización actualizado", "success");
      await renderRepairWorkflowV8(container, clientId, opts);
    } catch (err) {
      toast(err.message, "error");
    }
  });

  container.querySelectorAll("[data-check]").forEach((b)=>{
    b.addEventListener("click",()=>{
      const key=b.dataset.check;
      if(key==="id"||key==="proof_address") opts.openTab?.("documentos");
      else if(key==="report") opts.openTab?.("reporte");
      else opts.openTab?.("resumen");
    });
  });

  container.querySelector("#cf8-primary-action")?.addEventListener("click", async (e) => {
    const btn=e.currentTarget;
    btn.disabled=true;
    try{
      await sendAction(clientId, action);
      toast("Proceso actualizado", "success");
      await renderRepairWorkflowV8(container, clientId, opts);
      opts.onChanged?.();
    }catch(err){
      toast(err.message,"error");
      btn.disabled=false;
    }
  });

  container.querySelector("#cf8-generate-strategy")?.addEventListener("click", async (e)=>{
    const btn=e.currentTarget;
    btn.disabled=true;
    btn.textContent="Generando…";
    await runSmartGenerateForClient(clientId,()=>{});
    try{
      await sendAction(clientId,"strategy_generated");
      toast("Estrategia procesada", "success");
      await renderRepairWorkflowV8(container,clientId,opts);
      opts.onChanged?.();
    }catch(err){
      toast(err.message,"error");
      btn.disabled=false;
    }
  });

  container.querySelector("#cf8-import-report")?.addEventListener("click",()=>opts.openTab?.("reporte"));
  container.querySelector("#cf8-open-negatives")?.addEventListener("click",()=>opts.openTab?.("negativos"));
}
