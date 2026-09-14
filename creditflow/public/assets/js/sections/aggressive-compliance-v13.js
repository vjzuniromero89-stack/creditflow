import { api } from "../api.js";
import { escapeHtml } from "../utils.js";
import { toast } from "../toast.js";

function style(){
  if(document.getElementById("cf134-style"))return;
  const s=document.createElement("style");s.id="cf134-style";
  s.textContent=`
  .cf134-shell{display:grid;gap:14px}
  .cf134-hero{padding:18px;border:1px solid rgba(255,155,55,.28);border-radius:16px;background:linear-gradient(135deg,rgba(255,145,45,.08),rgba(92,86,255,.07));display:flex;justify-content:space-between;gap:16px;align-items:center}
  .cf134-hero h3{margin:4px 0 6px;font-size:20px}.cf134-hero p{margin:0;color:var(--cf7-muted);font-size:12px;max-width:880px;line-height:1.55}
  .cf134-kpis{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px}
  .cf134-kpi,.cf134-card{border:1px solid rgba(120,150,170,.18);background:rgba(8,23,34,.56);border-radius:13px;padding:13px}
  .cf134-kpi span{display:block;font-size:24px;font-weight:800}.cf134-kpi strong{font-size:11px}.cf134-kpi small{display:block;color:var(--cf7-muted);font-size:10px;margin-top:3px}
  .cf134-list{display:grid;gap:10px}.cf134-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:start}
  .cf134-meta{font-size:10px;color:var(--cf7-muted);margin-top:4px}.cf134-desc{font-size:11px;color:var(--cf7-muted);margin-top:8px;line-height:1.5}
  .cf134-chip{font-size:10px;padding:5px 8px;border:1px solid rgba(120,150,170,.25);border-radius:999px;white-space:nowrap}
  .cf134-actions{display:flex;gap:7px;flex-wrap:wrap;justify-content:flex-end;margin-top:10px}
  .cf134-note{font-size:11px;color:var(--cf7-muted);padding:10px 12px;border-left:3px solid rgba(255,155,55,.45)}
  @media(max-width:1000px){.cf134-kpis{grid-template-columns:repeat(2,1fr)}}@media(max-width:650px){.cf134-hero{flex-direction:column;align-items:flex-start}.cf134-kpis{grid-template-columns:1fr}.cf134-row{grid-template-columns:1fr}}
  `;
  document.head.appendChild(s);
}

function catLabel(c){
  const x=String(c||"").toLowerCase();
  if(x.includes("cole"))return "COLLECTION";
  if(x.includes("charge"))return "CHARGE-OFF";
  if(x.includes("tard")||x.includes("late"))return "LATE PAYMENT";
  if(x.includes("inquir")||x.includes("consulta"))return "INQUIRY";
  return String(c||"NEGATIVE").toUpperCase();
}

async function load(panel,clientId){
  panel.innerHTML=`<div class="cf134-card">Cargando Challenge Campaign…</div>`;
  try{
    const d=await api.get(`/aggressive-compliance/client/${clientId}/challenge-dashboard`);
    const items=d.items||[],campaigns=d.campaigns||[],counts=d.counts||{};
    const byItem=new Map();
    campaigns.forEach(c=>{if(c.credit_item_id&&!byItem.has(String(c.credit_item_id)))byItem.set(String(c.credit_item_id),c)});

    panel.innerHTML=`<div class="cf134-shell">
      <section class="cf134-hero">
        <div>
          <div class="cf7-eyebrow">AGGRESSIVE COMPLIANCE ENGINE · v13.4</div>
          <h3>Universal Challenge Campaign</h3>
          <p>Collections, charge-offs, late payments e inquiries entran directamente al Challenge Campaign. Aquí no existe una etapa separada de “auditar”, “investigar” o “probar evidencia del cliente”. Cada categoría recibe una ruta y una carta jurídicamente apropiada.</p>
        </div>
        <button class="btn btn-primary" id="cf134-build">Construir todos los Challenges</button>
      </section>

      <div class="cf134-note">No se inventan hechos. Collection usa validation/information challenge; charge-off revisa el reporting; late payment revisa el historial de pagos; inquiry solicita el permissible purpose salvo que el consumidor confirme que fue no autorizado.</div>

      <section class="cf134-kpis">
        <div class="cf134-kpi"><span>${counts.eligible||0}</span><strong>NEGATIVOS ELEGIBLES</strong><small>entran al campaign</small></div>
        <div class="cf134-kpi"><span>${counts.collections||0}</span><strong>COLLECTIONS</strong><small>validation challenge</small></div>
        <div class="cf134-kpi"><span>${counts.chargeoffs||0}</span><strong>CHARGE-OFFS</strong><small>reporting challenge</small></div>
        <div class="cf134-kpi"><span>${counts.late_payments||0}</span><strong>LATE PAYMENTS</strong><small>payment-history challenge</small></div>
        <div class="cf134-kpi"><span>${counts.inquiries||0}</span><strong>INQUIRIES</strong><small>permissible-purpose challenge</small></div>
      </section>

      <section class="cf134-list">
        ${items.map(i=>{
          const c=byItem.get(String(i.id));
          return `<article class="cf134-card">
            <div class="cf134-row">
              <div>
                <strong>${escapeHtml(i.creditor_name||"Cuenta")}</strong>
                <div class="cf134-meta">${escapeHtml(i.account_number||"")} ${i.bureaus?`· ${escapeHtml(i.bureaus)}`:""} ${i.status_raw?`· ${escapeHtml(i.status_raw)}`:""}</div>
                <div class="cf134-desc">${escapeHtml(i.challenge?.note||"Challenge Campaign")}</div>
              </div>
              <span class="cf134-chip">${escapeHtml(catLabel(i.category))}</span>
            </div>
            <div class="cf134-actions">
              ${c
                ? `<span class="cf134-chip">CAMPAIGN ${escapeHtml(c.status||"draft")} · ${escapeHtml(c.template_code||"ACE")}</span>
                   ${c.status==="draft"?`<button class="btn btn-primary btn-sm" data-approve="${c.id}">Aprobar</button>`:""}
                   ${["approved","sent"].includes(c.status)?`<button class="btn btn-ghost btn-sm" data-delivered="${c.id}">Registrar entrega</button>`:""}
                   ${["delivered","waiting_response"].includes(c.status)?`<button class="btn btn-ghost btn-sm" data-response="${c.id}">Registrar respuesta</button><button class="btn btn-ghost btn-sm" data-deadline="${c.id}">Revisar plazo</button>`:""}`
                : `<span class="cf134-chip">LISTO PARA CREAR</span>`}
            </div>
          </article>`;
        }).join("")||`<div class="cf134-card">No se encontraron collections, charge-offs, late payments o inquiries activos.</div>`}
      </section>
    </div>`;

    panel.querySelector("#cf134-build")?.addEventListener("click",async e=>{
      const b=e.currentTarget;b.disabled=true;b.textContent="Construyendo…";
      try{
        const r=await api.post(`/aggressive-compliance/client/${clientId}/build-all-challenges`,{});
        toast(`${r.created} challenge(s) creados · ${r.reused} ya existentes`,"success");
        await load(panel,clientId);
      }catch(err){toast(err.message||"No se pudieron crear los challenges","error");b.disabled=false;b.textContent="Construir todos los Challenges"}
    });

    panel.querySelectorAll("[data-approve]").forEach(b=>b.onclick=async()=>{
      try{await api.post(`/aggressive-compliance/client/${clientId}/campaigns/${b.dataset.approve}/approve`,{});toast("Challenge aprobado","success");await load(panel,clientId)}
      catch(e){toast(e.message||"No se pudo aprobar","error")}
    });

    panel.querySelectorAll("[data-delivered]").forEach(b=>b.onclick=async()=>{
      const v=prompt("Fecha/hora de entrega (ISO) o deja vacío para usar ahora:","");
      try{await api.post(`/aggressive-compliance/client/${clientId}/campaigns/${b.dataset.delivered}/delivered`,v?{delivered_at:v}:{});toast("Entrega registrada","success");await load(panel,clientId)}
      catch(e){toast(e.message||"No se pudo registrar entrega","error")}
    });

    panel.querySelectorAll("[data-response]").forEach(b=>b.onclick=async()=>{
      const s=prompt("Resumen de la respuesta:","");
      if(s===null)return;
      try{await api.post(`/aggressive-compliance/client/${clientId}/campaigns/${b.dataset.response}/response`,{response_summary:s});toast("Respuesta registrada","success");await load(panel,clientId)}
      catch(e){toast(e.message||"No se pudo registrar respuesta","error")}
    });

    panel.querySelectorAll("[data-deadline]").forEach(b=>b.onclick=async()=>{
      const ext=confirm("¿Existe una extensión documentada que deba aplicarse? Aceptar=Sí / Cancelar=No");
      try{const r=await api.post(`/aggressive-compliance/client/${clientId}/campaigns/${b.dataset.deadline}/deadline-review`,{extension_applies:ext});toast(r.rationale||"Plazo revisado","success");await load(panel,clientId)}
      catch(e){toast(e.message||"No se pudo revisar el plazo","error")}
    });

  }catch(e){
    panel.innerHTML=`<div class="cf134-card"><strong>No se pudo cargar Challenge Campaign.</strong><p>${escapeHtml(e.message||String(e))}</p></div>`;
  }
}

export async function installAggressiveComplianceTab(container,clientId){
  style();
  const nav=container.querySelector(".cf7-client-tabs"),panels=container.querySelector(".cf7-client-panels");
  if(!nav||!panels||nav.querySelector('[data-tab="aggressive"]'))return;
  const btn=document.createElement("button");btn.dataset.tab="aggressive";btn.textContent="Aggressive Compliance";nav.appendChild(btn);
  const panel=document.createElement("section");panel.className="cf7-client-panel";panel.dataset.panel="aggressive";panels.appendChild(panel);
  btn.addEventListener("click",async()=>{
    nav.querySelectorAll("button").forEach(x=>x.classList.remove("active"));btn.classList.add("active");
    panels.querySelectorAll(".cf7-client-panel").forEach(p=>p.classList.toggle("active",p===panel));
    await load(panel,clientId);
  });
}
