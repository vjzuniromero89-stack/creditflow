import { api } from "../api.js";
import { icon } from "../icons.js";
import { toast } from "../toast.js";
import { openModal, confirmDialog } from "../modal.js";
import { escapeHtml, formatDate } from "../utils.js";
import {
  openCreditItemModal,
  openGenerateLetterModal,
  runSmartGenerate,
  money,
} from "./collections.js";

const CATEGORY_META = {
  coleccion: "Colecciones",
  charge_off: "Charge-offs",
  pago_tardio: "Pagos tardíos",
  liquidada: "Cuentas liquidadas",
  repossesion: "Repossession",
  foreclosure: "Foreclosure",
  bancarrota: "Bancarrota",
  inquiry: "Inquiries",
  otro: "Otros",
};

const CATEGORY_ICON = {
  coleccion: "C",
  charge_off: "CO",
  pago_tardio: "30+",
  liquidada: "S",
  repossesion: "R",
  foreclosure: "F",
  bancarrota: "B",
  inquiry: "I",
  otro: "•",
};

function eventForItem(events, itemId) {
  return (events || []).find((e) => String(e.credit_item_id) === String(itemId));
}

function paymentForRemoval(events, removalId) {
  return (events || []).filter((e) => String(e.removal_event_id) === String(removalId));
}

function statusText(item, removal) {
  if (item.removed_status === "eliminado") {
    if (removal?.status === "reappeared") return "Removido · reapareció después";
    return removal?.billing_status === "pagado" ? "Removido · pagado" : "Removido · por cobrar";
  }
  return item.is_disputed ? "En disputa" : "En reporte";
}

function statusClass(item, removal) {
  if (item.removed_status === "eliminado") {
    if (removal?.status === "reappeared") return "reappeared";
    return removal?.billing_status === "pagado" ? "paid" : "removed";
  }
  return item.is_disputed ? "disputed" : "active";
}

function paymentMethodLabel(method) {
  const map = {
    efectivo: "Efectivo",
    zelle: "Zelle",
    cashapp: "Cash App",
    venmo: "Venmo",
    tarjeta: "Tarjeta",
    transferencia: "Transferencia",
    cheque: "Cheque",
    sin_especificar: "Sin especificar",
    otro: "Otro",
  };
  return map[method] || method || "—";
}

async function openPaymentModal({ removal, item, onSaved }) {
  const { close, body } = openModal({
    title: `Registrar pago — ${item.creditor_name || "ítem removido"}`,
    wide: true,
    bodyHtml: `
      <form id="cf7-payment-form">
        <div class="cf7-payment-summary">
          <div><span>Cliente paga por esta remoción</span><strong>${money(removal.amount)}</strong></div>
          <div><span>Buró</span><strong>${escapeHtml(removal.bureau || item.bureaus || "—")}</strong></div>
          <div><span>Detectada</span><strong>${formatDate(removal.detected_at)}</strong></div>
        </div>
        <div class="form-grid">
          <div class="field">
            <label>Monto recibido</label>
            <input type="number" step="0.01" min="0.01" name="amount" value="${Number(removal.amount || 0).toFixed(2)}" required />
          </div>
          <div class="field">
            <label>Método de pago</label>
            <select name="payment_method" required>
              <option value="zelle">Zelle</option>
              <option value="efectivo">Efectivo</option>
              <option value="cashapp">Cash App</option>
              <option value="venmo">Venmo</option>
              <option value="tarjeta">Tarjeta</option>
              <option value="transferencia">Transferencia bancaria</option>
              <option value="cheque">Cheque</option>
              <option value="otro">Otro</option>
            </select>
          </div>
          <div class="field" style="grid-column:1/-1">
            <label>Referencia / confirmación</label>
            <input type="text" name="payment_reference" placeholder="Ej. Zelle confirmation, últimos 4, recibo..." />
          </div>
          <div class="field" style="grid-column:1/-1">
            <label>Notas del pago</label>
            <textarea name="notes" placeholder="Opcional"></textarea>
          </div>
        </div>
        <div class="form-actions">
          <button class="btn btn-ghost" type="button" data-close>Cancelar</button>
          <button class="btn btn-primary" type="submit">${icon("check")} Registrar pago</button>
        </div>
      </form>
    `,
  });

  body.querySelector("[data-close]").addEventListener("click", close);
  body.querySelector("#cf7-payment-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.submitter;
    btn.disabled = true;
    const fd = new FormData(e.target);
    try {
      await api.post(`/removal-events/${removal.id}/payment`, {
        amount: Number(fd.get("amount")),
        payment_method: fd.get("payment_method"),
        payment_reference: fd.get("payment_reference"),
        notes: fd.get("notes"),
      });
      toast("Pago registrado en el historial", "success");
      close();
      await onSaved();
    } catch (err) {
      toast(err.message, "error");
      btn.disabled = false;
    }
  });
}

function renderItemDetail(item, removal, payments) {
  const pRows = payments.length
    ? payments.map((p) => `
      <div class="cf7-mini-ledger-row">
        <div><strong>${money(p.amount)}</strong><span>${paymentMethodLabel(p.payment_method)}</span></div>
        <div><strong>${formatDate(p.created_at)}</strong><span>${escapeHtml(p.payment_reference || "Sin referencia")}</span></div>
      </div>
    `).join("")
    : `<div class="text-sm text-muted">Sin pagos registrados.</div>`;

  return `
    <div class="cf7-item-detail-grid">
      <div><span>Cuenta</span><strong>${escapeHtml(item.account_number || "—")}</strong></div>
      <div><span>Saldo reportado</span><strong>${escapeHtml(item.balance || "—")}</strong></div>
      <div><span>Estado del reporte</span><strong>${escapeHtml(item.status_raw || "—")}</strong></div>
      <div><span>Buró</span><strong>${escapeHtml(item.bureaus || "—")}</strong></div>
      <div><span>Reportado</span><strong>${escapeHtml(item.date_reported || "—")}</strong></div>
      <div><span>Abierto</span><strong>${escapeHtml(item.date_opened || "—")}</strong></div>
      ${removal ? `
        <div><span>Remoción detectada</span><strong>${formatDate(removal.detected_at)}</strong></div>
        <div><span>Valor congelado</span><strong>${money(removal.amount)}</strong></div>
      ` : ""}
    </div>
    ${item.notes ? `<div class="cf7-item-notes"><span>Notas</span><p>${escapeHtml(item.notes)}</p></div>` : ""}
    ${removal ? `
      <div class="cf7-payment-ledger">
        <div class="cf7-mini-head"><strong>Historial de cobro</strong><span>${removal.billing_status === "pagado" ? "Pagado" : "Pendiente"}</span></div>
        ${pRows}
      </div>
    ` : ""}
  `;
}

export async function renderClientCreditItemsV7(container, clientId, earningsBox) {
  container.innerHTML = `<div class="card">Cargando negativos…</div>`;

  const [
    { credit_items = [] },
    removalResult,
    paymentResult,
  ] = await Promise.all([
    api.get(`/credit-items?client_id=${clientId}`),
    api.get(`/removal-events?client_id=${clientId}`).catch(() => ({ events: [] })),
    api.get(`/payment-events?client_id=${clientId}`).catch(() => ({ events: [] })),
  ]);

  const removalEvents = removalResult.events || [];
  const paymentEvents = paymentResult.events || [];

  if (!credit_items.length) {
    container.innerHTML = `
      <div class="empty">
        <div class="mark">◎</div>
        <h3>Sin negativos registrados</h3>
        <p>Importa un reporte de crédito o agrega un ítem manualmente.</p>
      </div>`;
    return;
  }

  const active = credit_items.filter((i) => i.removed_status !== "eliminado");
  const removed = credit_items.filter((i) => i.removed_status === "eliminado");
  const owed = removed.filter((i) => {
    const ev = eventForItem(removalEvents, i.id);
    return ev && ev.billing_status !== "pagado";
  });
  const paid = removed.filter((i) => {
    const ev = eventForItem(removalEvents, i.id);
    return ev?.billing_status === "pagado";
  });

  const groups = Object.entries(CATEGORY_META)
    .map(([key, label]) => ({
      key,
      label,
      items: credit_items.filter((i) => i.category === key),
    }))
    .filter((g) => g.items.length);

  container.innerHTML = `
    <div class="cf7-negative-summary">
      <button class="cf7-filter-card active" data-filter="all"><span>${credit_items.length}</span><strong>Todos</strong><small>negativos</small></button>
      <button class="cf7-filter-card" data-filter="active"><span>${active.length}</span><strong>En reporte</strong><small>requieren trabajo</small></button>
      <button class="cf7-filter-card" data-filter="removed"><span>${removed.length}</span><strong>Removidos</strong><small>resultado confirmado</small></button>
      <button class="cf7-filter-card" data-filter="owed"><span>${owed.length}</span><strong>Por cobrar</strong><small>remociones pendientes</small></button>
      <button class="cf7-filter-card" data-filter="paid"><span>${paid.length}</span><strong>Pagados</strong><small>cobro registrado</small></button>
    </div>

    <div class="cf7-negative-groups">
      ${groups.map((group, gi) => {
        const groupRemoved = group.items.filter((i) => i.removed_status === "eliminado").length;
        return `
          <section class="cf7-negative-group" data-category="${group.key}">
            <button class="cf7-negative-group-head" type="button" aria-expanded="${gi === 0 ? "true" : "false"}">
              <div class="cf7-cat-icon">${CATEGORY_ICON[group.key] || "•"}</div>
              <div>
                <strong>${escapeHtml(group.label)}</strong>
                <span>${group.items.length} ítem(s) · ${groupRemoved} removido(s)</span>
              </div>
              <div class="cf7-group-progress"><span style="width:${group.items.length ? Math.round(groupRemoved/group.items.length*100) : 0}%"></span></div>
              <div class="cf7-chevron">⌄</div>
            </button>
            <div class="cf7-negative-group-body ${gi === 0 ? "open" : ""}">
              ${group.items.map((item) => {
                const removal = eventForItem(removalEvents, item.id);
                const payments = removal ? paymentForRemoval(paymentEvents, removal.id) : [];
                const cls = statusClass(item, removal);
                return `
                  <article class="cf7-credit-item state-${cls}" data-item="${item.id}"
                    data-filter-active="${item.removed_status !== "eliminado"}"
                    data-filter-removed="${item.removed_status === "eliminado"}"
                    data-filter-owed="${item.removed_status === "eliminado" && removal?.billing_status !== "pagado"}"
                    data-filter-paid="${item.removed_status === "eliminado" && removal?.billing_status === "pagado"}">
                    <button class="cf7-credit-item-main" type="button" data-expand="${item.id}">
                      <div class="cf7-item-state-dot"></div>
                      <div class="cf7-item-name">
                        <strong>${escapeHtml(item.creditor_name || "Ítem sin nombre")}</strong>
                        <span>${escapeHtml(item.account_number || "Sin cuenta")} · ${escapeHtml(item.bureaus || "Buró no indicado")}</span>
                      </div>
                      <div class="cf7-item-balance">
                        <span>Saldo</span>
                        <strong>${escapeHtml(item.balance || "—")}</strong>
                      </div>
                      <div class="cf7-item-status">
                        <span>${statusText(item, removal)}</span>
                        ${removal ? `<small>${formatDate(removal.detected_at)}</small>` : `<small>${item.letters_count || 0} carta(s)</small>`}
                      </div>
                      <div class="cf7-chevron">⌄</div>
                    </button>
                    <div class="cf7-credit-item-detail" id="cf7-item-detail-${item.id}">
                      ${renderItemDetail(item, removal, payments)}
                      <div class="cf7-item-actions">
                        ${item.removed_status !== "eliminado" ? `
                          <button class="btn btn-primary btn-sm" data-auto="${item.id}">${icon("spark")} Estrategia</button>
                          <button class="btn btn-ghost btn-sm" data-manual="${item.id}">Carta manual</button>
                        ` : ""}
                        ${removal && removal.billing_status !== "pagado" ? `
                          <button class="btn btn-primary btn-sm" data-payment="${item.id}">${icon("dollar")} Registrar pago</button>
                        ` : ""}
                        <button class="btn btn-ghost btn-sm" data-edit="${item.id}">${icon("edit")} Editar</button>
                        <button class="btn btn-danger btn-sm" data-del="${item.id}">${icon("trash")} Eliminar</button>
                      </div>
                    </div>
                  </article>`;
              }).join("")}
            </div>
          </section>
        `;
      }).join("")}
    </div>
  `;

  function applyFilter(filter) {
    container.querySelectorAll(".cf7-credit-item").forEach((el) => {
      const show =
        filter === "all" ||
        (filter === "active" && el.dataset.filterActive === "true") ||
        (filter === "removed" && el.dataset.filterRemoved === "true") ||
        (filter === "owed" && el.dataset.filterOwed === "true") ||
        (filter === "paid" && el.dataset.filterPaid === "true");
      el.hidden = !show;
    });
    container.querySelectorAll(".cf7-negative-group").forEach((group) => {
      const visible = [...group.querySelectorAll(".cf7-credit-item")].some((i) => !i.hidden);
      group.hidden = !visible;
      if (visible && filter !== "all") {
        group.querySelector(".cf7-negative-group-body")?.classList.add("open");
        group.querySelector(".cf7-negative-group-head")?.setAttribute("aria-expanded", "true");
      }
    });
  }

  container.querySelectorAll(".cf7-filter-card").forEach((btn) => {
    btn.addEventListener("click", () => {
      container.querySelectorAll(".cf7-filter-card").forEach((x) => x.classList.remove("active"));
      btn.classList.add("active");
      applyFilter(btn.dataset.filter);
    });
  });

  container.querySelectorAll(".cf7-negative-group-head").forEach((btn) => {
    btn.addEventListener("click", () => {
      const body = btn.nextElementSibling;
      const open = body.classList.toggle("open");
      btn.setAttribute("aria-expanded", String(open));
    });
  });

  container.querySelectorAll("[data-expand]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.getElementById(`cf7-item-detail-${btn.dataset.expand}`)?.classList.toggle("open");
      btn.closest(".cf7-credit-item")?.classList.toggle("expanded");
    });
  });

  container.querySelectorAll("[data-auto]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const item = credit_items.find((x) => String(x.id) === String(btn.dataset.auto));
      btn.disabled = true;
      const old = btn.innerHTML;
      btn.textContent = "Analizando…";
      await runSmartGenerate({
        items: [item],
        clientId,
        onSaved: () => renderClientCreditItemsV7(container, clientId, earningsBox),
      });
      btn.disabled = false;
      btn.innerHTML = old;
    });
  });

  container.querySelectorAll("[data-manual]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = credit_items.find((x) => String(x.id) === String(btn.dataset.manual));
      openGenerateLetterModal({
        item,
        onSaved: () => renderClientCreditItemsV7(container, clientId, earningsBox),
      });
    });
  });

  container.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = credit_items.find((x) => String(x.id) === String(btn.dataset.edit));
      openCreditItemModal({
        existing: item,
        clientId,
        onSaved: () => renderClientCreditItemsV7(container, clientId, earningsBox),
      });
    });
  });

  container.querySelectorAll("[data-payment]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = credit_items.find((x) => String(x.id) === String(btn.dataset.payment));
      const removal = eventForItem(removalEvents, item.id);
      if (!removal) return toast("No se encontró el evento histórico de remoción.", "error");
      openPaymentModal({
        removal,
        item,
        onSaved: async () => {
          await renderClientCreditItemsV7(container, clientId, earningsBox);
          if (earningsBox) {
            // El panel de ganancias original se actualizará al reabrir/re-renderizar el expediente.
            earningsBox.dataset.needsRefresh = "true";
          }
        },
      });
    });
  });

  container.querySelectorAll("[data-del]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const ok = await confirmDialog("¿Eliminar este ítem? Las cartas ya creadas no se eliminarán.");
      if (!ok) return;
      try {
        await api.del(`/credit-items/${btn.dataset.del}`);
        toast("Ítem eliminado", "success");
        await renderClientCreditItemsV7(container, clientId, earningsBox);
      } catch (err) {
        toast(err.message, "error");
      }
    });
  });
}
