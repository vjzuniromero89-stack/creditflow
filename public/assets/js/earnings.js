import { api } from "../api.js";
import { escapeHtml } from "../utils.js";
import { money } from "./collections.js";

/*
  CreditFlow — Ganancias Inteligente

  Esta vista NO suma cuentas que todavía aparecen en el reporte.
  Solo considera ganancia confirmada cuando el backend marca el ítem
  como removed_status === "eliminado".

  El backend ya hace esa detección automáticamente al importar un
  reporte nuevo: compara los ítems anteriores con los actuales.
*/

function categoryName(categories, category) {
  const row = categories.find((c) => c.category === category);
  return row?.label || category || "Otro";
}

function feeFor(categories, category) {
  const row = categories.find((c) => c.category === category);
  return Number(row?.fee || 0);
}

function removalValue(item, categories) {
  const units = Number(item.bureau_count || 1);
  return feeFor(categories, item.category) * units;
}

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

function percent(value, total) {
  if (!total) return 0;
  return Math.max(0, Math.min(100, Math.round((value / total) * 100)));
}

export async function renderEarningsDashboard(container) {
  container.innerHTML = `
    <div class="smart-profit-loading">
      <div class="boot-bar"><span></span></div>
      <div class="text-sm text-muted">Analizando remociones y ganancias…</div>
    </div>
  `;

  const [{ categories, totals, pricing }, { clients }, { credit_items: items }] = await Promise.all([
    api.get("/credit-items/earnings"),
    api.get("/credit-items/earnings-by-client"),
    api.get("/credit-items"),
  ]);

  const allItems = Array.isArray(items) ? items : [];
  const removed = allItems.filter((it) => it.removed_status === "eliminado");
  const active = allItems.filter((it) => it.removed_status !== "eliminado");

  const confirmedProfit = removed.reduce((sum, it) => sum + removalValue(it, categories), 0);
  const potentialProfit = active.reduce((sum, it) => sum + removalValue(it, categories), 0);
  const totalOpportunity = confirmedProfit + potentialProfit;

  const paidProfit = removed
    .filter((it) => it.billing_status === "pagado")
    .reduce((sum, it) => sum + removalValue(it, categories), 0);

  const receivableProfit = Math.max(0, confirmedProfit - paidProfit);

  const removalRate = percent(removed.length, allItems.length);

  const removedByClient = new Map();
  for (const it of removed) {
    const key = String(it.client_id);
    const current = removedByClient.get(key) || {
      client_id: it.client_id,
      client_name: it.client_name || "Cliente",
      removed_count: 0,
      profit: 0,
      paid: 0,
      receivable: 0,
    };
    const amount = removalValue(it, categories);
    current.removed_count += Number(it.bureau_count || 1);
    current.profit += amount;
    if (it.billing_status === "pagado") current.paid += amount;
    else current.receivable += amount;
    removedByClient.set(key, current);
  }

  const clientRows = [...removedByClient.values()]
    .sort((a, b) => b.profit - a.profit);

  const recentRemoved = [...removed]
    .sort((a, b) => {
      const da = new Date(a.updated_at || a.created_at || 0).getTime();
      const db = new Date(b.updated_at || b.created_at || 0).getTime();
      return db - da;
    })
    .slice(0, 12);

  container.innerHTML = `
    <div class="smart-profit">

      <div class="smart-profit-hero">
        <div>
          <div class="smart-profit-eyebrow">Ganancias automáticas</div>
          <h2>Centro inteligente de remociones</h2>
          <p>
            CreditFlow compara cada reporte nuevo con el anterior. Si una colección o ítem negativo
            deja de aparecer en ese buró, se considera una remoción detectada y su tarifa entra
            automáticamente en la ganancia confirmada.
          </p>
        </div>
        <div class="smart-profit-status">
          <span class="smart-profit-dot"></span>
          Detección automática activa
        </div>
      </div>

      <div class="smart-profit-grid">
        <article class="smart-profit-card smart-profit-primary">
          <div class="smart-profit-label">Ganancia confirmada</div>
          <div class="smart-profit-value">${money(confirmedProfit)}</div>
          <div class="smart-profit-meta">
            ${removed.length} ítem(s) ya no aparecen en el reporte
          </div>
        </article>

        <article class="smart-profit-card">
          <div class="smart-profit-label">Por cobrar</div>
          <div class="smart-profit-value">${money(receivableProfit)}</div>
          <div class="smart-profit-meta">
            Ganancia detectada que todavía no está marcada como pagada
          </div>
        </article>

        <article class="smart-profit-card">
          <div class="smart-profit-label">Cobrado</div>
          <div class="smart-profit-value">${money(paidProfit)}</div>
          <div class="smart-profit-meta">
            De las remociones confirmadas
          </div>
        </article>

        <article class="smart-profit-card">
          <div class="smart-profit-label">Potencial</div>
          <div class="smart-profit-value">${money(potentialProfit)}</div>
          <div class="smart-profit-meta">
            No se suma a la ganancia hasta que el ítem desaparezca del reporte
          </div>
        </article>
      </div>

      <div class="smart-profit-progress card">
        <div class="smart-profit-progress-head">
          <div>
            <div class="smart-profit-label">Eficiencia de remoción</div>
            <strong>${removalRate}%</strong>
          </div>
          <div class="text-sm text-muted">
            ${removed.length} removidos de ${allItems.length} ítems rastreados
          </div>
        </div>
        <div class="smart-profit-track">
          <span style="width:${removalRate}%"></span>
        </div>
        <div class="smart-profit-progress-foot">
          <span>Ganado: ${money(confirmedProfit)}</span>
          <span>Oportunidad total: ${money(totalOpportunity)}</span>
        </div>
      </div>

      <div class="smart-profit-columns">
        <section class="card">
          <div class="smart-profit-section-head">
            <div>
              <h3>Remociones detectadas</h3>
              <p class="text-sm text-muted">
                Solo aparecen aquí los ítems que dejaron de reportarse.
              </p>
            </div>
            <span class="count-pill">${removed.length}</span>
          </div>

          ${
            recentRemoved.length
              ? `<div class="smart-removal-list">
                  ${recentRemoved
                    .map((it) => {
                      const amount = removalValue(it, categories);
                      const bureau = it.bureaus || "Buró no especificado";
                      const account = it.account_number ? ` • ${escapeHtml(it.account_number)}` : "";
                      return `
                        <button class="smart-removal-row" data-client-id="${it.client_id}">
                          <div class="smart-removal-icon">✓</div>
                          <div class="smart-removal-main">
                            <div class="smart-removal-title">
                              ${escapeHtml(it.client_name || "Cliente")}
                            </div>
                            <div class="smart-removal-sub">
                              ${escapeHtml(it.creditor_name || categoryName(categories, it.category))}
                              ${account}
                            </div>
                            <div class="smart-removal-tags">
                              <span>${escapeHtml(categoryName(categories, it.category))}</span>
                              <span>${escapeHtml(bureau)}</span>
                              <span>${dateLabel(it.updated_at || it.created_at)}</span>
                            </div>
                          </div>
                          <div class="smart-removal-amount">
                            +${money(amount)}
                            <small>${it.billing_status === "pagado" ? "Cobrado" : "Por cobrar"}</small>
                          </div>
                        </button>
                      `;
                    })
                    .join("")}
                </div>`
              : `<div class="empty">
                  <div class="mark">🔎</div>
                  <h3>Todavía no hay remociones detectadas</h3>
                  <p>
                    Importa un reporte nuevo del cliente. CreditFlow lo comparará con el anterior
                    y empezará a registrar automáticamente lo que haya desaparecido.
                  </p>
                </div>`
          }
        </section>

        <section class="card">
          <div class="smart-profit-section-head">
            <div>
              <h3>Ganancia por cliente</h3>
              <p class="text-sm text-muted">
                Solo dinero generado por remociones confirmadas.
              </p>
            </div>
          </div>

          ${
            clientRows.length
              ? `<div class="smart-client-list">
                  ${clientRows
                    .map(
                      (c) => `
                    <button class="smart-client-row" data-client-id="${c.client_id}">
                      <div>
                        <div class="row-name">${escapeHtml(c.client_name)}</div>
                        <div class="row-sub">${c.removed_count} remoción(es) confirmada(s)</div>
                      </div>
                      <div class="smart-client-money">
                        <strong>${money(c.profit)}</strong>
                        <span>${c.receivable ? `${money(c.receivable)} por cobrar` : "Todo cobrado"}</span>
                      </div>
                    </button>`
                    )
                    .join("")}
                </div>`
              : `<div class="empty">
                  <div class="mark">💰</div>
                  <h3>Sin ganancias confirmadas</h3>
                  <p>La ganancia aparecerá sola cuando una colección desaparezca de un reporte nuevo.</p>
                </div>`
          }
        </section>
      </div>

      <section class="card smart-profit-rates">
        <div class="smart-profit-section-head">
          <div>
            <h3>Tarifas por remoción</h3>
            <p class="text-sm text-muted">
              Estas tarifas determinan cuánto suma CreditFlow cuando detecta una remoción.
            </p>
          </div>
        </div>

        <form id="smart-pricing-form" class="smart-rates-grid">
          ${categories
            .map(
              (c) => `
            <label class="smart-rate-field">
              <span>${escapeHtml(c.label)}</span>
              <div class="smart-rate-input">
                <span>$</span>
                <input
                  type="number"
                  name="fee_${c.category}"
                  min="0"
                  step="0.01"
                  required
                  value="${pricing[`fee_${c.category}`] ?? c.fee ?? 0}"
                />
              </div>
            </label>`
            )
            .join("")}
          <div class="smart-rate-actions">
            <button class="btn btn-primary" type="submit">Guardar tarifas</button>
          </div>
        </form>
      </section>

      <div class="smart-profit-note">
        <strong>Regla principal:</strong>
        una colección que todavía aparece en el reporte nunca se suma como ganancia.
        Solo se suma cuando CreditFlow la detecta como eliminada en una importación posterior.
      </div>
    </div>
  `;

  container.querySelectorAll("[data-client-id]").forEach((el) => {
    el.addEventListener("click", () => {
      const id = el.dataset.clientId;
      if (id) window.__creditflowNavigate(`#/clientes/${id}`);
    });
  });

  container.querySelector("#smart-pricing-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.currentTarget.querySelector('button[type="submit"]');
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Guardando…";
    try {
      const fd = new FormData(e.currentTarget);
      await api.put("/pricing", Object.fromEntries(fd.entries()));
      btn.textContent = "Guardado ✓";
      setTimeout(() => renderEarningsDashboard(container), 500);
    } catch (err) {
      btn.disabled = false;
      btn.textContent = old;
      alert(err.message || "No se pudieron guardar las tarifas.");
    }
  });
}
