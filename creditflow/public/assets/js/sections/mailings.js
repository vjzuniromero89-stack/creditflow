import { api } from "../api.js";
import { icon } from "../icons.js";
import { toast } from "../toast.js";
import { confirmDialog } from "../modal.js";
import { escapeHtml, formatDate, formatDateTime, statusBadge } from "../utils.js";
import { AppState } from "../app.js";
import { roundLabel } from "./letters.js";

const CERTIFIED_MAIL_URL = "https://www.certifiedmaillabels.com/create-address-label";

// Los 3 burós de crédito — la gran mayoría de las cartas "listas para enviar" van a una de estas 3
// direcciones (ver BUREAU_ADDRESS en collections.js). Se usan para mostrar a dónde va cada fila.
const BUREAUS = ["Equifax", "TransUnion", "Experian"];

// Las "Listas para enviar" se agrupan por CLIENTE, no por buró — porque en certifiedmaillabels.com
// (Excel Batch Labels) el remitente ("From") se pone UNA vez por lote, para TODAS las filas del
// archivo. Como cada cliente manda su disputa con sus propios datos como remitente (no los de tu
// negocio — así le llega al buró como si la mandara él/ella directamente), un mismo lote solo puede
// ser de un cliente a la vez. Agrupando por cliente, cada tarjeta ya es justo ese lote: sus cartas a
// Equifax/TransUnion/Experian (y a cualquier acreedor directo) listas para subir juntas de un jalón.

// Columnas EXACTAS (mismo orden) que pide la plantilla "Master Import Template" de Excel Batch
// Labels de certifiedmaillabels.com — así el archivo que armamos aquí se puede subir directo ahí
// para crear todas las etiquetas de un cliente (a los 3 burós y/o acreedores) de un jalón, sin
// escribir nada a mano.
const BATCH_CSV_HEADERS = [
  "To Company Name",
  "To Name",
  "To Address Line 1 (Primary address line)",
  "To Address Line2 (Secondary Address line)",
  "To City",
  "To State",
  "To ZIP",
  "To ZIP4",
  "To Phone",
  "Custom Field1",
  "Custom Field2",
  "Custom Field3",
  "Custom Field4",
  "Custom Field5",
];

// Nuestras direcciones se guardan como texto de varias líneas (ej. "Equifax Information Services
// LLC\nP.O. Box 740256\nAtlanta, GA 30374") — esto las separa en nombre / dirección / ciudad,
// estado y zip para llenar las columnas de arriba. Si la última línea no trae el patrón
// "Ciudad, ES ZIP" (puede pasar con direcciones de acreedores escritas a mano), se manda todo en
// la línea de dirección y se dejan ciudad/estado/zip en blanco para que se revise antes de subir.
function parseRecipientAddress(address) {
  const lines = String(address || "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!lines.length) return { name: "", line1: "", line2: "", city: "", state: "", zip: "" };
  const last = lines[lines.length - 1];
  const m = last.match(/^(.+?),\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
  if (m && lines.length >= 2) {
    const addressLines = lines.slice(1, -1);
    return { name: lines[0], line1: addressLines[0] || "", line2: addressLines[1] || "", city: m[1].trim(), state: m[2].toUpperCase(), zip: m[3].trim() };
  }
  return { name: lines[0] || "", line1: lines.slice(1).join(", "), line2: "", city: "", state: "", zip: "" };
}

function csvEscapeCell(value) {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function buildBatchCsv(groupLetters) {
  const rows = groupLetters.map((l) => {
    const a = parseRecipientAddress(l.recipient_address);
    // Custom Field1 y 5 quedan como referencia — así en los reportes de certifiedmaillabels.com se
    // puede identificar a qué cliente/carta de CreditFlow corresponde cada etiqueta.
    // Guión normal (no "—") en Custom Field1 — certifiedmaillabels.com marca el guión largo como
    // carácter inválido para las especificaciones de USPS.
    return ["", a.name, a.line1, a.line2, a.city, a.state, a.zip, "", "", `${l.client_name} - ${l.title}`, "", "", "", `CF-${l.id}`];
  });
  return [BATCH_CSV_HEADERS, ...rows].map((r) => r.map(csvEscapeCell).join(",")).join("\r\n");
}

function downloadTextFile(filename, content, mime) {
  const blob = new Blob(["﻿" + content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function renderMailings(container) {
  container.innerHTML = `
    <div class="section-head">
      <div class="sub">
        Envía tus cartas certificadas a través de <a href="https://www.certifiedmaillabels.com" target="_blank" rel="noopener">certifiedmaillabels.com</a>
        y da seguimiento a la entrega.
        ${AppState.uspsConfigured ? "" : `<br/><span class="text-muted">El rastreo automático de USPS no está configurado todavía — puedes activarlo desde Ajustes.</span>`}
      </div>
      <div class="flex gap-12">
        <a class="btn btn-ghost" href="${CERTIFIED_MAIL_URL}" target="_blank" rel="noopener">${icon("link")} certifiedmaillabels.com</a>
        ${AppState.uspsConfigured ? `<button class="btn btn-primary" id="refresh-all-btn">${icon("refresh")} Actualizar todos</button>` : ""}
      </div>
    </div>

    <div class="section-head" style="margin-top:6px">
      <div>
        <h2 style="font-size:16px">Listas para enviar</h2>
        <p class="text-sm text-muted" style="margin-top:2px">Agrupadas por cliente — cada tarjeta trae todas sus cartas (Equifax, TransUnion, Experian, etc.) listas para subir juntas a certifiedmaillabels.com en un solo lote.</p>
      </div>
      <button class="btn btn-danger btn-sm" id="delete-all-ready-btn">${icon("trash")} Borrar todo</button>
    </div>
    <div id="ready-groups" style="margin-bottom:26px"></div>

    <div class="section-head">
      <h2 style="font-size:16px">Envíos en curso / historial</h2>
    </div>
    <div class="table-wrap"><div id="mailings-table"></div></div>
  `;

  document.getElementById("delete-all-ready-btn").addEventListener("click", async () => {
    const { letters } = await api.get("/letters?status=lista");
    if (!letters.length) {
      toast("No hay cartas en \"Listas para enviar\"", "error");
      return;
    }
    const ok = await confirmDialog(`¿Borrar las ${letters.length} carta(s) de "Listas para enviar"? Esta acción no se puede deshacer.`);
    if (!ok) return;
    let failed = 0;
    for (const l of letters) {
      try {
        await api.del(`/letters/${l.id}`);
      } catch {
        failed++;
      }
    }
    toast(failed ? `${letters.length - failed} carta(s) eliminada(s), ${failed} fallaron` : `${letters.length} carta(s) eliminada(s)`, failed ? "error" : "success");
    await loadReady();
  });

  async function loadReady() {
    const { letters } = await api.get("/letters?status=lista");
    const box = document.getElementById("ready-groups");
    if (!letters.length) {
      box.innerHTML = `<div class="empty text-sm">No hay cartas esperando ser enviadas.</div>`;
      return;
    }

    // Agrupa por cliente (ver nota arriba de por qué, no por buró).
    const groups = new Map();
    for (const l of letters) {
      if (!groups.has(l.client_id)) groups.set(l.client_id, []);
      groups.get(l.client_id).push(l);
    }
    // Los clientes con más cartas listas primero — son los que más rinden procesar en lote.
    const orderedIds = [...groups.keys()].sort((a, b) => {
      const diff = groups.get(b).length - groups.get(a).length;
      return diff !== 0 ? diff : (groups.get(a)[0].client_name || "").localeCompare(groups.get(b)[0].client_name || "");
    });

    box.innerHTML = orderedIds.map((id) => renderClientCard(id, groups.get(id))).join("");

    orderedIds.forEach((id) => wireClientCard(id, groups.get(id)));
  }

  function senderFieldRow(label, value) {
    if (!value) return "";
    return `
      <div class="flex-between" style="padding:2px 0">
        <div class="text-sm"><span class="text-muted">${escapeHtml(label)}:</span> ${escapeHtml(value)}</div>
        <button class="btn btn-ghost btn-sm btn-icon" data-copy-value="${escapeHtml(value)}" title="Copiar ${escapeHtml(label.toLowerCase())}">${icon("copy")}</button>
      </div>
    `;
  }

  function renderClientCard(clientId, groupLetters) {
    const first = groupLetters[0];
    // Cuenta cuántas van a cada buró para que se vea de un vistazo, sin tener que leer la tabla.
    const byBureau = BUREAUS.map((b) => ({ b, n: groupLetters.filter((l) => l.recipient_name === b).length })).filter((x) => x.n);
    const otherCount = groupLetters.length - byBureau.reduce((s, x) => s + x.n, 0);

    const hasFullAddress = first.client_address && first.client_city && first.client_state && first.client_zip;

    return `
      <div class="card" style="margin-bottom:16px" data-group="${clientId}">
        <div class="flex-between" style="margin-bottom:10px;flex-wrap:wrap;gap:8px">
          <div>
            <h3 style="font-size:15px">${escapeHtml(first.client_name)} <span class="text-muted" style="font-weight:400">(${groupLetters.length} carta${groupLetters.length === 1 ? "" : "s"})</span></h3>
            <div class="tag-row" style="margin-top:4px">
              ${byBureau.map((x) => `<span class="badge badge-activo">${escapeHtml(x.b)} (${x.n})</span>`).join("")}
              ${otherCount ? `<span class="badge badge-pausado">Directo al acreedor (${otherCount})</span>` : ""}
            </div>
          </div>
          <div class="flex gap-8" style="flex-wrap:wrap">
            <button class="btn btn-primary btn-sm" data-download-batch="${clientId}" title="Genera un archivo con las ${groupLetters.length} cartas de este cliente, listo para subir a certifiedmaillabels.com → Excel Batch Labels">${icon("download")} Descargar Excel (${groupLetters.length})</button>
            <a class="btn btn-ghost btn-sm" href="${CERTIFIED_MAIL_URL}" target="_blank" rel="noopener">${icon("link")} Crear etiquetas</a>
          </div>
        </div>

        <div class="card" style="background:rgba(255,255,255,.03);padding:10px;margin-bottom:12px">
          <div class="text-sm text-muted" style="margin-bottom:4px">Remitente sugerido — pégalo en "From Name" / "From Return Address" al subir el Excel, así la carta le llega al buró como si la mandara ${escapeHtml(first.client_name)} directamente (deja "From Company" en blanco):</div>
          ${
            hasFullAddress
              ? `
            ${senderFieldRow("Nombre", first.client_name)}
            ${senderFieldRow("Dirección", first.client_address)}
            ${senderFieldRow("Ciudad", first.client_city)}
            ${senderFieldRow("Estado", first.client_state)}
            ${senderFieldRow("Zip", first.client_zip)}
            ${senderFieldRow("Teléfono", first.client_phone)}
          `
              : `<div class="text-sm" style="color:var(--amber)">⚠️ A este cliente le falta dirección completa en su ficha (calle, ciudad, estado o zip) — agrégala antes de enviar, la necesitas para el remitente.</div>`
          }
        </div>

        <div class="table-wrap">
          <table>
            <thead><tr><th>Carta</th><th>Va a</th><th>Ronda</th><th style="min-width:170px">Rastreo (USPS)</th><th style="min-width:100px">Costo</th><th></th></tr></thead>
            <tbody>
              ${groupLetters
                .map(
                  (l) => `
                <tr data-id="${l.id}">
                  <td class="row-name">${escapeHtml(l.title)}</td>
                  <td>${escapeHtml(l.recipient_name) || "—"}</td>
                  <td>${roundLabel(l.round_number)}</td>
                  <td><input type="text" class="tracking-input" data-letter="${l.id}" placeholder="9407 3000 0000..." /></td>
                  <td><input type="text" class="cost-input" data-letter="${l.id}" placeholder="$7.28" style="width:90px" /></td>
                  <td class="cell-actions"><button class="btn btn-ghost btn-sm" data-open="${l.id}">${icon("send")} Ver carta</button></td>
                </tr>`
                )
                .join("")}
            </tbody>
          </table>
        </div>
        <div class="form-actions" style="margin-top:12px">
          <button class="btn btn-primary" data-send-group="${clientId}">${icon("send")} Registrar ${groupLetters.length > 1 ? "estos envíos" : "envío"}</button>
        </div>
      </div>
    `;
  }

  function wireClientCard(clientId, groupLetters) {
    const card = document.querySelector(`[data-group="${CSS.escape(String(clientId))}"]`);
    if (!card) return;

    card.querySelectorAll("[data-open]").forEach((b) =>
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        window.__creditflowNavigate(`#/cartas/${b.dataset.open}`);
      })
    );

    card.querySelectorAll("[data-copy-value]").forEach((b) =>
      b.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(b.dataset.copyValue);
          toast("Copiado", "success");
        } catch {
          toast("No se pudo copiar — cópialo manualmente", "error");
        }
      })
    );

    const downloadBtn = card.querySelector(`[data-download-batch="${CSS.escape(String(clientId))}"]`);
    downloadBtn.addEventListener("click", () => {
      const csv = buildBatchCsv(groupLetters);
      const safeName = (groupLetters[0].client_name || "cliente").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
      const stamp = new Date().toISOString().slice(0, 10);
      downloadTextFile(`creditflow-envio-${safeName}-${stamp}.csv`, csv, "text/csv;charset=utf-8;");
      toast("Archivo descargado — súbelo en certifiedmaillabels.com → Excel Batch Labels", "success");
    });

    const sendBtn = card.querySelector(`[data-send-group="${CSS.escape(String(clientId))}"]`);
    sendBtn.addEventListener("click", async () => {
      // Solo se registran las filas donde sí se puso número de rastreo — así puede ir creando las
      // etiquetas y pegando el tracking de a poco, y mandar solo las que ya tiene listas.
      const items = groupLetters
        .map((l) => {
          const trackingInput = card.querySelector(`.tracking-input[data-letter="${l.id}"]`);
          const costInput = card.querySelector(`.cost-input[data-letter="${l.id}"]`);
          return { letter_id: l.id, tracking_number: (trackingInput.value || "").trim(), cost: (costInput.value || "").trim() };
        })
        .filter((it) => it.tracking_number);

      if (!items.length) {
        toast("Pon al menos un número de rastreo antes de registrar", "error");
        return;
      }

      sendBtn.disabled = true;
      const orig = sendBtn.innerHTML;
      sendBtn.innerHTML = "Registrando…";
      try {
        const { results } = await api.post("/letters/send-batch", { items });
        const okCount = results.filter((r) => r.ok).length;
        const failed = results.filter((r) => !r.ok);
        if (failed.length) {
          toast(`${okCount} envío(s) registrado(s), ${failed.length} fallaron: ${failed.map((f) => f.error).join(" / ")}`, "error");
        } else {
          toast(`${okCount} envío(s) registrado(s)`, "success");
        }
        await loadReady();
        await loadMailings();
      } catch (err) {
        toast(err.message, "error");
      } finally {
        sendBtn.disabled = false;
        sendBtn.innerHTML = orig;
      }
    });
  }

  async function loadMailings() {
    const { mailings } = await api.get("/mailings");
    const box = document.getElementById("mailings-table");
    if (!mailings.length) {
      box.innerHTML = `<div class="empty"><div class="mark">📬</div><h3>Sin envíos todavía</h3><p>Cuando envíes una carta certificada, aparecerá aquí.</p></div>`;
      return;
    }
    box.innerHTML = `
      <table>
        <thead><tr><th>Rastreo</th><th>Cliente</th><th>Carta</th><th>Estado</th><th>Enviado</th><th></th></tr></thead>
        <tbody>
          ${mailings
            .map(
              (m) => `
            <tr data-letter="${m.letter_id}">
              <td class="row-name">${escapeHtml(m.tracking_number) || "—"}</td>
              <td>${escapeHtml(m.client_name)}</td>
              <td class="row-sub">${escapeHtml(m.letter_title)}</td>
              <td>${statusBadge(m.letter_status)}</td>
              <td class="row-sub">${formatDate(m.mailed_at)}</td>
              <td class="cell-actions">
                ${AppState.uspsConfigured ? `<button class="btn btn-ghost btn-sm btn-icon" data-refresh="${m.id}" title="Actualizar rastreo">${icon("refresh")}</button>` : ""}
              </td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>
    `;
    box.querySelectorAll("tbody tr").forEach((tr) =>
      tr.addEventListener("click", (e) => {
        if (e.target.closest("button")) return;
        window.__creditflowNavigate(`#/cartas/${tr.dataset.letter}`);
      })
    );
    box.querySelectorAll("[data-refresh]").forEach((b) =>
      b.addEventListener("click", async (e) => {
        e.stopPropagation();
        try {
          await api.post(`/mailings/${b.dataset.refresh}/refresh`);
          toast("Rastreo actualizado", "success");
          loadMailings();
        } catch (err) {
          toast(err.message, "error");
        }
      })
    );
  }

  const refreshAllBtn = document.getElementById("refresh-all-btn");
  if (refreshAllBtn) {
    refreshAllBtn.addEventListener("click", async () => {
      try {
        const r = await api.post("/mailings/refresh-all");
        toast(`${r.updated} envíos actualizados`, "success");
        loadMailings();
      } catch (err) {
        toast(err.message, "error");
      }
    });
  }

  await Promise.all([loadReady(), loadMailings()]);
}
