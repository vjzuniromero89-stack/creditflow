import { api } from "../api.js";
import { escapeHtml } from "../utils.js";
import { money } from "./collections.js";
import { toast } from "../toast.js";

function dateLabel(value) {
  if (!value) return "Sin fecha";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat("es-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(d);
}

function eventLabel(ev) {
  if (ev.status === "reappeared") return "Reapareció después";
  return "Remoción confirmada";
}

export async function renderEarningsDashboard(container) {
  container.innerHTML = `<div class="card">Cargando ganancias…</div>`;

  const [
    { categories, totals },
    { clients },
    { events },
  ] = await Promise.all([
    api.get("/credit-items/earnings"),
    api.get("/credit-items/earnings-by-client"),
    api.get("/removal-events"),
  ]);

  const confirmed = Number(totals.real || 0);
  const paid = Number(totals.paid || 0);
  const owed = Number(totals.owed || 0);
  const potential = Number(totals.pending || 0);
  const reappeared = Number(totals.reappeared_count || 0);

  const recent = (events || []).slice(0, 12);
  const removalRate =
    (Number(totals.real_count || 0) + Number(totals.pending_count || 0)) > 0
      ? Math.round(
          (Number(totals.real_count || 0) /
            (Number(totals.real_count || 0) + Number(totals.pending_count || 0))) *
            100
        )
      : 0;

  container.innerHTML = `
    <div class="earnings-smart">
      <section class="earnings-hero">
        <div>
          <div class="earnings-eyebrow">Historial permanente</div>
          <h2>Centro inteligente de remociones</h2>
          <p>
            La ganancia confirmada ahora nace de eventos históricos de remoción.
            Cambiar tarifas después o importar otro reporte no reescribe lo que ya ocurrió.
          </p>
        </div>
        <div class="earnings-auto-pill">● Detección automática activa</div>
      </section>

      <section class="earnings-kpis">
        <article class="earnings-kpi primary">
          <span>Ganancia confirmada</span>
          <strong>${money(confirmed)}</strong>
          <small>${totals.real_count || 0} remoción(es) histórica(s)</small>
        </article>
        <article class="earnings-kpi">
          <span>Por cobrar</span>
          <strong>${money(owed)}</strong>
          <small>${totals.owed_count || 0} pendiente(s) de cobro</small>
        </article>
        <article class="earnings-kpi">
          <span>Cobrado</span>
          <strong>${money(paid)}</strong>
          <small>${totals.paid_count || 0} pagado(s)</small>
        </article>
        <article class="earnings-kpi">
          <span>Potencial</span>
          <strong>${money(potential)}</strong>
          <small>${totals.pending_count || 0} todavía en reporte</small>
        </article>
      </section>

      <section class="card earnings-efficiency">
        <div class="flex-between">
          <div>
            <h3>Progreso de remociones</h3>
            <p class="text-sm text-muted">
              Solo las remociones ya detectadas entran en Ganancia confirmada.
            </p>
          </div>
          <strong>${removalRate}%</strong>
        </div>
        <div class="earnings-progress"><span style="width:${removalRate}%"></span></div>
        ${
          reappeared
            ? `<div class="earnings-reappeared-note">⚠️ ${reappeared} ítem(s) tienen historial de remoción pero volvieron a aparecer en un reporte posterior. El evento histórico se conserva para auditoría.</div>`
            : ""
        }
      </section>

      <div class="earnings-columns">
        <section class="card">
          <div class="flex-between" style="margin-bottom:12px">
            <div>
              <h3>Remociones detectadas</h3>
              <p class="text-sm text-muted">Eventos permanentes, ordenados por fecha.</p>
            </div>
          </div>
          ${
            recent.length
              ? `<div class="earnings-removal-list">
                  ${recent.map((ev) => `
                    <button class="earnings-removal-row" data-client="${ev.client_id}">
                      <div>
                        <strong>${escapeHtml(ev.creditor_name || "Ítem removido")}</strong>
                        <span>${escapeHtml(ev.client_name || "")} · ${escapeHtml(ev.bureau || "Buró no indicado")}</span>
                      </div>
                      <div class="earnings-removal-value">
                        <strong>${money(ev.amount)}</strong>
                        <span>${dateLabel(ev.detected_at)} · ${eventLabel(ev)}</span>
                      </div>
                    </button>
                  `).join("")}
                </div>`
              : `<div class="empty"><div class="mark">✓</div><h3>Aún no hay remociones históricas</h3><p>Cuando un reporte nuevo confirme una eliminación aparecerá aquí automáticamente.</p></div>`
          }
        </section>

        <section class="card">
          <div style="margin-bottom:12px">
            <h3>Ganancia por cliente</h3>
            <p class="text-sm text-muted">Confirmada, cobrada y pendiente.</p>
          </div>
          ${
            clients?.length
              ? `<div class="earnings-client-list">
                  ${clients.map((c) => `
                    <button class="earnings-client-row" data-client="${c.client_id}">
                      <div>
                        <strong>${escapeHtml(c.client_name)}</strong>
                        <span>${c.real_count || 0} remoción(es) · ${c.pending_count || 0} potencial(es)</span>
                      </div>
                      <div>
                        <strong>${money(c.real_amount)}</strong>
                        <span>${c.owed_amount ? `${money(c.owed_amount)} por cobrar` : "Todo cobrado"}</span>
                      </div>
                    </button>
                  `).join("")}
                </div>`
              : `<div class="empty text-sm">Sin ganancias todavía.</div>`
          }
        </section>
      </div>

      <section class="card" style="margin-top:18px">
        <div class="flex-between" style="margin-bottom:12px">
          <div>
            <h3>Resumen por categoría</h3>
            <p class="text-sm text-muted">
              “Real” usa la tarifa congelada al detectarse la remoción. “Potencial” usa la tarifa actual.
            </p>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Categoría</th>
                <th class="cell-num">Remociones</th>
                <th class="cell-num">Ganancia real</th>
                <th class="cell-num">Por cobrar</th>
                <th class="cell-num">Potencial</th>
              </tr>
            </thead>
            <tbody>
              ${categories
                .filter((c) => c.real_count || c.pending_count)
                .map((c) => `
                  <tr>
                    <td class="row-name">${escapeHtml(c.label || c.category)}</td>
                    <td class="cell-num">${c.real_count || 0}</td>
                    <td class="cell-num">${money(c.real_amount)}</td>
                    <td class="cell-num">${money(c.owed_amount)}</td>
                    <td class="cell-num">${money(c.pending_amount)}</td>
                  </tr>
                `)
                .join("") || `<tr><td colspan="5" class="text-muted">Sin movimientos.</td></tr>`}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  `;

  container.querySelectorAll("[data-client]").forEach((el) => {
    el.addEventListener("click", () => {
      window.__creditflowNavigate(`#/clientes/${el.dataset.client}`);
    });
  });
}
