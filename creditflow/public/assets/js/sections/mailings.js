import { api } from "../api.js";
import { icon } from "../icons.js";
import { toast } from "../toast.js";
import { confirmDialog } from "../modal.js";
import { escapeHtml, formatDate, formatDateTime, statusBadge } from "../utils.js";
import { AppState } from "../app.js";
import { roundLabel } from "./letters.js";

const CERTIFIED_MAIL_URL = "https://www.certifiedmaillabels.com/create-address-label";

// Los 3 burós de crédito — la gran mayoría de las cartas "listas para enviar" van a una de estas 3
// direcciones fijas (ver BUREAU_ADDRESS en collections.js). Agrupar por esto es lo que deja ver de
// un jalón "tengo 5 cartas listas para Experian" y procesarlas juntas en vez de una por una.
const BUREAUS = ["Equifax", "TransUnion", "Experian"];
const OTHER_GROUP_KEY = "__otros__";
const OTHER_GROUP_LABEL = "Directo al acreedor / otros destinatarios";

// Columnas EXACTAS (mismo orden) que pide la plantilla "Master Import Template" de Excel Batch
// Labels de certifiedmaillabels.com — así el archivo que armamos aquí se puede subir directo ahí
// para crear todas las etiquetas de un buró de un jalón, sin escribir nada a mano.
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
    return ["", a.name, a.line1, a.line2, a.city, a.state, a.zip, "", "", `${l.client_name} — ${l.title}`, "", "", "", `CF-${l.id}`];
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
        <p class="text-sm text-muted" style="margin-top:2px">Agrupadas por a dónde van — todas las que van a Equifax, TransUnion o Experian quedan juntas para que las proceses de un jalón.</p>
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

    // Agrupa por destinatario — los 3 burós primero (en orden fijo), y al final las que van
    // directo a un acreedor (cada una a su propia dirección, no se pueden agrupar).
    const groups = new Map();
    for (const l of letters) {
      const key = BUREAUS.includes(l.recipient_name) ? l.recipient_name : OTHER_GROUP_KEY;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(l);
    }
    const orderedKeys = [...BUREAUS.filter((b) => groups.has(b)), ...(groups.has(OTHER_GROUP_KEY) ? [OTHER_GROUP_KEY] : [])];

    box.innerHTML = orderedKeys.map((key) => renderGroupCard(key, groups.get(key))).join("");

    orderedKeys.forEach((key) => wireGroupCard(key, groups.get(key)));
  }

  function renderGroupCard(key, groupLetters) {
    const isOther = key === OTHER_GROUP_KEY;
    const label = isOther ? OTHER_GROUP_LABEL : key;
    // Cuando es un buró, todas las cartas del grupo comparten la misma dirección de disputa —
    // se muestra una sola vez arriba para copiarla fácil en vez de tener que verla repetida.
    const sharedAddress = !isOther && groupLetters[0] ? groupLetters[0].recipient_address : "";
    return `
      <div class="card" style="margin-bottom:16px" data-group="${key}">
        <div class="flex-between" style="margin-bottom:10px;flex-wrap:wrap;gap:8px">
          <div>
            <h3 style="font-size:15px">${escapeHtml(label)} <span class="text-muted" style="font-weight:400">(${groupLetters.length} carta${groupLetters.length === 1 ? "" : "s"})</span></h3>
            ${sharedAddress ? `<div class="text-sm text-muted" style="white-space:pre-line;margin-top:2px">${escapeHtml(sharedAddress)}</div>` : ""}
            ${isOther ? `<div class="text-sm text-muted" style="margin-top:2px">Cada una va a una dirección distinta (la del acreedor) — revisa el Excel descargado antes de subirlo, por si alguna dirección no se separó bien en ciudad/estado/zip.</div>` : ""}
          </div>
          <div class="flex gap-8" style="flex-wrap:wrap">
            ${sharedAddress ? `<button class="btn btn-ghost btn-sm" data-copy-address="${key}">${icon("copy")} Copiar dirección</button>` : ""}
            <button class="btn btn-primary btn-sm" data-download-batch="${key}" title="Genera un archivo con las ${groupLetters.length} direcciones de este grupo, listo para subir a certifiedmaillabels.com → Excel Batch Labels">${icon("download")} Descargar Excel (${groupLetters.length})</button>
            <a class="btn btn-ghost btn-sm" href="${CERTIFIED_MAIL_URL}" target="_blank" rel="noopener">${icon("link")} Crear etiquetas</a>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Carta</th><th>Cliente</th><th>Ronda</th><th style="min-width:170px">Rastreo (USPS)</th><th style="min-width:100px">Costo</th><th></th></tr></thead>
            <tbody>
              ${groupLetters
                .map(
                  (l) => `
                <tr data-id="${l.id}">
                  <td class="row-name">${escapeHtml(l.title)}</td>
                  <td>${escapeHtml(l.client_name)}</td>
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
          <button class="btn btn-primary" data-send-group="${key}">${icon("send")} Registrar ${groupLetters.length > 1 ? `los envíos de ${label}` : "envío"}</button>
        </div>
      </div>
    `;
  }

  function wireGroupCard(key, groupLetters) {
    const card = document.querySelector(`[data-group="${CSS.escape(key)}"]`);
    if (!card) return;

    card.querySelectorAll("[data-open]").forEach((b) =>
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        window.__creditflowNavigate(`#/cartas/${b.dataset.open}`);
      })
    );

    const copyBtn = card.querySelector("[data-copy-address]");
    if (copyBtn) {
      copyBtn.addEventListener("click", async () => {
        const address = groupLetters[0].recipient_address || "";
        try {
          await navigator.clipboard.writeText(address);
          toast("Dirección copiada", "success");
        } catch {
          toast("No se pudo copiar — cópiala manualmente", "error");
        }
      });
    }

    const downloadBtn = card.querySelector(`[data-download-batch="${CSS.escape(key)}"]`);
    downloadBtn.addEventListener("click", () => {
      const csv = buildBatchCsv(groupLetters);
      const safeLabel = (key === OTHER_GROUP_KEY ? "otros" : key).toLowerCase();
      const stamp = new Date().toISOString().slice(0, 10);
      downloadTextFile(`creditflow-envio-${safeLabel}-${stamp}.csv`, csv, "text/csv;charset=utf-8;");
      toast("Archivo descargado — súbelo en certifiedmaillabels.com → Excel Batch Labels", "success");
    });

    const sendBtn = card.querySelector(`[data-send-group="${CSS.escape(key)}"]`);
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
