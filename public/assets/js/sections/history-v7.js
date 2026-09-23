import { api } from "../api.js";
import { escapeHtml, formatDateTime, formatDate } from "../utils.js";
import { money } from "./collections.js";

function ts(v) {
  const d = new Date(v || 0);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

function methodLabel(v) {
  const m = {
    efectivo: "Efectivo", zelle: "Zelle", cashapp: "Cash App", venmo: "Venmo",
    tarjeta: "Tarjeta", transferencia: "Transferencia", cheque: "Cheque",
    sin_especificar: "Sin especificar", otro: "Otro"
  };
  return m[v] || v || "—";
}

export async function renderClientHistoryV7(container, clientId) {
  container.innerHTML = `<div class="card">Cargando historial…</div>`;
  const [
    clientData,
    removalResult,
    paymentResult,
    importResult,
    automationResult,
  ] = await Promise.all([
    api.get(`/clients/${clientId}`),
    api.get(`/removal-events?client_id=${clientId}`).catch(() => ({ events: [] })),
    api.get(`/payment-events?client_id=${clientId}`).catch(() => ({ events: [] })),
    api.get(`/report-imports?client_id=${clientId}`).catch(() => ({ imports: [] })),
    api.get(`/automation-events?client_id=${clientId}`).catch(() => ({ events: [] })),
  ]);

  const activity = clientData.activity || [];
  const removals = removalResult.events || [];
  const payments = paymentResult.events || [];
  const imports = importResult.imports || [];
  const automations = automationResult.events || [];

  const timeline = [];

  imports.forEach((r) => timeline.push({
    type: "report", date: r.created_at || r.report_date,
    title: "Reporte de crédito importado",
    detail: `${r.file_name || "Reporte"} · ${r.item_count || 0} ítem(s) · ${r.score_count || 0} score(s)`,
  }));

  removals.forEach((r) => {
    timeline.push({
      type: r.status === "reappeared" ? "warning" : "success",
      date: r.detected_at,
      title: r.status === "reappeared" ? "Historial de remoción conservado" : "Remoción confirmada",
      detail: `${r.creditor_name || "Ítem"} · ${r.bureau || "Buró"} · ${money(r.amount)}`,
    });
    if (r.reappeared_at) {
      timeline.push({
        type: "warning", date: r.reappeared_at,
        title: "Ítem reapareció en un reporte posterior",
        detail: `${r.creditor_name || "Ítem"} · el evento histórico anterior no fue borrado.`,
      });
    }
  });

  payments.forEach((p) => timeline.push({
    type: "payment", date: p.created_at,
    title: "Pago registrado",
    detail: `${p.creditor_name || "Remoción"} · ${money(p.amount)} · ${methodLabel(p.payment_method)}${p.payment_reference ? ` · ${p.payment_reference}` : ""}`,
  }));

  automations
    .filter((a) => !["credit_report_imported", "payment_recorded"].includes(a.event_type))
    .forEach((a) => timeline.push({
      type: "system", date: a.created_at,
      title: a.event_type.replaceAll("_", " "),
      detail: a.detail || "",
    }));

  activity.forEach((a) => timeline.push({
    type: "activity", date: a.created_at,
    title: (a.action || "actividad").replaceAll("_", " "),
    detail: a.detail || "",
  }));

  timeline.sort((a,b)=>ts(b.date)-ts(a.date));

  const confirmed = removals.reduce((s,r)=>s+Number(r.amount||0),0);
  const collected = payments.reduce((s,p)=>s+Number(p.amount||0),0);
  const owed = removals.filter(r=>r.billing_status!=="pagado").reduce((s,r)=>s+Number(r.amount||0),0);

  container.innerHTML = `
    <div class="cf7-ledger-kpis">
      <div><span>Remociones</span><strong>${removals.length}</strong><small>${money(confirmed)} generado</small></div>
      <div><span>Cobrado</span><strong>${money(collected)}</strong><small>${payments.length} pago(s)</small></div>
      <div><span>Por cobrar</span><strong>${money(owed)}</strong><small>remociones pendientes</small></div>
      <div><span>Reportes</span><strong>${imports.length}</strong><small>importaciones registradas</small></div>
    </div>

    <div class="cf7-history-layout">
      <section class="card">
        <div class="cf7-section-minihead">
          <div><h3>Historial completo</h3><p>Eventos del expediente ordenados por fecha.</p></div>
        </div>
        <div class="cf7-history-feed">
          ${timeline.length ? timeline.map((e)=>`
            <article class="cf7-history-event type-${e.type}">
              <div class="cf7-history-dot"></div>
              <div>
                <strong>${escapeHtml(e.title)}</strong>
                ${e.detail ? `<p>${escapeHtml(e.detail)}</p>` : ""}
                <span>${formatDateTime(e.date)}</span>
              </div>
            </article>
          `).join("") : `<div class="empty">Todavía no hay eventos.</div>`}
        </div>
      </section>

      <section class="card">
        <div class="cf7-section-minihead">
          <div><h3>Libro de remociones y pagos</h3><p>Cada resultado conserva su valor y estado de cobro.</p></div>
        </div>
        <div class="cf7-ledger-list">
          ${removals.length ? removals.map((r)=>{
            const ps=payments.filter(p=>String(p.removal_event_id)===String(r.id));
            return `
              <article class="cf7-ledger-entry">
                <div class="cf7-ledger-entry-head">
                  <div><strong>${escapeHtml(r.creditor_name || "Ítem removido")}</strong><span>${escapeHtml(r.bureau || "—")} · ${formatDate(r.detected_at)}</span></div>
                  <div><strong>${money(r.amount)}</strong><span class="${r.billing_status==="pagado"?"paid":"owed"}">${r.billing_status==="pagado"?"Pagado":"Por cobrar"}</span></div>
                </div>
                ${ps.length ? ps.map(p=>`
                  <div class="cf7-ledger-payment">
                    <span>${formatDate(p.created_at)} · ${methodLabel(p.payment_method)}</span>
                    <strong>${money(p.amount)}</strong>
                  </div>`).join("") : `<div class="cf7-ledger-payment muted">Sin pago registrado</div>`}
              </article>`;
          }).join("") : `<div class="empty text-sm">Aún no hay remociones confirmadas.</div>`}
        </div>
      </section>
    </div>
  `;
}
