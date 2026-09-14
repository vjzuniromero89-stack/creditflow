import { api } from "../api.js";
import { icon } from "../icons.js";
import { toast } from "../toast.js";
import { escapeHtml, formatDateTime } from "../utils.js";
import { runSmartGenerateForClient } from "./collections.js";

const STAGES = [
  ["preflight","Preflight"],["identity_review","Información personal"],["report_audit","Auditoría"],
  ["strategy_ready","Estrategia"],["approval_required","Aprobación"],["mailing_ready","Envío"],
  ["provider_setup","Certified Mail"],["waiting_response","Espera"],["new_report_due","Nuevo reporte"],
  ["results_review","Resultados"],["completed","Completado"],
];

const STAGE_TEXT = {
  preflight:["Completar expediente","Reúne los documentos y datos mínimos antes de disputar."],
  identity_review:["Revisar información personal","Confirma nombres, direcciones y datos de identidad antes del primer round."],
  report_audit:["Auditar reporte","Revisa los negativos y documenta qué información es realmente incorrecta."],
  strategy_ready:["Preparar estrategia","CreditFlow puede generar los borradores apropiados para los ítems elegibles."],
  approval_required:["Revisar y aprobar cartas","Los borradores están listos. Revísalos antes de convertirlos en envíos."],
  mailing_ready:["Aprobar lote de correo","Las cartas aprobadas pasarán a la cola de PostGrid Certified Mail."],
  provider_setup:["Procesar con PostGrid","El lote está aprobado. Continúa en Envíos certificados para preparar y probar los trabajos."],
  waiting_response:["Esperando respuesta","No generes una segunda ronda hasta tener resultado o nueva evidencia."],
  new_report_due:["Importar reporte actualizado","Compara el nuevo reporte contra el anterior para detectar remociones."],
  results_review:["Revisar resultados","Confirma remociones, correcciones, reapariciones y próximos pasos."],
  completed:["Caso completado","El expediente está cerrado."],
};
const stageIndex=s=>Math.max(0,STAGES.findIndex(([k])=>k===s));
const primaryAction=s=>({
 preflight:["sync","Continuar a Información personal"],
 identity_review:["complete_identity_review","Confirmar información personal"],
 report_audit:["complete_report_audit","Confirmar auditoría"],
 approval_required:["approve_letters","Aprobar cartas"],
 mailing_ready:["approve_mailing","Aprobar lote de Certified Mail"],
 waiting_response:["new_report_due","Solicitar nuevo reporte"],
 new_report_due:[null,"Importar reporte"],results_review:[null,"Revisar negativos"]
}[s]||[null,null]);
const sendAction=(id,action,extra={})=>api.post(`/repair-cases/${id}/action`,{action,...extra});

async function postGridState(){
  try{return await api.get("/postgrid/status")}
  catch{return {provider:{connection_status:"unavailable",credentials_configured:false,environment:"test"},jobs:[]}}
}

export async function renderRepairWorkflowV8(container,clientId,opts={}){
 container.innerHTML=`<div class="card">Cargando proceso de reparación…</div>`;
 const [state,pg,profile]=await Promise.all([
   api.get(`/repair-cases/${clientId}`),
   postGridState(),
   api.get(`/clients/${clientId}`)
 ]);
 let repairCase=state.case; const pf=state.preflight;
 const client=profile?.client||{};
 const addresses=profile?.addresses||[];
 if(!repairCase){
  container.innerHTML=`<section class="cf8-start-card"><div class="cf8-start-icon">⚡</div><div><div class="cf7-eyebrow">CreditFlow Repair Engine</div><h2>Este cliente todavía no ha iniciado reparación</h2><p>Al iniciar, CreditFlow controlará requisitos, estrategia, cartas, aprobaciones, envíos, resultados y cobros desde un solo flujo.</p></div><div class="cf8-start-actions"><label>Modo inicial<select id="cf8-start-mode"><option value="assisted" selected>Asistido — recomendado</option><option value="manual">Manual</option><option value="automatic">Automático</option></select></label><button class="btn btn-primary" id="cf8-start-repair">${icon("spark")} Empezar reparación</button></div></section>`;
  container.querySelector("#cf8-start-repair").onclick=async e=>{const b=e.currentTarget;b.disabled=true;b.textContent="Iniciando…";try{await api.post(`/repair-cases/${clientId}/start`,{automation_mode:container.querySelector("#cf8-start-mode").value});toast("Proceso de reparación iniciado","success");await renderRepairWorkflowV8(container,clientId,opts);opts.onChanged?.()}catch(err){toast(err.message,"error");b.disabled=false;b.innerHTML=`${icon("spark")} Empezar reparación`}};
  return;
 }
 // Preflight has no discretionary decision: if all four requirements are green,
 // Assisted mode advances it automatically. If the request fails, the visible
 // "Continuar" button remains available as a safe fallback.
 if(repairCase.current_stage==="preflight" && pf.ready && repairCase.automation_mode!=="manual"){
   try{
     const advanced=await sendAction(clientId,"sync");
     if(advanced?.case?.current_stage && advanced.case.current_stage!=="preflight"){
       repairCase=advanced.case;
       state.events=state.events||[];
     }
   }catch(e){
     console.warn("Preflight auto-advance failed",e);
   }
 }
 const idx=stageIndex(repairCase.current_stage),
       stageCopy=(repairCase.current_stage==="preflight" && pf.ready)
         ? ["Preflight completo","Todos los requisitos están completos. Continúa a Información personal."]
         : (STAGE_TEXT[repairCase.current_stage]||["Continuar caso",repairCase.next_action||""]),
       [headline,description]=stageCopy,
       [action,actionLabel]=primaryAction(repairCase.current_stage),
       events=(state.events||[]).slice(0,5);
 const provider=pg.provider||{}, jobs=(pg.jobs||[]).filter(j=>String(j.client_id)===String(clientId));
 const connected=provider.connection_status==="connected";
 const keyOk=!!provider.credentials_configured;
 const identityActive=repairCase.current_stage==="identity_review";
 const currentAddress=client.address||client.address_line||client.current_address||"No registrada";
 const dob=client.dob||client.date_of_birth||client.birth_date||"No disponible";
 const identityRows=addresses.map((a,i)=>`
   <div class="cf115-address-row">
     <div><strong>${escapeHtml(a.address_line||"Dirección")}</strong><small>${escapeHtml(a.bureaus||"Detectada en reporte")}</small></div>
     <select class="cf115-address-class" data-address-id="${a.id||i}">
       <option value="">Clasificar…</option>
       <option value="current">Actual</option>
       <option value="valid_previous">Anterior válida</option>
       <option value="not_mine">No pertenece</option>
       <option value="unknown">Desconocida</option>
     </select>
   </div>`).join("");
 const identityPanel=identityActive?`
   <section class="cf115-identity-review">
     <div class="cf115-title"><div><strong>Revisión de información personal</strong><span>Verifica los datos antes de habilitar la auditoría.</span></div><span class="cf115-review-badge">REVISIÓN REQUERIDA</span></div>
     <div class="cf115-person-grid">
       <div><small>Nombre legal</small><strong>${escapeHtml(client.full_name||client.name||"No registrado")}</strong></div>
       <div><small>Dirección actual del expediente</small><strong>${escapeHtml(currentAddress)}</strong></div>
       <div><small>Fecha de nacimiento</small><strong>${escapeHtml(dob)}</strong></div>
       <div><small>Identificación</small><strong>${pf.checks?.find(x=>x.key==="id")?.detail?escapeHtml(pf.checks.find(x=>x.key==="id").detail):"Documento cargado"}</strong></div>
     </div>
     <div class="cf115-addresses">
       <div class="cf115-subhead"><strong>Direcciones detectadas en el reporte</strong><span>Clasifica cada una. No se disputará una dirección válida solamente por ser antigua.</span></div>
       ${identityRows||`<div class="cf115-empty">No se detectaron direcciones adicionales en el reporte.</div>`}
     </div>
     <label class="cf115-confirm"><input type="checkbox" id="cf115-identity-confirm"> <span>Confirmo que revisé los datos del cliente y clasifiqué las direcciones conocidas.</span></label>
   </section>`:"";
 container.innerHTML=`
 <section class="cf8-workflow">
  <div class="cf8-workflow-head"><div><div class="cf7-eyebrow">Repair Engine · ${escapeHtml(repairCase.automation_mode)}</div><h2>${escapeHtml(headline)}</h2><p>${escapeHtml(description)}</p></div><div class="cf8-mode-box"><label>Automatización</label><select id="cf8-mode"><option value="manual" ${repairCase.automation_mode==="manual"?"selected":""}>Manual</option><option value="assisted" ${repairCase.automation_mode==="assisted"?"selected":""}>Asistido</option><option value="automatic" ${repairCase.automation_mode==="automatic"?"selected":""}>Automático</option></select></div></div>
  <div class="cf8-stage-track">${STAGES.map(([k,l],i)=>`<div class="${i<idx?"done":i===idx?"current":""}"><span>${i<idx?"✓":i+1}</span><strong>${l}</strong></div>`).join("")}</div>
  ${identityPanel}
  <div class="cf8-workflow-grid">
   <section class="cf8-preflight"><div class="cf8-mini-head"><div><strong>Preflight</strong><span>${pf.ready?"Listo":`${pf.missing.length} pendiente(s)`}</span></div><span class="${pf.ready?"ok":"warn"}">${pf.ready?"Completo":"Requiere atención"}</span></div><div class="cf8-checks">${pf.checks.map(c=>`<button data-check="${c.key}" class="${c.ok?"ok":"missing"}"><span>${c.ok?"✓":"!"}</span><div><strong>${escapeHtml(c.label)}</strong><small>${escapeHtml(c.detail)}</small></div></button>`).join("")}</div></section>
   <section class="cf8-next-action"><div class="cf8-mini-head"><div><strong>Siguiente acción</strong><span>Estado del caso</span></div></div><div class="cf8-action-body"><h3>${escapeHtml(repairCase.next_action||headline)}</h3><p>${escapeHtml(description)}</p><div class="cf8-action-buttons">${repairCase.current_stage==="strategy_ready"?`<button class="btn btn-primary" id="cf8-generate-strategy">${icon("spark")} Generar estrategia y borradores</button>`:""}${action?`<button class="btn btn-primary" id="cf8-primary-action" ${identityActive?"disabled":""}>${escapeHtml(actionLabel)}</button>`:""}${repairCase.current_stage==="provider_setup"?`<button class="btn btn-primary" id="cf8-open-postgrid">Abrir PostGrid</button>`:""}${repairCase.current_stage==="new_report_due"?`<button class="btn btn-primary" id="cf8-import-report">Importar reporte actualizado</button>`:""}${repairCase.current_stage==="results_review"?`<button class="btn btn-primary" id="cf8-open-negatives">Abrir resultados</button>`:""}</div></div></section>
   <section class="cf8-provider"><div class="cf8-mini-head"><div><strong>PostGrid</strong><span>Certified Mail · TEST</span></div></div><div class="cf8-provider-status ${connected?"ready":"pending"}"><span>${connected?"✓":"!"}</span><div><strong>${connected?"Conector TEST conectado":keyOk?"Clave configurada · falta probar conexión":"Conector TEST pendiente"}</strong><small>${connected?"PostGrid está listo para trabajos de prueba.":keyOk?"Ve a Envíos certificados y pulsa Probar conexión.":"POSTGRID_TEST_API_KEY no fue detectada por el Worker."}</small></div></div><p>${connected?"Las cartas aprobadas pueden prepararse y enviarse al sandbox. Ningún correo físico se envía en TEST.":"CreditFlow mantendrá bloqueado el envío hasta validar el conector de prueba."}</p><div class="cf8-job-count">${jobs.length} trabajo(s) PostGrid de este cliente</div><button class="btn btn-ghost btn-sm" id="cf8-provider-open">Abrir Envíos certificados</button></section>
   <section class="cf8-case-events"><div class="cf8-mini-head"><div><strong>Actividad del proceso</strong><span>Últimos eventos</span></div></div>${events.length?events.map(ev=>`<div class="cf8-event"><span></span><div><strong>${escapeHtml(ev.event_type.replaceAll("_"," "))}</strong><small>${escapeHtml(ev.detail||"")}</small><em>${formatDateTime(ev.created_at)}</em></div></div>`).join(""):`<div class="text-sm text-muted">Sin eventos adicionales.</div>`}</section>
  </div>
 </section>`;
 container.querySelector("#cf8-mode")?.addEventListener("change",async e=>{try{await api.put(`/repair-cases/${clientId}/mode`,{automation_mode:e.target.value});toast("Modo actualizado","success");await renderRepairWorkflowV8(container,clientId,opts)}catch(err){toast(err.message,"error")}});
 container.querySelectorAll("[data-check]").forEach(b=>b.onclick=()=>{const k=b.dataset.check;if(k==="id"||k==="proof_address")opts.openTab?.("documentos");else if(k==="report")opts.openTab?.("reporte");else opts.openTab?.("resumen")});
 const identityConfirm=container.querySelector("#cf115-identity-confirm");
 if(identityConfirm){
   const refreshIdentityGate=()=>{
     const selects=[...container.querySelectorAll(".cf115-address-class")];
     const allClassified=selects.every(s=>!!s.value);
     const b=container.querySelector("#cf8-primary-action");
     if(b) b.disabled=!(identityConfirm.checked&&allClassified);
   };
   identityConfirm.addEventListener("change",refreshIdentityGate);
   container.querySelectorAll(".cf115-address-class").forEach(s=>s.addEventListener("change",refreshIdentityGate));
   refreshIdentityGate();
 }
 container.querySelector("#cf8-primary-action")?.addEventListener("click",async e=>{const b=e.currentTarget;b.disabled=true;try{await sendAction(clientId,action);toast("Proceso actualizado","success");await renderRepairWorkflowV8(container,clientId,opts);opts.onChanged?.()}catch(err){toast(err.message,"error");b.disabled=false}});
 container.querySelector("#cf8-generate-strategy")?.addEventListener("click",async e=>{const b=e.currentTarget;b.disabled=true;b.textContent="Generando…";await runSmartGenerateForClient(clientId,()=>{});try{await sendAction(clientId,"strategy_generated");toast("Estrategia procesada","success");await renderRepairWorkflowV8(container,clientId,opts);opts.onChanged?.()}catch(err){toast(err.message,"error");b.disabled=false}});
 const openPG=()=>window.__creditflowNavigate("#/envios");
 container.querySelector("#cf8-provider-open")?.addEventListener("click",openPG);
 container.querySelector("#cf8-open-postgrid")?.addEventListener("click",openPG);
 container.querySelector("#cf8-import-report")?.addEventListener("click",()=>opts.openTab?.("reporte"));
 container.querySelector("#cf8-open-negatives")?.addEventListener("click",()=>opts.openTab?.("negativos"));
}
