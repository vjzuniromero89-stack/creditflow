import { api } from "../api.js";
import { icon } from "../icons.js";
import { escapeHtml, formatDateTime, statusBadge } from "../utils.js";
import { money } from "./collections.js";

export async function renderDashboardV7(container) {
  container.innerHTML = `<div class="card">Cargando centro de control…</div>`;

  const [
    stats,
    earnings,
    removalResult,
    { clients = [] },
  ] = await Promise.all([
    api.get("/dashboard/stats"),
    api.get("/credit-items/earnings").catch(()=>({ totals:{} })),
    api.get("/removal-events").catch(()=>({ events:[] })),
    api.get("/clients"),
  ]);

  const s=stats.letters_by_status||{};
  const totals=earnings.totals||{};
  const events=removalResult.events||[];
  const attention = clients.filter((c)=>c.status==="activo").slice(0,6);

  container.innerHTML = `
    <section class="cf7-dashboard-hero">
      <div>
        <div class="cf7-eyebrow">Centro de operación</div>
        <h2>Lo importante primero</h2>
        <p>Clientes activos, trabajo pendiente, resultados y cobros en una sola vista.</p>
      </div>
      <button class="btn btn-primary" id="cf7-new-client">${icon("plus")} Nuevo expediente</button>
    </section>

    <section class="cf7-dashboard-kpis">
      <button data-go="#/clientes"><span>Clientes activos</span><strong>${stats.clients_active||0}</strong><small>${stats.clients_total||0} total</small></button>
      <button data-go="#/cartas"><span>Cartas por trabajar</span><strong>${stats.pending_letters?.length||0}</strong><small>${s.borrador||0} borrador(es)</small></button>
      <button data-go="#/ganancias"><span>Remociones</span><strong>${totals.real_count||0}</strong><small>${money(totals.real||0)} confirmado</small></button>
      <button data-go="#/ganancias"><span>Por cobrar</span><strong>${money(totals.owed||0)}</strong><small>${totals.owed_count||0} resultado(s)</small></button>
    </section>

    <div class="cf7-dashboard-grid">
      <section class="card cf7-dashboard-primary">
        <div class="cf7-section-minihead">
          <div><h3>Próximo trabajo</h3><p>Cartas pendientes que requieren revisión o envío.</p></div>
          <a href="#/cartas">Ver todas →</a>
        </div>
        <div class="cf7-work-list">
          ${stats.pending_letters?.length ? stats.pending_letters.map((l)=>`
            <button data-letter="${l.id}" class="cf7-work-row">
              <div><strong>${escapeHtml(l.client_name)}</strong><span>${escapeHtml(l.title)}</span></div>
              ${statusBadge(l.status)}
            </button>`).join("") : `<div class="empty">No hay cartas pendientes.</div>`}
        </div>
      </section>

      <section class="card">
        <div class="cf7-section-minihead">
          <div><h3>Últimas remociones</h3><p>Resultados detectados por comparación de reportes.</p></div>
        </div>
        <div class="cf7-result-list">
          ${events.slice(0,7).map((e)=>`
            <button data-client="${e.client_id}">
              <div><strong>${escapeHtml(e.creditor_name||"Ítem removido")}</strong><span>${escapeHtml(e.client_name||"")} · ${escapeHtml(e.bureau||"")}</span></div>
              <div><strong>${money(e.amount)}</strong><span>${e.billing_status==="pagado"?"Pagado":"Por cobrar"}</span></div>
            </button>`).join("") || `<div class="empty">Aún no hay remociones registradas.</div>`}
        </div>
      </section>

      <section class="card">
        <div class="cf7-section-minihead">
          <div><h3>Actividad reciente</h3><p>Últimos movimientos del sistema.</p></div>
        </div>
        <div class="cf7-compact-timeline">
          ${stats.recent_activity?.slice(0,8).map((a)=>`
            <div><span class="cf7-dot"></span><div><strong>${escapeHtml((a.action||"actividad").replaceAll("_"," "))}</strong>${a.detail?`<p>${escapeHtml(a.detail)}</p>`:""}<small>${formatDateTime(a.created_at)}</small></div></div>
          `).join("") || `<div class="empty">Sin actividad reciente.</div>`}
        </div>
      </section>

      <section class="card">
        <div class="cf7-section-minihead">
          <div><h3>Expedientes activos</h3><p>Acceso rápido a tus clientes.</p></div>
          <a href="#/clientes">Abrir clientes →</a>
        </div>
        <div class="cf7-client-quicklist">
          ${attention.map((c)=>`
            <button data-client="${c.id}">
              <span class="user-avatar">${(c.full_name||"?").split(/\s+/).slice(0,2).map(x=>x[0]).join("").toUpperCase()}</span>
              <div><strong>${escapeHtml(c.full_name)}</strong><small>${escapeHtml(c.phone||"Sin teléfono")}</small></div>
              <span>→</span>
            </button>`).join("") || `<div class="empty">Sin clientes activos.</div>`}
        </div>
      </section>
    </div>
  `;

  container.querySelectorAll("[data-go]").forEach((b)=>b.addEventListener("click",()=>window.__creditflowNavigate(b.dataset.go)));
  container.querySelectorAll("[data-client]").forEach((b)=>b.addEventListener("click",()=>window.__creditflowNavigate(`#/clientes/${b.dataset.client}`)));
  container.querySelectorAll("[data-letter]").forEach((b)=>b.addEventListener("click",()=>window.__creditflowNavigate(`#/cartas/${b.dataset.letter}`)));
  container.querySelector("#cf7-new-client")?.addEventListener("click",()=>window.__creditflowNavigate("#/clientes"));
}
