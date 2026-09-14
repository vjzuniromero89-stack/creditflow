import { api } from "../api.js";
import { escapeHtml, formatDate } from "../utils.js";
import { money } from "./collections.js";

function methodLabel(v){
  const m={efectivo:"Efectivo",zelle:"Zelle",cashapp:"Cash App",venmo:"Venmo",tarjeta:"Tarjeta",transferencia:"Transferencia",cheque:"Cheque",sin_especificar:"Sin especificar",otro:"Otro"};
  return m[v]||v||"—";
}

export async function renderEarningsV7(container){
  container.innerHTML=`<div class="card">Cargando resultados y cobros…</div>`;
  const [
    {categories=[],totals={}},
    {clients=[]},
    {events=[]},
    paymentResult,
  ]=await Promise.all([
    api.get("/credit-items/earnings"),
    api.get("/credit-items/earnings-by-client"),
    api.get("/removal-events"),
    api.get("/payment-events").catch(()=>({events:[]})),
  ]);
  const payments=paymentResult.events||[];

  container.innerHTML=`
    <section class="cf7-results-hero">
      <div><div class="cf7-eyebrow">Results ledger</div><h2>Resultados y cobros</h2><p>Cada remoción queda congelada como evento histórico y cada pago tiene fecha, método y referencia.</p></div>
      <div class="cf7-results-total"><span>Ganancia confirmada</span><strong>${money(totals.real||0)}</strong><small>${totals.real_count||0} remoción(es)</small></div>
    </section>

    <section class="cf7-dashboard-kpis cf7-results-kpis">
      <button><span>Por cobrar</span><strong>${money(totals.owed||0)}</strong><small>${totals.owed_count||0} pendiente(s)</small></button>
      <button><span>Cobrado</span><strong>${money(totals.paid||0)}</strong><small>${totals.paid_count||0} pagado(s)</small></button>
      <button><span>Potencial</span><strong>${money(totals.pending||0)}</strong><small>${totals.pending_count||0} aún en reporte</small></button>
      <button><span>Reapariciones</span><strong>${totals.reappeared_count||0}</strong><small>historial conservado</small></button>
    </section>

    <div class="cf7-results-layout">
      <section class="card">
        <div class="cf7-section-minihead"><div><h3>Libro de remociones</h3><p>El resultado no desaparece aunque cambie el reporte después.</p></div></div>
        <div class="cf7-removal-ledger">
          ${events.length?events.map((e)=>`
            <button data-client="${e.client_id}" class="cf7-removal-line">
              <div>
                <strong>${escapeHtml(e.creditor_name||"Ítem removido")}</strong>
                <span>${escapeHtml(e.client_name||"")} · ${escapeHtml(e.bureau||"—")} · ${formatDate(e.detected_at)}</span>
              </div>
              <div>
                <strong>${money(e.amount)}</strong>
                <span class="${e.billing_status==="pagado"?"paid":"owed"}">${e.billing_status==="pagado"?"Pagado":"Por cobrar"}</span>
              </div>
            </button>`).join(""):`<div class="empty">Aún no hay remociones.</div>`}
        </div>
      </section>

      <section class="card">
        <div class="cf7-section-minihead"><div><h3>Pagos recientes</h3><p>Fecha y método de cada cobro registrado.</p></div></div>
        <div class="cf7-payment-list">
          ${payments.length?payments.slice(0,30).map((p)=>`
            <button data-client="${p.client_id}">
              <div><strong>${escapeHtml(p.client_name||"Cliente")}</strong><span>${escapeHtml(p.creditor_name||"Remoción")} · ${methodLabel(p.payment_method)}</span></div>
              <div><strong>${money(p.amount)}</strong><span>${formatDate(p.created_at)}</span></div>
            </button>`).join(""):`<div class="empty">Todavía no hay pagos registrados con el nuevo historial.</div>`}
        </div>
      </section>
    </div>

    <div class="cf7-results-layout lower">
      <section class="card">
        <div class="cf7-section-minihead"><div><h3>Por cliente</h3><p>Resultado confirmado, cobrado y pendiente.</p></div></div>
        <div class="cf7-client-results">
          ${clients.length?clients.map((c)=>`
            <button data-client="${c.client_id}">
              <div><strong>${escapeHtml(c.client_name)}</strong><span>${c.real_count||0} remoción(es) · ${c.pending_count||0} potencial(es)</span></div>
              <div><strong>${money(c.real_amount)}</strong><span>${c.owed_amount?`${money(c.owed_amount)} por cobrar`:"Todo cobrado"}</span></div>
            </button>`).join(""):`<div class="empty">Sin movimientos.</div>`}
        </div>
      </section>

      <section class="card">
        <div class="cf7-section-minihead"><div><h3>Por categoría</h3><p>Qué tipo de negativo produce más resultados.</p></div></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Categoría</th><th class="cell-num">Removidos</th><th class="cell-num">Real</th><th class="cell-num">Por cobrar</th><th class="cell-num">Potencial</th></tr></thead>
            <tbody>
              ${categories.filter(c=>c.real_count||c.pending_count).map(c=>`
                <tr><td class="row-name">${escapeHtml(c.label||c.category)}</td><td class="cell-num">${c.real_count||0}</td><td class="cell-num">${money(c.real_amount)}</td><td class="cell-num">${money(c.owed_amount)}</td><td class="cell-num">${money(c.pending_amount)}</td></tr>
              `).join("")||`<tr><td colspan="5" class="text-muted">Sin movimientos.</td></tr>`}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  `;

  container.querySelectorAll("[data-client]").forEach((b)=>b.addEventListener("click",()=>window.__creditflowNavigate(`#/clientes/${b.dataset.client}`)));
}
