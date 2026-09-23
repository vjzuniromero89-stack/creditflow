import { api } from "../api.js";
import { icon } from "../icons.js";
import { escapeHtml } from "../utils.js";

const DAY = 86400000;
const WAIT_DAYS = 30;

function daysSince(value) {
  if (!value) return null;
  const t = new Date(value).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / DAY));
}

function scrollToId(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function docMap(documents) {
  return Object.fromEntries((documents || []).map((d) => [d.doc_type, d]));
}

function latestMailing(mailings) {
  if (!mailings?.length) return null;
  return [...mailings].sort((a, b) => {
    const aa = new Date(a.delivered_at || a.mailed_at || a.created_at || 0).getTime();
    const bb = new Date(b.delivered_at || b.mailed_at || b.created_at || 0).getTime();
    return bb - aa;
  })[0];
}

function deriveState({ client, documents, items, letters, mailings }) {
  const docs = docMap(documents);
  const missingProfile = [];
  if (!client.full_name) missingProfile.push("nombre");
  if (!client.address) missingProfile.push("dirección");
  if (!client.city) missingProfile.push("ciudad");
  if (!client.state) missingProfile.push("estado");
  if (!client.zip) missingProfile.push("ZIP");
  if (!client.date_of_birth) missingProfile.push("fecha de nacimiento");

  const activeItems = items.filter((x) => x.removed_status !== "eliminado");
  const removedItems = items.filter((x) => x.removed_status === "eliminado");
  const drafts = letters.filter((x) => x.status === "borrador");
  const ready = letters.filter((x) => x.status === "lista");
  const inMail = letters.filter((x) => ["enviada", "en_transito"].includes(x.status));
  const delivered = letters.filter((x) => x.status === "entregada");
  const completed = letters.filter((x) => ["respondida", "completada"].includes(x.status));

  const clientMailings = mailings.filter((m) => String(m.client_id) === String(client.id));
  const latest = latestMailing(clientMailings);
  const waitBase = latest?.delivered_at || latest?.mailed_at || latest?.created_at;
  const waitDays = daysSince(waitBase);
  const daysRemaining = waitDays === null ? null : Math.max(0, WAIT_DAYS - waitDays);

  let key = "ready";
  let title = "Caso listo para continuar";
  let description = "CreditFlow revisó el caso y no encontró bloqueos.";
  let action = "generate";
  let actionLabel = "Analizar estrategia y preparar cartas";

  if (missingProfile.length) {
    key = "profile";
    title = "Completar datos del cliente";
    description = `Faltan ${missingProfile.join(", ")}. Antes de preparar correspondencia conviene completar estos datos.`;
    action = "edit";
    actionLabel = "Completar cliente";
  } else if (!docs.id) {
    key = "identity";
    title = "Subir identificación";
    description = "Falta la identificación del cliente. Súbela y usa la lectura con IA para verificar sus datos.";
    action = "documents";
    actionLabel = "Ir a documentos";
  } else if (!docs.proof_address) {
    key = "proof";
    title = "Subir comprobante de domicilio";
    description = "Falta el comprobante de domicilio que varias cartas necesitan como adjunto.";
    action = "documents";
    actionLabel = "Ir a documentos";
  } else if (!items.length) {
    key = "report";
    title = "Importar reporte de crédito";
    description = "El perfil está listo. El siguiente paso es importar el reporte para detectar negativos, direcciones y scores.";
    action = "report";
    actionLabel = "Subir reporte";
  } else if (drafts.length) {
    key = "review";
    title = `Revisar ${drafts.length} carta${drafts.length === 1 ? "" : "s"} preparada${drafts.length === 1 ? "" : "s"}`;
    description = "La estrategia ya preparó cartas. Revísalas antes de aprobarlas para envío certificado.";
    action = "letters";
    actionLabel = "Revisar cartas";
  } else if (ready.length) {
    key = "mail";
    title = `${ready.length} carta${ready.length === 1 ? "" : "s"} lista${ready.length === 1 ? "" : "s"} para enviar`;
    description = "El lote ya está aprobado. Continúa en Envíos certificados para crear las etiquetas y registrar el tracking.";
    action = "mail";
    actionLabel = "Ir a envíos certificados";
  } else if (inMail.length) {
    key = "tracking";
    title = "Esperando entrega";
    description = `${inMail.length} carta${inMail.length === 1 ? "" : "s"} está${inMail.length === 1 ? "" : "n"} en proceso de envío. CreditFlow debe seguir el tracking antes de escalar.`;
    action = "mail";
    actionLabel = "Ver tracking";
  } else if (delivered.length && daysRemaining !== null && daysRemaining > 0) {
    key = "waiting";
    title = `Esperando respuesta — ${daysRemaining} día${daysRemaining === 1 ? "" : "s"}`;
    description = `La correspondencia ya fue entregada. La próxima revisión automática del caso será al completar ${WAIT_DAYS} días desde el envío/entrega.`;
    action = "mail";
    actionLabel = "Ver envío";
  } else if (delivered.length && daysRemaining === 0 && activeItems.length) {
    key = "new_report";
    title = "Toca revisar un reporte actualizado";
    description = "Ya transcurrió el período de espera. Importa un reporte nuevo para confirmar qué negativos desaparecieron y decidir la siguiente ronda.";
    action = "report";
    actionLabel = "Subir reporte actualizado";
  } else if (activeItems.length) {
    key = "strategy";
    title = "Analizar estrategia";
    description = `${activeItems.length} ítem${activeItems.length === 1 ? "" : "s"} activo${activeItems.length === 1 ? "" : "s"} necesita${activeItems.length === 1 ? "" : "n"} evaluación. CreditFlow decidirá qué carta corresponde a cada buró.`;
    action = "generate";
    actionLabel = "Preparar cartas automáticamente";
  } else if (removedItems.length) {
    key = "success";
    title = `🎉 ${removedItems.length} remoción${removedItems.length === 1 ? "" : "es"} detectada${removedItems.length === 1 ? "" : "s"}`;
    description = "Los ítems eliminados ya pueden alimentar la Ganancia confirmada. No se deben seguir disputando.";
    action = "earnings";
    actionLabel = "Ver ganancias";
  }

  const total = items.length || 1;
  const progress = items.length ? Math.round((removedItems.length / total) * 100) : 0;

  return {
    key, title, description, action, actionLabel,
    missingProfile, docs, activeItems, removedItems, drafts, ready, inMail, delivered,
    completed, latest, waitDays, daysRemaining, progress,
  };
}

function step(label, done, active) {
  return `<div class="case-step ${done ? "done" : ""} ${active ? "active" : ""}">
    <span>${done ? "✓" : ""}</span><small>${escapeHtml(label)}</small>
  </div>`;
}

export async function renderCaseEngine(container, {
  client,
  onEdit,
  onImportReport,
  onGenerateLetters,
}) {
  if (!container || !client) return;
  container.innerHTML = `<div class="case-engine-loading">Analizando caso…</div>`;

  try {
    const [{ documents }, { credit_items: items }, { letters }, { mailings }] = await Promise.all([
      api.get(`/clients/${client.id}/documents`),
      api.get(`/credit-items?client_id=${client.id}`),
      api.get(`/letters?client_id=${client.id}`),
      api.get("/mailings"),
    ]);

    const state = deriveState({
      client,
      documents: documents || [],
      items: items || [],
      letters: letters || [],
      mailings: mailings || [],
    });

    const identityDone = !!state.docs.id && !state.missingProfile.length;
    const reportDone = items.length > 0;
    const strategyDone = letters.length > 0;
    const mailingDone = letters.some((l) => ["enviada","en_transito","entregada","respondida","completada"].includes(l.status));
    const resultsDone = state.removedItems.length > 0;

    container.innerHTML = `
      <section class="case-engine case-state-${state.key}">
        <div class="case-engine-main">
          <div>
            <div class="case-engine-kicker">Motor automático del caso</div>
            <h2>${escapeHtml(state.title)}</h2>
            <p>${escapeHtml(state.description)}</p>
          </div>
          <button class="btn btn-primary case-primary-action" id="case-primary-action">
            ${state.action === "generate" ? icon("spark") : state.action === "report" ? icon("upload") : state.action === "mail" ? icon("send") : icon("bolt")}
            ${escapeHtml(state.actionLabel)}
          </button>
        </div>

        <div class="case-steps">
          ${step("Identidad", identityDone, ["profile","identity","proof"].includes(state.key))}
          ${step("Reporte", reportDone, state.key === "report")}
          ${step("Estrategia", strategyDone, ["strategy","review"].includes(state.key))}
          ${step("Envío", mailingDone, ["mail","tracking","waiting"].includes(state.key))}
          ${step("Resultados", resultsDone, ["new_report","success"].includes(state.key))}
        </div>

        <div class="case-metrics">
          <div><span>Ítems activos</span><strong>${state.activeItems.length}</strong></div>
          <div><span>Removidos</span><strong>${state.removedItems.length}</strong></div>
          <div><span>Borradores</span><strong>${state.drafts.length}</strong></div>
          <div><span>Listos</span><strong>${state.ready.length}</strong></div>
          <div><span>Progreso</span><strong>${state.progress}%</strong></div>
        </div>

        ${
          state.key === "waiting"
            ? `<div class="case-wait-track"><span style="width:${Math.min(100, Math.max(0, ((state.waitDays || 0) / WAIT_DAYS) * 100))}%"></span></div>`
            : ""
        }
      </section>
    `;

    const btn = container.querySelector("#case-primary-action");
    btn?.addEventListener("click", async () => {
      if (state.action === "edit") return onEdit?.();
      if (state.action === "documents") return scrollToId("client-documents");
      if (state.action === "report") return onImportReport?.();
      if (state.action === "letters") return scrollToId("client-letters");
      if (state.action === "mail") return window.__creditflowNavigate("#/envios");
      if (state.action === "earnings") return window.__creditflowNavigate("#/ganancias");
      if (state.action === "generate") {
        btn.disabled = true;
        const old = btn.innerHTML;
        btn.innerHTML = `${icon("spark")} Analizando…`;
        try {
          await onGenerateLetters?.();
        } finally {
          btn.disabled = false;
          btn.innerHTML = old;
        }
      }
    });
  } catch (err) {
    container.innerHTML = `
      <div class="case-engine case-state-error">
        <div class="case-engine-kicker">Motor automático del caso</div>
        <h2>No pude completar el análisis</h2>
        <p>${escapeHtml(err.message || "Error desconocido")}</p>
      </div>`;
  }
}
