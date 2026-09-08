import { api } from "../api.js";
import { icon } from "../icons.js";
import { openModal, confirmDialog } from "../modal.js";
import { toast } from "../toast.js";
import { escapeHtml, formatDate, todayLong } from "../utils.js";
import { renderTemplate, formatDobForLetter } from "./letters.js";

export const CATEGORY_META = {
  coleccion: { label: "Colección" },
  charge_off: { label: "Charge-off" },
  pago_tardio: { label: "Pago tardío" },
  liquidada: { label: "Liquidada (settled)" },
  repossesion: { label: "Repossesión" },
  foreclosure: { label: "Foreclosure" },
  bancarrota: { label: "Bancarrota" },
  inquiry: { label: "Inquiry" },
  otro: { label: "Otro" },
};

function categoryBadge(category) {
  const meta = CATEGORY_META[category] || { label: category || "—" };
  return `<span class="badge badge-${category}">${escapeHtml(meta.label)}</span>`;
}

// Textos para cuando un ítem se detecta borrado del reporte (disputa exitosa) o se marca pagado
// — para "Colección" se usa exactamente esa palabra como pidió el usuario; para las demás
// categorías se arma un texto análogo con la misma etiqueta.
const REMOVED_LABEL = {
  coleccion: "Colección borrada",
  charge_off: "Charge-off borrado",
  pago_tardio: "Pago tardío borrado",
  liquidada: "Liquidada — borrada",
  repossesion: "Repossesión borrada",
  foreclosure: "Foreclosure borrado",
  bancarrota: "Bancarrota borrada",
  inquiry: "Inquiry borrado",
  otro: "Ítem borrado",
};
const PAID_LABEL = {
  coleccion: "Colección pagada",
  charge_off: "Charge-off pagado",
  pago_tardio: "Pago tardío pagado",
  liquidada: "Liquidada — pagada",
  repossesion: "Repossesión pagada",
  foreclosure: "Foreclosure pagado",
  bancarrota: "Bancarrota pagada",
  inquiry: "Inquiry pagado",
  otro: "Ítem pagado",
};

function removalStatusCell(item) {
  if (item.removed_status !== "eliminado") {
    return `<span class="text-sm text-muted">En el reporte</span>`;
  }
  const removedLabel = REMOVED_LABEL[item.category] || "Eliminado del reporte";
  if (item.billing_status === "pagado") {
    return `
      <div class="flex gap-6" style="flex-direction:column;align-items:flex-start">
        <span class="badge badge-eliminada">${escapeHtml(removedLabel)}</span>
        <span class="badge badge-pagado">${escapeHtml(PAID_LABEL[item.category] || "Pagado")}</span>
        <button class="btn btn-ghost btn-sm" data-mark-pending="${item.id}" style="padding:2px 8px">Marcar pendiente</button>
      </div>`;
  }
  return `
    <div class="flex gap-6" style="flex-direction:column;align-items:flex-start">
      <span class="badge badge-eliminada">${escapeHtml(removedLabel)}</span>
      <span class="badge badge-pendiente_cobro">Pendiente de cobro</span>
      <button class="btn btn-primary btn-sm" data-mark-paid="${item.id}" style="padding:2px 8px">Marcar pagado</button>
    </div>`;
}

function wireBillingButtons(container, onSaved) {
  container.querySelectorAll("[data-mark-paid]").forEach((btn) =>
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      try {
        await api.put(`/credit-items/${btn.dataset.markPaid}/billing-status`, { billing_status: "pagado" });
        toast("Marcado como pagado", "success");
        onSaved();
      } catch (err) {
        toast(err.message, "error");
      }
    })
  );
  container.querySelectorAll("[data-mark-pending]").forEach((btn) =>
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      try {
        await api.put(`/credit-items/${btn.dataset.markPending}/billing-status`, { billing_status: "pendiente" });
        toast("Marcado como pendiente de cobro", "success");
        onSaved();
      } catch (err) {
        toast(err.message, "error");
      }
    })
  );
}

export function money(n) {
  return `$${(Number(n) || 0).toFixed(2)}`;
}

/* ------------------------------------------------------------------ */
/* Panel de ganancias de UN cliente — se muestra dentro de su ficha.    */
/* "Pendiente" = ítems aún en el reporte (ganancia potencial si se      */
/* borran). "Real" = ítems ya detectados borrados (ya pasó), con su      */
/* desglose de cobrado / por cobrar. El resumen global vive en          */
/* la sección "Ganancias" (ver earnings.js).                            */
/* ------------------------------------------------------------------ */
export async function renderEarningsPanel(container, clientId) {
  const { categories, totals } = await api.get(`/credit-items/earnings?client_id=${clientId}`);
  const rows = categories.filter((c) => c.pending_count > 0 || c.real_count > 0);

  if (!rows.length) {
    container.innerHTML = `
      <div class="card" style="margin-bottom:16px">
        <h4 style="font-size:14px;margin-bottom:4px">💰 Ganancia de este cliente</h4>
        <p class="text-sm text-muted" style="margin:0">Todavía no hay ítems de colección, pago tardío o inquiry para este cliente. En cuanto importes su reporte de crédito, aquí verás cuánto ganarías si se logran borrar, y cuánto ya es ganancia real.</p>
      </div>`;
    return;
  }

  const totalCount = rows.reduce((sum, c) => sum + c.pending_count + c.real_count, 0);

  container.innerHTML = `
    <div class="card" style="margin-bottom:16px">
      <h4 style="font-size:14px;margin-bottom:10px">💰 Ganancia de este cliente <span class="text-sm text-muted">— ${totalCount} ítem(s) en total</span></h4>
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-bottom:12px">
        <div class="card" style="padding:12px">
          <div class="text-sm text-muted">Ganancia pendiente <span class="text-sm">(aún en el reporte)</span></div>
          <div class="stat-value" style="font-size:20px;color:var(--amber)">${money(totals.pending)}</div>
          <div class="text-sm text-muted" style="margin-top:2px">${totals.pending_count} ítem(s)</div>
        </div>
        <div class="card" style="padding:12px">
          <div class="text-sm text-muted">Ganancia real <span class="text-sm">(ya borrada)</span></div>
          <div class="stat-value" style="font-size:20px;color:var(--green)">${money(totals.real)}</div>
          <div class="text-sm text-muted" style="margin-top:2px">${totals.real_count} ítem(s) — Cobrado ${money(totals.paid)} · Por cobrar ${money(totals.owed)}</div>
        </div>
      </div>
      <div class="table-wrap">
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
              <td class="cell-num"><span class="count-pill">${totalCount}</span></td>
              <td class="row-sub cell-num">${totals.pending_count} · ${money(totals.pending)}</td>
              <td class="cell-num">${totals.real_count} · ${money(totals.real)}</td>
              <td class="cell-num" style="color:var(--green)">${money(totals.paid)}</td>
              <td class="cell-num" style="color:var(--amber)">${money(totals.owed)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  `;
}

const MOTIVO_BY_CATEGORY = {
  coleccion: "This collection account is being reported inaccurately. I dispute the validity, balance, and status of this alleged debt and demand full verification.",
  charge_off: "This charge-off is being reported inaccurately. I dispute the balance and status reported and demand full verification of this account.",
  pago_tardio: "The late payment(s) reported on this account are inaccurate. I dispute the dates and/or severity of the delinquency reported and demand full verification.",
  liquidada: "This account was settled, and the status/balance currently being reported does not accurately reflect the terms of that settlement.",
  repossesion: "This repossession is being reported inaccurately and requires full verification.",
  foreclosure: "This foreclosure is being reported inaccurately and requires full verification.",
  bancarrota: "This item is being reported inaccurately in connection with a bankruptcy and requires full verification.",
  inquiry: "I did not authorize this inquiry.",
  otro: "This item is being reported inaccurately and requires full verification.",
};

function creditItemFormHtml(item = {}, lockClient) {
  return `
    <form id="credit-item-form">
      <div class="form-grid">
        <div class="field" style="grid-column:1/-1">
          <label>Categoría *</label>
          <select name="category" required>
            ${Object.entries(CATEGORY_META).map(([k, m]) => `<option value="${k}" ${item.category === k ? "selected" : ""}>${m.label}</option>`).join("")}
          </select>
        </div>
        <div class="field" style="grid-column:1/-1"><label>Acreedor / cobrador *</label><input type="text" name="creditor_name" required value="${escapeHtml(item.creditor_name)}" /></div>
        <div class="field"><label>Número de cuenta</label><input type="text" name="account_number" value="${escapeHtml(item.account_number)}" /></div>
        <div class="field"><label>Saldo</label><input type="text" name="balance" placeholder="$0" value="${escapeHtml(item.balance)}" /></div>
        <div class="field"><label>Estatus (texto del reporte)</label><input type="text" name="status_raw" placeholder="Ej. COLLECTION" value="${escapeHtml(item.status_raw)}" /></div>
        <div class="field"><label>Burós que lo reportan</label><input type="text" name="bureaus" placeholder="Ej. Equifax, TransUnion" value="${escapeHtml(item.bureaus)}" /></div>
        <div class="field"><label>Fecha reportado</label><input type="text" name="date_reported" placeholder="MM/AA" value="${escapeHtml(item.date_reported)}" /></div>
        <div class="field"><label>Fecha de apertura</label><input type="text" name="date_opened" placeholder="MM/AA" value="${escapeHtml(item.date_opened)}" /></div>
        <div class="field" style="grid-column:1/-1"><label>Notas</label><textarea name="notes" style="min-height:70px">${escapeHtml(item.notes)}</textarea></div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" data-close>Cancelar</button>
        <button type="submit" class="btn btn-primary">${item.id ? "Guardar cambios" : "Agregar ítem"}</button>
      </div>
    </form>
  `;
}

export function openCreditItemModal({ existing, clientId, onSaved }) {
  const { close, body } = openModal({
    title: existing ? "Editar ítem" : "Agregar ítem manualmente",
    bodyHtml: creditItemFormHtml(existing || {}),
    wide: true,
  });
  body.querySelector("[data-close]").addEventListener("click", close);
  body.querySelector("#credit-item-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = Object.fromEntries(fd.entries());
    payload.client_id = clientId;
    try {
      if (existing) {
        await api.put(`/credit-items/${existing.id}`, payload);
        toast("Ítem actualizado", "success");
      } else {
        const { credit_items } = await api.post("/credit-items", payload);
        // Si se escribió más de un buró, se creó un ítem por cada uno (remociones independientes).
        toast(credit_items && credit_items.length > 1 ? `${credit_items.length} ítems agregados (uno por buró)` : "Ítem agregado", "success");
      }
      close();
      onSaved();
    } catch (err) {
      toast(err.message, "error");
    }
  });
}

/* ------------------------------------------------------------------ */
/* Estrategia automática de disputa                                    */
/* ------------------------------------------------------------------ */
const BUREAUS = ["Equifax", "TransUnion", "Experian"];
const ESCALATE_AFTER_DAYS = 30;

function daysSince(dateStr) {
  if (!dateStr) return Infinity;
  const iso = dateStr.includes("T") ? dateStr : `${dateStr.replace(" ", "T")}Z`;
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return Infinity;
  return ms / 86400000;
}

function normalizeBureau(name) {
  const found = BUREAUS.find((b) => b.toLowerCase() === (name || "").trim().toLowerCase());
  return found || null;
}

function buildLetterMap(client, item, bureau, roundNumber) {
  return {
    cliente_nombre: client.full_name,
    cliente_direccion: client.address || "",
    cliente_ciudad_estado_zip: [client.city, client.state, client.zip].filter(Boolean).join(", "),
    cliente_id_last4: client.id_last4 || "",
    cliente_fecha_nacimiento: formatDobForLetter(client.date_of_birth),
    fecha: todayLong(),
    destinatario_nombre: bureau,
    destinatario_direccion: "",
    numero_cuenta: item ? item.account_number || "" : "",
    acreedor_nombre: item ? item.creditor_name || "" : "",
    motivo_disputa: item ? MOTIVO_BY_CATEGORY[item.category] || "" : "",
    ronda: String(roundNumber),
  };
}

/**
 * Decide qué cartas hacen falta para un ítem, según la estrategia:
 * Paso 0 (una vez por cliente/buró) → limpieza de información personal.
 * Luego Ronda 1 → Ronda 2 → Ronda 3 por ítem/buró, esperando ESCALATE_AFTER_DAYS
 * días desde que la carta anterior se marcó como enviada antes de sugerir la siguiente.
 */
function planLettersForItem(item, allClientLetters, templates) {
  const itemBureaus = (item.bureaus || "")
    .split(",")
    .map(normalizeBureau)
    .filter(Boolean);

  const toGenerate = [];
  const waiting = [];
  const problems = [];

  for (const bureau of itemBureaus) {
    const personalInfoLetter = allClientLetters.find(
      (l) => (l.credit_item_id === null || l.credit_item_id === undefined) && Number(l.round_number) === 0 && normalizeBureau(l.recipient_name) === bureau
    );
    if (!personalInfoLetter) {
      const tpl = templates.find((t) => t.category === "Buró de Crédito — Información Personal" && t.recipient_hint === bureau);
      if (tpl) toGenerate.push({ stage: "personal_info", bureau, round: 0, template: tpl });
      else problems.push(`${bureau}: no encontré la plantilla de "Información Personal" (¿la borraste?).`);
      continue;
    }

    // Los inquiries no siguen el flujo de Rondas 1/2/3 — es una sola carta de disputa por buró,
    // usando la plantilla de la categoría "Buró de Crédito — Inquiries".
    if (item.category === "inquiry") {
      const inquiryLetters = allClientLetters.filter((l) => l.credit_item_id === item.id && normalizeBureau(l.recipient_name) === bureau);
      if (inquiryLetters.length) {
        waiting.push(`${bureau}: ya se generó la carta de disputa de este inquiry.`);
        continue;
      }
      const tpl = templates.find((t) => t.category === "Buró de Crédito — Inquiries" && t.recipient_hint === bureau);
      if (tpl) toGenerate.push({ stage: "inquiry", bureau, round: 1, template: tpl });
      else problems.push(`${bureau}: no encontré la plantilla de "Inquiries" (¿la borraste?).`);
      continue;
    }

    const itemBureauLetters = allClientLetters.filter(
      (l) => l.credit_item_id === item.id && normalizeBureau(l.recipient_name) === bureau && Number(l.round_number) >= 1
    );
    if (!itemBureauLetters.length) {
      const tpl = templates.find((t) => t.category === "Buró de Crédito — Ronda 1" && t.recipient_hint === bureau);
      if (tpl) toGenerate.push({ stage: "round", bureau, round: 1, template: tpl });
      else problems.push(`${bureau}: no encontré la plantilla de Ronda 1 (¿la borraste?).`);
      continue;
    }

    const latest = itemBureauLetters.reduce((a, b) => (Number(a.round_number) >= Number(b.round_number) ? a : b));
    const latestRound = Number(latest.round_number);
    if (latest.status === "borrador") {
      waiting.push(`${bureau}: ya tiene una carta de Ronda ${latestRound} en borrador esperando tu revisión y envío.`);
      continue;
    }
    if (latestRound >= 3) {
      waiting.push(`${bureau}: ya está en Ronda 3 (última etapa automática) — el siguiente paso requiere tu revisión manual.`);
      continue;
    }
    const days = daysSince(latest.updated_at || latest.created_at);
    if (days < ESCALATE_AFTER_DAYS) {
      waiting.push(`${bureau}: Ronda ${latestRound} enviada hace ${Math.max(0, Math.floor(days))} día(s) — se espera el plazo de ${ESCALATE_AFTER_DAYS} días antes de escalar a la siguiente ronda.`);
      continue;
    }
    const nextRound = latestRound + 1;
    const tpl = templates.find((t) => t.category === `Buró de Crédito — Ronda ${nextRound}` && t.recipient_hint === bureau);
    if (tpl) toGenerate.push({ stage: "round", bureau, round: nextRound, template: tpl });
    else problems.push(`${bureau}: no encontré la plantilla de Ronda ${nextRound} (¿la borraste?).`);
  }

  return { toGenerate, waiting, problems };
}

function showGenerateResultsModal({ created, waiting, problems }) {
  const rows = created
    .map(
      (c) => `
      <tr>
        <td>${escapeHtml(c.item ? c.item.creditor_name || "—" : "—")}</td>
        <td>${c.stage === "personal_info" ? "Información personal" : c.stage === "inquiry" ? "Disputa de inquiry" : `Ronda ${c.round}`}</td>
        <td>${escapeHtml(c.bureau)}</td>
        <td><a href="#/cartas/${c.letter.id}">Ver carta</a></td>
      </tr>`
    )
    .join("");

  const { close, body } = openModal({
    title: created.length ? `${created.length} carta(s) generada(s)` : "Nada nuevo por generar",
    wide: true,
    bodyHtml: `
      ${created.length
        ? `<table><thead><tr><th>Ítem</th><th>Etapa</th><th>Buró</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
        : `<p class="text-muted">No se generó ninguna carta nueva — revisa "En espera" abajo para saber por qué.</p>`}
      ${waiting.length
        ? `<p class="text-sm text-muted" style="margin-top:16px"><strong>En espera:</strong></p><ul class="text-sm text-muted">${waiting.map((w) => `<li>${escapeHtml(w)}</li>`).join("")}</ul>`
        : ""}
      ${problems.length
        ? `<p class="text-sm" style="margin-top:16px"><strong>Revisar:</strong></p><ul class="text-sm">${problems.map((w) => `<li>${escapeHtml(w)}</li>`).join("")}</ul>`
        : ""}
      ${created.length
        ? `<p class="text-sm text-muted" style="margin-top:16px">Todas se crearon como <strong>borrador</strong>. Revísalas, edítalas si hace falta, y confírmalas desde Cartas antes de enviarlas — nada se envía automáticamente.</p>`
        : ""}
      <div class="form-actions"><button type="button" class="btn btn-primary" data-close>Entendido</button></div>
    `,
  });
  body.querySelector("[data-close]").addEventListener("click", close);
}

/**
 * Corre la estrategia automática para uno o varios ítems del mismo cliente:
 * detecta el paso que le toca a cada buró que reporta cada ítem (limpieza de
 * información personal primero, luego Ronda 1/2/3 con espera entre rondas) y
 * genera las cartas necesarias como borrador. Nunca marca nada como enviado.
 */
export async function runSmartGenerate({ items, clientId, onSaved }) {
  try {
    await api.post("/templates/seed").catch(() => {});
    const [{ client }, { templates }, { letters: allClientLetters }] = await Promise.all([
      api.get(`/clients/${clientId}`),
      api.get("/templates"),
      api.get(`/letters?client_id=${clientId}`),
    ]);

    const created = [];
    const waitingAll = [];
    const problemsAll = [];
    let workingLetters = allClientLetters.slice();

    for (const item of items) {
      const { toGenerate, waiting, problems } = planLettersForItem(item, workingLetters, templates);
      waitingAll.push(...waiting.map((w) => `${item.creditor_name || "Ítem"} — ${w}`));
      problemsAll.push(...problems.map((w) => `${item.creditor_name || "Ítem"} — ${w}`));
      for (const plan of toGenerate) {
        const map = buildLetterMap(client, item, plan.bureau, plan.round);
        const renderedBody = renderTemplate(plan.template.body, map);
        const title = plan.stage === "personal_info" ? plan.template.name : `${plan.template.name} — ${item.creditor_name || ""}`.trim();
        const { letter } = await api.post("/letters", {
          client_id: clientId,
          template_id: plan.template.id,
          credit_item_id: plan.stage === "personal_info" ? null : item.id,
          title,
          recipient_name: plan.bureau,
          round_number: plan.round,
          body: renderedBody,
        });
        created.push({ letter, item, bureau: plan.bureau, stage: plan.stage, round: plan.round });
        workingLetters.push(letter);
      }
    }

    onSaved();
    showGenerateResultsModal({ created, waiting: waitingAll, problems: problemsAll });
    return { created, waiting: waitingAll, problems: problemsAll };
  } catch (err) {
    toast(err.message, "error");
    return { created: [], waiting: [], problems: [] };
  }
}

/* ------------------------------------------------------------------ */
/* Generar carta a partir de un ítem (manual — elige plantilla tú mismo) */
/* ------------------------------------------------------------------ */
export async function openGenerateLetterModal({ item, onSaved }) {
  const [{ client }, { templates }] = await Promise.all([api.get(`/clients/${item.client_id}`), api.get("/templates")]);

  const itemBureaus = (item.bureaus || "").split(",").map((s) => s.trim()).filter(Boolean);
  const suggested = templates.filter((t) => t.recipient_hint && itemBureaus.some((b) => b.toLowerCase() === t.recipient_hint.toLowerCase()));
  const orderedTemplates = [...suggested, ...templates.filter((t) => !suggested.includes(t))];

  const { close, body } = openModal({
    title: `Generar carta — ${item.creditor_name || "ítem"}`,
    bodyHtml: `
      <form id="gen-letter-form">
        <div class="form-grid">
          <div class="field" style="grid-column:1/-1">
            <label>Plantilla *</label>
            <select name="template_id" required>
              <option value="">Selecciona una plantilla</option>
              ${orderedTemplates.map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join("")}
            </select>
          </div>
          <div class="field"><label>Ronda</label><input type="number" name="round_number" value="1" min="1" /></div>
          <div class="field"><label>Destinatario</label><input type="text" name="recipient_name" value="${escapeHtml(itemBureaus[0] || "")}" /></div>
          <div class="field" style="grid-column:1/-1"><label>Motivo de la disputa</label><textarea name="motivo" style="min-height:70px">${escapeHtml(MOTIVO_BY_CATEGORY[item.category] || "")}</textarea></div>
        </div>
        <p class="text-sm text-muted" style="margin:8px 0 4px">Se creará como <strong>borrador</strong> — la revisas, editas y confirmas su envío desde Cartas, igual que cualquier otra carta.</p>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" data-close>Cancelar</button>
          <button type="submit" class="btn btn-primary">${icon("spark")} Generar carta</button>
        </div>
      </form>
    `,
    wide: true,
  });
  body.querySelector("[data-close]").addEventListener("click", close);
  body.querySelector("#gen-letter-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const templateId = fd.get("template_id");
    if (!templateId) return toast("Selecciona una plantilla", "error");
    const template = templates.find((t) => String(t.id) === templateId);
    const map = {
      cliente_nombre: client.full_name,
      cliente_direccion: client.address || "",
      cliente_ciudad_estado_zip: [client.city, client.state, client.zip].filter(Boolean).join(", "),
      cliente_id_last4: client.id_last4 || "",
      cliente_fecha_nacimiento: formatDobForLetter(client.date_of_birth),
      fecha: todayLong(),
      destinatario_nombre: fd.get("recipient_name") || "",
      destinatario_direccion: "",
      numero_cuenta: item.account_number || "",
      acreedor_nombre: item.creditor_name || "",
      motivo_disputa: fd.get("motivo") || "",
      ronda: fd.get("round_number") || "1",
    };
    const renderedBody = renderTemplate(template.body, map);
    try {
      const { letter } = await api.post("/letters", {
        client_id: item.client_id,
        template_id: template.id,
        credit_item_id: item.id,
        title: `${template.name} — ${item.creditor_name || ""}`.trim(),
        recipient_name: fd.get("recipient_name") || template.recipient_hint || "",
        round_number: Number(fd.get("round_number")) || 1,
        body: renderedBody,
      });
      toast("Carta generada como borrador", "success");
      close();
      onSaved();
      window.__creditflowNavigate(`#/cartas/${letter.id}`);
    } catch (err) {
      toast(err.message, "error");
    }
  });
}

/**
 * Corre la estrategia automática para TODOS los ítems de un cliente de una vez
 * (botón "Generar cartas — estrategia automática" en la ficha del cliente).
 */
export async function runSmartGenerateForClient(clientId, onSaved) {
  const { credit_items } = await api.get(`/credit-items?client_id=${clientId}`);
  if (!credit_items.length) {
    toast("Este cliente todavía no tiene ítems importados.", "error");
    return;
  }
  await runSmartGenerate({ items: credit_items, clientId, onSaved });
}

/* ------------------------------------------------------------------ */
/* Lista de ítems de un cliente (usada dentro de la ficha del cliente) */
/* ------------------------------------------------------------------ */
export async function renderClientCreditItems(container, clientId, earningsBox) {
  container.innerHTML = `<div class="text-sm text-muted">Cargando...</div>`;
  if (earningsBox) renderEarningsPanel(earningsBox, clientId);
  const { credit_items } = await api.get(`/credit-items?client_id=${clientId}`);
  // Nota: aquí NO se pide /pricing ni se muestra ningún precio — cuánto cobras por cada ítem es
  // información solo tuya, vive únicamente en Ganancias.

  if (!credit_items.length) {
    container.innerHTML = `<div class="empty"><div class="mark">🗂️</div><h3>Sin ítems todavía</h3><p>Importa el reporte de crédito del cliente o agrega un ítem manualmente.</p></div>`;
    return;
  }

  // Pestañas por categoría — solo se muestran las categorías que este cliente realmente tiene.
  // Clic en una pestaña filtra la tabla de abajo a solo esa categoría (ej. Charge-offs).
  const categoriesPresent = [...new Set(credit_items.map((it) => it.category))];
  container.innerHTML = `
    <div class="tag-row" id="credit-items-cat-filters" style="margin-bottom:12px"></div>
    <div class="table-wrap"><div id="credit-items-table"></div></div>
  `;
  const filtersBox = container.querySelector("#credit-items-cat-filters");
  const tableBox = container.querySelector("#credit-items-table");

  filtersBox.innerHTML = `
    <button class="pill-filter active" data-cat="">Todas (${credit_items.length})</button>
    ${categoriesPresent
      .map((cat) => {
        const n = credit_items.filter((it) => it.category === cat).length;
        return `<button class="pill-filter" data-cat="${cat}">${escapeHtml((CATEGORY_META[cat] || { label: cat }).label)} (${n})</button>`;
      })
      .join("")}
  `;

  function drawTable(filterCat) {
    const filtered = filterCat ? credit_items.filter((it) => it.category === filterCat) : credit_items;
    if (!filtered.length) {
      tableBox.innerHTML = `<div class="empty text-sm">Sin ítems en esta categoría.</div>`;
      return;
    }
    tableBox.innerHTML = `
      <table class="table-compact">
        <thead><tr><th>Categoría</th><th>Acreedor</th><th>Cuenta</th><th class="cell-num">Saldo</th><th>Burós</th><th>Disputa</th><th>Estado</th><th></th></tr></thead>
        <tbody>
          ${filtered
            .map(
              (it) => `
            <tr data-id="${it.id}">
              <td>${categoryBadge(it.category)}</td>
              <td class="row-name">${escapeHtml(it.creditor_name) || "—"}</td>
              <td class="row-sub">${escapeHtml(it.account_number) || "—"}</td>
              <td class="row-sub cell-num">${escapeHtml(it.balance) || "—"}</td>
              <td class="row-sub">${escapeHtml(it.bureaus) || "—"}</td>
              <td class="row-sub">${it.is_disputed ? `${icon("check")} ${it.letters_count} carta(s)` : "Sin disputar"}</td>
              <td>${removalStatusCell(it)}</td>
              <td class="cell-actions">
                <button class="btn btn-primary btn-sm" data-gen="${it.id}">${icon("spark")} Generar carta</button>
                <button class="btn btn-ghost btn-sm" data-manual="${it.id}">Manual</button>
                <button class="btn btn-ghost btn-sm btn-icon" data-edit="${it.id}">${icon("edit")}</button>
                <button class="btn btn-danger btn-sm btn-icon" data-del="${it.id}">${icon("trash")}</button>
              </td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>
    `;

    wireBillingButtons(tableBox, () => renderClientCreditItems(container, clientId, earningsBox));

    tableBox.querySelectorAll("[data-gen]").forEach((b) =>
      b.addEventListener("click", async () => {
        const item = credit_items.find((x) => String(x.id) === b.dataset.gen);
        b.disabled = true;
        const orig = b.innerHTML;
        b.innerHTML = "Generando…";
        await runSmartGenerate({ items: [item], clientId, onSaved: () => renderClientCreditItems(container, clientId, earningsBox) });
        b.disabled = false;
        b.innerHTML = orig;
      })
    );
    tableBox.querySelectorAll("[data-manual]").forEach((b) =>
      b.addEventListener("click", () => {
        const item = credit_items.find((x) => String(x.id) === b.dataset.manual);
        openGenerateLetterModal({ item, onSaved: () => renderClientCreditItems(container, clientId, earningsBox) });
      })
    );
    tableBox.querySelectorAll("[data-edit]").forEach((b) =>
      b.addEventListener("click", () => {
        const existing = credit_items.find((x) => String(x.id) === b.dataset.edit);
        openCreditItemModal({ existing, clientId, onSaved: () => renderClientCreditItems(container, clientId, earningsBox) });
      })
    );
    tableBox.querySelectorAll("[data-del]").forEach((b) =>
      b.addEventListener("click", async () => {
        const ok = await confirmDialog("¿Eliminar este ítem? Las cartas ya generadas no se verán afectadas.");
        if (!ok) return;
        try {
          await api.del(`/credit-items/${b.dataset.del}`);
          toast("Ítem eliminado", "success");
          renderClientCreditItems(container, clientId, earningsBox);
        } catch (err) {
          toast(err.message, "error");
        }
      })
    );
  }

  drawTable("");
  filtersBox.querySelectorAll(".pill-filter").forEach((btn) =>
    btn.addEventListener("click", () => {
      filtersBox.querySelectorAll(".pill-filter").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      drawTable(btn.dataset.cat);
    })
  );
}

// Nota: la vista global "Colecciones" (todos los clientes juntos) se eliminó — los ítems de
// colección ahora solo se ven dentro de la ficha de cada cliente (arriba, renderClientCreditItems).
// El resumen financiero global vive en la sección "Ganancias" (ver sections/earnings.js), que
// reutiliza el helper money() de este archivo.
