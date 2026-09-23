import { renderClientsList as renderList, renderClientDetail as renderDetail } from "./clients-v8.js";
import { api } from "../api.js";
import { escapeHtml } from "../utils.js";
import { openCreditItemModal } from "./collections.js";
import { renderClientAddresses } from "./addresses.js";
import { renderSmartLetters } from "./smart-repair-v15.js";

const META={
  coleccion:{label:"Colecciones",sub:"Cuentas en collection reportadas por los burós."},
  charge_off:{label:"Charge-Offs",sub:"Cuentas castigadas / charged off."},
  pago_tardio:{label:"Pagos tardíos",sub:"Historial 30/60/90+ y otras moras reportadas."},
  inquiry:{label:"Inquiries",sub:"Consultas de crédito detectadas en el reporte."},
  liquidada:{label:"Liquidadas",sub:"Cuentas settled / liquidadas que requieren revisión."}
};
const NEGATIVE_KEYS=Object.keys(META);

export async function renderClientsList(container){
  await renderList(container);
  container.classList.add("cf14-clients");
  const head=container.querySelector(".section-head");
  if(head){
    const intro=document.createElement("div");
    intro.className="cf14-list-intro";
    intro.innerHTML=`<div><span class="cf14-eyebrow">CLIENT MANAGEMENT</span><h2>Expedientes de reparación</h2><p>Un expediente por cliente: reporte, negativos, cartas, envíos y resultados.</p></div>`;
    container.insertBefore(intro,container.firstChild);
  }
}

function itemTable(items,key,clientId,refresh){
  const m=META[key];
  return `<div class="cf14-section-head"><div><span class="cf14-eyebrow">REPORTE DE CRÉDITO</span><h3>${m.label}</h3><p>${m.sub}</p></div><button class="btn btn-ghost btn-sm" data-add-item="${key}">+ Agregar manualmente</button></div>
  ${items.length?`<div class="cf14-table"><table><thead><tr><th>Acreedor / Collector</th><th>Cuenta</th><th>Buró</th><th>Estado</th><th>Balance</th><th>Reportado</th></tr></thead><tbody>${items.map(i=>`<tr><td><strong>${escapeHtml(i.creditor_name||"—")}</strong></td><td>${escapeHtml(i.account_number||"—")}</td><td><span class="cf14-bureau">${escapeHtml(i.bureaus||"—")}</span></td><td>${escapeHtml(i.status_raw||"—")}</td><td>${escapeHtml(i.balance||"—")}</td><td>${escapeHtml(i.date_reported||"—")}</td></tr>`).join("")}</tbody></table></div>`:`<div class="cf14-empty"><strong>Sin ${m.label.toLowerCase()}</strong><span>No se detectaron registros de este tipo en el reporte actual.</span></div>`}`;
}

async function buildCategoryPanel(panel,key,clientId){
  const {credit_items=[]}=await api.get(`/credit-items?client_id=${clientId}`);
  const items=credit_items.filter(i=>i.category===key);
  panel.innerHTML=itemTable(items,key,clientId);
  panel.querySelector(`[data-add-item="${key}"]`)?.addEventListener("click",()=>{
    openCreditItemModal({clientId,onSaved:()=>buildCategoryPanel(panel,key,clientId)});
  });
}

async function buildPersonalPanel(panel,clientId){
  const [{client},{addresses=[]}]=await Promise.all([api.get(`/clients/${clientId}`),api.get(`/clients/${clientId}/addresses`)]);
  panel.innerHTML=`<div class="cf14-section-head"><div><span class="cf14-eyebrow">INFORMACIÓN PERSONAL</span><h3>Identidad reportada</h3><p>Datos del cliente y direcciones detectadas. CreditFlow conserva esta información separada de los negativos.</p></div><div style="display:flex;gap:8px"><button class="btn btn-primary btn-sm" id="cf15-intake-link">Crear link de registro</button><button class="btn btn-ghost btn-sm" id="cf14-edit-client">Editar cliente</button></div></div>
  <div class="cf14-info-grid">
    <div><span>Nombre legal</span><strong>${escapeHtml(client.full_name||"—")}</strong></div>
    <div><span>Teléfono</span><strong>${escapeHtml(client.phone||"—")}</strong></div>
    <div><span>Email</span><strong>${escapeHtml(client.email||"—")}</strong></div>
    <div><span>Fecha de nacimiento</span><strong>${escapeHtml((client.date_of_birth||"").slice(0,10)||"—")}</strong></div>
    <div><span>ID / SSN</span><strong>${client.id_last4?`•••-••-${escapeHtml(client.id_last4)}`:"—"}</strong></div>
    <div><span>Dirección actual</span><strong>${escapeHtml([client.address,client.city,client.state,client.zip].filter(Boolean).join(", ")||"—")}</strong></div>
  </div>
  <div class="cf14-subsection"><div class="cf14-subhead"><div><h4>Direcciones actuales y anteriores</h4><p>${addresses.length} dirección(es) registradas desde los reportes.</p></div></div><div id="cf14-addresses"></div></div>
  <div class="cf14-personal-note"><strong>Alias y teléfonos adicionales</strong><span>Cuando el formato del reporte los incluya de forma estructurada, deben revisarse aquí antes de cualquier carta. El teléfono principal permanece en el perfil del cliente.</span></div>`;
  await renderClientAddresses(panel.querySelector("#cf14-addresses"),clientId);
  panel.querySelector("#cf14-edit-client")?.addEventListener("click",()=>document.getElementById("edit-client")?.click());
  panel.querySelector("#cf15-intake-link")?.addEventListener("click",async()=>{try{const r=await api.post(`/clients/${clientId}/intake-link`,{});await navigator.clipboard.writeText(r.url);alert(`Link copiado:\n${r.url}`)}catch(e){alert(e.message)}});
}

function makePanel(key,label){
  const p=document.createElement("section");p.className="cf7-client-panel cf14-panel";p.dataset.panel=key;p.setAttribute("aria-label",label);return p;
}

export async function renderClientDetail(container,id){
  await renderDetail(container,id);
  container.classList.add("cf14-client");

  const nav=container.querySelector(".cf7-client-tabs");
  const panels=container.querySelector(".cf7-client-panels");
  if(!nav||!panels)return;

  // Remove legacy strategy/security surfaces. The simple strategy lives in Resumen.
  panels.querySelector('[data-panel="estrategia"]')?.remove();
  panels.querySelector('[data-panel="seguridad"]')?.remove();
  panels.querySelector('[data-panel="negativos"]')?.remove();

  // Report workspace: keep scores, remove duplicate address block and add a clear import hub.
  const report=panels.querySelector('[data-panel="reporte"]');
  report?.querySelector("#client-addresses")?.closest(".section-head")?.remove();
  report?.querySelector("#client-addresses")?.remove();
  if(report){
    const hub=document.createElement("div");hub.className="cf14-report-hub";
    hub.innerHTML=`<div><span class="cf14-eyebrow">PASO 1 · REPORTE</span><h3>Importar reporte de crédito</h3><p>Obtén el reporte del cliente, guarda el PDF e impórtalo. CreditFlow clasifica automáticamente los negativos y la información personal que reconoce.</p></div><div class="cf14-report-actions"><a class="btn btn-ghost" href="https://www.annualcreditreport.com/" target="_blank" rel="noopener">Abrir AnnualCreditReport.com ↗</a><button class="btn btn-primary" id="cf14-import-report">Importar PDF</button></div>`;
    report.prepend(hub);
    hub.querySelector("#cf14-import-report")?.addEventListener("click",()=>document.getElementById("import-report-input")?.click());
  }

  // Create focused report categories.
  const categoryPanels={};
  for(const key of NEGATIVE_KEYS){
    const p=makePanel(key,META[key].label);categoryPanels[key]=p;panels.appendChild(p);await buildCategoryPanel(p,key,id);
  }
  const personal=makePanel("personal","Información personal");panels.appendChild(personal);await buildPersonalPanel(personal,id);
  const smart=makePanel("smart","Generar cartas");panels.appendChild(smart);await renderSmartLetters(smart,id);

  // Reorder the remaining core panels into the operational sequence.
  const order=["resumen","reporte","coleccion","charge_off","pago_tardio","inquiry","liquidada","personal","documentos","smart","historial"];
  order.forEach(k=>{const p=panels.querySelector(`[data-panel="${k}"]`);if(p)panels.appendChild(p)});

  const labels={resumen:"Resumen",reporte:"Reporte",coleccion:"Colecciones",charge_off:"Charge-Offs",pago_tardio:"Pagos tardíos",inquiry:"Inquiries",liquidada:"Liquidadas",personal:"Información personal",documentos:"Documentos",smart:"Generar cartas",historial:"Historial"};
  nav.innerHTML=order.map((k,i)=>`<button class="${i===0?"active":""}" data-tab="${k}">${labels[k]}</button>`).join("");

  function openTab(key){
    nav.querySelectorAll("[data-tab]").forEach(b=>b.classList.toggle("active",b.dataset.tab===key));
    panels.querySelectorAll(".cf7-client-panel").forEach(p=>p.classList.toggle("active",p.dataset.panel===key));
  }
  nav.querySelectorAll("[data-tab]").forEach(btn=>btn.addEventListener("click",async()=>{
    openTab(btn.dataset.tab);
    if(NEGATIVE_KEYS.includes(btn.dataset.tab))await buildCategoryPanel(categoryPanels[btn.dataset.tab],btn.dataset.tab,id);
    if(btn.dataset.tab==="personal")await buildPersonalPanel(personal,id); if(btn.dataset.tab==="smart")await renderSmartLetters(smart,id);
  }));
  openTab("resumen");

  // Clear outdated wording that implied every mailing is certified.
  container.querySelectorAll("a,button,p,small").forEach(el=>{
    if(el.textContent?.includes("Envíos certificados"))el.textContent=el.textContent.replace("Envíos certificados","Envíos");
  });
}
