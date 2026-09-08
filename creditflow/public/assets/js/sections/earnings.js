import { api } from "../api.js";
import { toast } from "../toast.js";
import { escapeHtml } from "../utils.js";
import { money } from "./collections.js";

/* ------------------------------------------------------------------ */
/* Sección "Ganancias" — resumen financiero global (todos los clientes) */
/* Reemplaza la antigua vista "Colecciones" (lista de ítems cruda);      */
/* los ítems de colección en sí solo se ven ahora dentro de la ficha    */
/* de cada cliente. Aquí se ve, con tu inteligencia de negocio en       */
/* mente: cuánto ganarías SI se borran los ítems que todavía están en   */
/* el reporte (ganancia pendiente), y cuánto YA ganaste de verdad       */
/* porque el sistema detectó que ya se borraron (ganancia real),        */
/* con su desglose de lo cobrado vs. lo que todavía te deben.           */
/* ------------------------------------------------------------------ */
const REMOVED_STATUS_LABEL = { activo: "En el reporte (pendiente)", eliminado: "Borrado (real)" };
const BILLING_STATUS_LABEL = { pagado: "Cobrado", pendiente: "Por cobrar" };

export async function renderEarningsDashboard(container) {
  container.innerHTML = `<div class="text-sm text-muted">Cargando...</div>`;

  const [{ categories, totals, pricing }, { clients }, { credit_items: items }] = await Promise.all([
    api.get("/credit-items/earnings"),
    api.get("/credit-items/earnings-by-client"),
    api.get("/credit-items"), // TODOS los ítems de TODOS los clientes, sin filtrar por client_id
  ]);

  const rows = categories.filter((c) => c.pending_count > 0 || c.real_count > 0);
  const categoryLabel = Object.fromEntries(categories.map((c) => [c.category, c.label]));
  const categoryFee = Object.fromEntries(categories.map((c) => [c.category, c.fee]));
  // Cuántos burós distintos reportan cada ítem (ya viene calculado por ítem desde el backend) —
  // un ítem en Equifax + TransUnion + Experian son 3 remociones cobrables, no 1.
  const unitsFor = (arr) => arr.reduce((sum, it) => sum + (it.bureau_count || 1), 0);
  const mergedItems = items.filter((it) => it.bureau_count > 1);

  container.innerHTML = `
    ${
      mergedItems.length
        ? `<div class="card" style="border-color:var(--amber);margin-bottom:16px">
            <div class="flex gap-8" style="align-items:center;justify-content:space-between;flex-wrap:wrap">
              <div>
                <div style="font-weight:700">⚠️ ${mergedItems.length} ítem(s) todavía tienen varios burós juntos en una sola fila</div>
                <div class="text-sm text-muted" style="margin-top:2px">Son de antes de esta actualización. Divídelos en ítems individuales (uno por buró) para que se cuenten y se vean exactamente igual que los nuevos, y puedas marcar cada buró como borrado/pagado por separado.</div>
              </div>
              <button class="btn btn-primary btn-sm" id="split-multibureau-btn" style="white-space:nowrap">Dividir ahora</button>
            </div>
          </div>`
        : ""
    }
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px;margin-bottom:20px">
      <div class="card" style="padding:14px">
        <div class="text-sm text-muted">Total de ítems</div>
        <div class="stat-value" style="font-size:21px">${totals.total_count}</div>
        <div class="text-sm text-muted" style="margin-top:2px">${totals.pending_count} pendiente(s) + ${totals.real_count} ya borrado(s) — de todas las categorías, todos los clientes</div>
      </div>
      <div class="card" style="padding:14px">
        <div class="text-sm text-muted">Ganancia pendiente</div>
        <div class="stat-value" style="font-size:21px;color:var(--amber)">${money(totals.pending)}</div>
        <div class="text-sm text-muted" style="margin-top:2px">${totals.pending_count} ítem(s) que aún están en el reporte — lo ganarías SI se logran borrar</div>
      </div>
      <div class="card" style="padding:14px">
        <div class="text-sm text-muted">Ganancia real</div>
        <div class="stat-value" style="font-size:21px;color:var(--green)">${money(totals.real)}</div>
        <div class="text-sm text-muted" style="margin-top:2px">${totals.real_count} ítem(s) que el sistema ya detectó borrados del reporte</div>
      </div>
      <div class="card" style="padding:14px">
        <div class="text-sm text-muted">Cobrado</div>
        <div class="stat-value" style="font-size:21px;color:var(--green)">${money(totals.paid)}</div>
        <div class="text-sm text-muted" style="margin-top:2px">${totals.paid_count} ítem(s) — de la ganancia real, lo que ya marcaste pagado</div>
      </div>
      <div class="card" style="padding:14px">
        <div class="text-sm text-muted">Por cobrar</div>
        <div class="stat-value" style="font-size:21px;color:var(--amber)">${money(totals.owed)}</div>
        <div class="text-sm text-muted" style="margin-top:2px">${totals.owed_count} ítem(s) — de la ganancia real, lo que falta que el cliente te pague</div>
      </div>
    </div>

    <div class="card" style="margin-bottom:20px">
      <h3 style="font-size:15px;margin-bottom:6px">Tarifas de cobro</h3>
      <p class="text-sm text-muted" style="margin-bottom:14px">Cuánto cobras por cada tipo de ítem que se logre borrar del reporte de crédito — todas las categorías cuentan para la ganancia, no solo colecciones. Cambia y guarda para recalcular arriba.</p>
      <form id="pricing-form" class="form-grid">
        ${categories
          .map((c) => `<div class="field"><label>${escapeHtml(c.label)}</label><input type="number" name="fee_${c.category}" min="0" step="0.01" required value="${pricing[`fee_${c.category}`]}" /></div>`)
          .join("")}
        <div class="form-actions" style="grid-column:1/-1"><button class="btn btn-primary btn-sm" type="submit">Guardar tarifas</button></div>
      </form>
    </div>

    <div class="section-head" style="margin-top:4px">
      <h2 style="font-size:16px">Por categoría</h2>
    </div>
    ${
      rows.length
        ? `
      <div class="table-wrap" style="margin-bottom:24px">
        <table>
          <thead><tr><th>Categoría</th><th class="cell-num">Tarifa</th><th class="cell-num">Total ítems</th><th class="cell-num">Pendiente (en reporte)</th><th class="cell-num">Real (borrado)</th><th class="cell-num">Cobrado</th><th class="cell-num">Por cobrar</th></tr></thead>
          <tbody>
            ${rows
              .map(
                (c) => `
              <tr>
                <td class="row-name">${escapeHtml(c.label)}</td>
                <td class="row-sub cell-num">${money(c.fee)}</td>
                <td class="cell-num"><span class="count-pill">${c.pending_count + c.real_count}</span></td>
                <td class="row-sub cell-num">${c.pending_count} · ${money(c.pending_amount)}</td>
                <td class="cell-num"><strong>${c.real_count} · ${money(c.real_amount)}</strong></td>
                <td class="row-sub cell-num" style="color:var(--green)">${money(c.paid_amount)}</td>
                <td class="row-sub cell-num" style="color:var(--amber)">${money(c.owed_amount)}</td>
              </tr>`
              )
              .join("")}
          </tbody>
          <tfoot>
            <tr style="font-weight:700;border-top:2px solid var(--border)">
              <td class="row-name">TOTAL</td>
              <td class="row-sub cell-num">—</td>
              <td class="cell-num"><span class="count-pill">${totals.total_count}</span></td>
              <td class="row-sub cell-num">${totals.pending_count} · ${money(totals.pending)}</td>
              <td class="cell-num">${totals.real_count} · ${money(totals.real)}</td>
              <td class="cell-num" style="color:var(--green)">${money(totals.paid)}</td>
              <td class="cell-num" style="color:var(--amber)">${money(totals.owed)}</td>
            </tr>
          </tfoot>
        </table>
      </div>`
        : `<div class="empty" style="margin-bottom:24px"><div class="mark">💰</div><h3>Todavía no hay nada que cobrar</h3><p>Importa reportes de crédito en la ficha de tus clientes — en cuanto haya colecciones, pagos tardíos o inquiries, aparecen aquí.</p></div>`
    }

    <div class="section-head">
      <h2 style="font-size:16px">Por cliente</h2>
    </div>
    ${
      clients.length
        ? `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Cliente</th><th class="cell-num">Total ítems</th><th class="cell-num">Ganancia real</th><th class="cell-num">Cobrado</th><th class="cell-num">Por cobrar</th><th class="cell-num">Ganancia pendiente</th></tr></thead>
          <tbody>
            ${clients
              .map(
                (c) => `
              <tr data-client-id="${c.client_id}" style="cursor:pointer">
                <td class="row-name">${escapeHtml(c.client_name)}</td>
                <td class="cell-num"><span class="count-pill">${c.pending_count + c.real_count}</span></td>
                <td class="cell-num" style="color:var(--green)"><strong>${c.real_count} · ${money(c.real_amount)}</strong></td>
                <td class="row-sub cell-num" style="color:var(--green)">${money(c.paid_amount)}</td>
                <td class="row-sub cell-num" style="color:var(--amber)">${money(c.owed_amount)}</td>
                <td class="row-sub cell-num" style="color:var(--amber)">${c.pending_count} · ${money(c.pending_amount)}</td>
              </tr>`
              )
              .join("")}
          </tbody>
          <tfoot>
            <tr style="font-weight:700;border-top:2px solid var(--border)">
              <td class="row-name">TOTAL</td>
              <td class="cell-num"><span class="count-pill">${totals.total_count}</span></td>
              <td class="cell-num" style="color:var(--green)">${totals.real_count} · ${money(totals.real)}</td>
              <td class="cell-num" style="color:var(--green)">${money(totals.paid)}</td>
              <td class="cell-num" style="color:var(--amber)">${money(totals.owed)}</td>
              <td class="cell-num" style="color:var(--amber)">${totals.pending_count} · ${money(totals.pending)}</td>
            </tr>
          </tfoot>
        </table>
      </div>`
        : `<div class="empty"><div class="mark">👤</div><h3>Sin ganancias todavía por cliente</h3><p>Aparecerán aquí en cuanto algún cliente tenga colecciones, pagos tardíos o inquiries.</p></div>`
    }

    <div class="section-head" style="margin-top:24px">
      <div>
        <h2 style="font-size:16px">Detalle — todos los ítems</h2>
        <p class="text-sm text-muted" style="margin-top:2px">Cada ítem individual (de todos tus clientes) con su categoría, estado y el precio que le corresponde — para que puedas contarlos y verificar que ninguno falte. Un ítem que reporta en varios burós (ej. Equifax + TransUnion + Experian) cuenta como una remoción independiente por cada uno, con su tarifa completa cada vez.</p>
      </div>
    </div>
    <div class="tag-row" id="detail-category-filters" style="margin-bottom:10px">
      <button class="pill-filter active" data-cat="">Todas (${items.length} ítem(s) · ${unitsFor(items)} remoción(es))</button>
      ${categories
        .map((c) => {
          const catItems = items.filter((it) => it.category === c.category);
          const n = unitsFor(catItems);
          return catItems.length ? `<button class="pill-filter" data-cat="${c.category}">${escapeHtml(c.label)} (${catItems.length} ítem(s) · ${n} remoción(es))</button>` : "";
        })
        .join("")}
    </div>
    <div class="table-wrap"><div id="detail-items-table"></div></div>
  `;

  container.querySelectorAll("tbody tr[data-client-id]").forEach((tr) =>
    tr.addEventListener("click", () => window.__creditflowNavigate(`#/clientes/${tr.dataset.clientId}`))
  );

  function drawDetailTable(filterCategory) {
    const box = container.querySelector("#detail-items-table");
    const filtered = filterCategory ? items.filter((it) => it.category === filterCategory) : items;
    if (!filtered.length) {
      box.innerHTML = `<div class="empty text-sm">Sin ítems en esta categoría.</div>`;
      return;
    }
    box.innerHTML = `
      <table>
        <thead><tr><th>Cliente</th><th>Categoría</th><th>Acreedor</th><th>Burós</th><th>Cartas</th><th>Estado</th><th class="cell-num">Precio</th></tr></thead>
        <tbody>
          ${filtered
            .map((it) => {
              const fee = categoryFee[it.category] || 0;
              const n = it.bureau_count || 1;
              const statusLabel =
                it.removed_status === "eliminado"
                  ? `${REMOVED_STATUS_LABEL.eliminado} · ${BILLING_STATUS_LABEL[it.billing_status] || it.billing_status}`
                  : REMOVED_STATUS_LABEL.activo;
              return `
              <tr data-client-id="${it.client_id}" style="cursor:pointer">
                <td class="row-name">${escapeHtml(it.client_name)}</td>
                <td class="row-sub">${escapeHtml(categoryLabel[it.category] || it.category)}</td>
                <td class="row-sub">${escapeHtml(it.creditor_name) || "—"}</td>
                <td class="row-sub">${escapeHtml(it.bureaus) || "—"}</td>
                <td class="row-sub">${it.letters_count ? `${it.letters_count} carta(s)` : "Sin disputar"}</td>
                <td class="row-sub" style="color:${it.removed_status === "eliminado" ? "var(--green)" : "var(--amber)"}">${statusLabel}</td>
                <td class="cell-num"><strong>${money(fee * n)}</strong>${n > 1 ? `<div class="text-sm text-muted">${n} × ${money(fee)}</div>` : ""}</td>
              </tr>`;
            })
            .join("")}
        </tbody>
      </table>
    `;
    box.querySelectorAll("tbody tr[data-client-id]").forEach((tr) =>
      tr.addEventListener("click", () => window.__creditflowNavigate(`#/clientes/${tr.dataset.clientId}`))
    );
  }

  drawDetailTable("");
  container.querySelectorAll("#detail-category-filters .pill-filter").forEach((btn) =>
    btn.addEventListener("click", () => {
      container.querySelectorAll("#detail-category-filters .pill-filter").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      drawDetailTable(btn.dataset.cat);
    })
  );

  container.querySelector("#pricing-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api.put("/pricing", Object.fromEntries(fd.entries()));
      toast("Tarifas actualizadas", "success");
      await renderEarningsDashboard(container);
    } catch (err) {
      toast(err.message, "error");
    }
  });

  const splitBtn = container.querySelector("#split-multibureau-btn");
  if (splitBtn) {
    splitBtn.addEventListener("click", async () => {
      splitBtn.disabled = true;
      const orig = splitBtn.innerHTML;
      splitBtn.innerHTML = "Dividiendo…";
      try {
        const r = await api.post("/credit-items/split-multibureau", {});
        toast(`${r.items_split} ítem(s) divididos — ${r.rows_created} fila(s) nueva(s) creadas`, "success");
        await renderEarningsDashboard(container);
      } catch (err) {
        toast(err.message, "error");
        splitBtn.disabled = false;
        splitBtn.innerHTML = orig;
      }
    });
  }
}
