import { api } from "../api.js";
import { escapeHtml, formatDate, initials } from "../utils.js";
import { icon } from "../icons.js";
import {
  renderClientsList as renderClientsListBase,
  renderClientDetail as renderClientDetailBase,
} from "./clients.js";
import { renderCaseEngine } from "./case-engine.js";
import { runSmartGenerateForClient } from "./collections.js";
import { renderClientCreditItemsV7 } from "./collections-v7.js";
import { renderClientHistoryV7 } from "./history-v7.js";

function detach(el) {
  if (el?.parentElement) el.parentElement.removeChild(el);
  return el;
}

function findHead(container, title) {
  return [...container.querySelectorAll(".section-head")].find(
    (h) => (h.querySelector("h2")?.textContent || "").trim().toLowerCase() === title.toLowerCase()
  );
}

function takeSection(container, title, contentIds = []) {
  const head = findHead(container, title);
  if (!head) return [];
  const nodes = [detach(head)];
  const maybeP = head.nextElementSibling;
  if (maybeP?.tagName === "P") nodes.push(detach(maybeP));
  contentIds.forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      if (id === "client-letters") {
        const wrap = el.closest(".table-wrap");
        nodes.push(detach(wrap || el));
      } else {
        nodes.push(detach(el));
      }
    }
  });
  return nodes.filter(Boolean);
}

function panel(id, label) {
  const el = document.createElement("section");
  el.className = "cf7-client-panel";
  el.dataset.panel = id;
  el.setAttribute("aria-label", label);
  return el;
}

function appendNodes(target, nodes) {
  nodes.forEach((n) => n && target.appendChild(n));
}

async function clientCounts(id) {
  const [
    { credit_items = [] },
    { letters = [] },
    removalResult,
  ] = await Promise.all([
    api.get(`/credit-items?client_id=${id}`),
    api.get(`/letters?client_id=${id}`),
    api.get(`/removal-events?client_id=${id}`).catch(() => ({ events: [] })),
  ]);
  const removals = removalResult.events || [];
  return {
    creditItems: credit_items,
    letters,
    removals,
    active: credit_items.filter((x) => x.removed_status !== "eliminado").length,
    removed: credit_items.filter((x) => x.removed_status === "eliminado").length,
    owed: removals.filter((x) => x.billing_status !== "pagado").reduce((s,x)=>s+Number(x.amount||0),0),
    lettersActive: letters.filter((x)=>!["completada","entregada"].includes(x.status)).length,
  };
}

export async function renderClientsList(container) {
  await renderClientsListBase(container);
  container.classList.add("cf7-clients-page");

  const { clients = [] } = await api.get("/clients");
  const active = clients.filter((c)=>c.status==="activo").length;
  const paused = clients.filter((c)=>c.status==="pausado").length;
  const completed = clients.filter((c)=>c.status==="completado").length;

  const summary = document.createElement("section");
  summary.className = "cf7-list-kpis";
  summary.innerHTML = `
    <button data-status-jump=""><span>${clients.length}</span><strong>Total clientes</strong><small>todos los expedientes</small></button>
    <button data-status-jump="activo"><span>${active}</span><strong>Activos</strong><small>en proceso</small></button>
    <button data-status-jump="pausado"><span>${paused}</span><strong>Pausados</strong><small>requieren revisión</small></button>
    <button data-status-jump="completado"><span>${completed}</span><strong>Completados</strong><small>casos cerrados</small></button>
  `;
  container.prepend(summary);

  summary.querySelectorAll("[data-status-jump]").forEach((b)=>{
    b.addEventListener("click",()=>{
      const value=b.dataset.statusJump;
      const target=[...container.querySelectorAll("#status-filters .pill-filter")]
        .find((x)=>x.dataset.status===value);
      target?.click();
    });
  });

  const table = container.querySelector(".table-wrap");
  table?.classList.add("cf7-clients-table");
  container.querySelector(".section-head")?.classList.add("cf7-toolbar");
}

export async function renderClientDetail(container, id) {
  await renderClientDetailBase(container, id);

  const [{ client }, counts] = await Promise.all([
    api.get(`/clients/${id}`),
    clientCounts(id),
  ]);

  // Capture existing working components before rebuilding the layout.
  const profileGrid = detach(container.querySelector(":scope > .grid.grid-2"));
  const directCards = [...container.querySelectorAll(":scope > .card")];
  const portalCard = detach(directCards.find((c)=>c.textContent.includes("Acceso al portal del cliente")));
  const freezeCard = detach(directCards.find((c)=>c.textContent.includes("Congelamiento de identidad")));

  const scoreNodes = takeSection(container, "Credit score", ["client-credit-score"]);
  const docsNodes = takeSection(container, "Documentos", ["client-documents"]);
  const negativeNodes = takeSection(container, "Colecciones", ["client-earnings", "client-credit-items"]);
  const addressNodes = takeSection(container, "Direcciones", ["client-addresses"]);
  const letterNodes = takeSection(container, "Cartas", ["client-letters"]);

  container.innerHTML = "";
  container.className += " cf7-client-workspace";

  const hero = document.createElement("section");
  hero.className = "cf7-client-hero";
  hero.innerHTML = `
    <div class="cf7-client-identity">
      <div class="user-avatar cf7-client-avatar">${initials(client.full_name)}</div>
      <div>
        <div class="cf7-client-kicker">Expediente #${client.id}</div>
        <h2>${escapeHtml(client.full_name)}</h2>
        <div class="cf7-client-meta">
          <span class="badge badge-${client.status}">${escapeHtml(client.status)}</span>
          <span>${escapeHtml(client.phone || "Sin teléfono")}</span>
          <span>${escapeHtml(client.email || "Sin email")}</span>
        </div>
      </div>
    </div>
    <div class="cf7-client-hero-stats">
      <div><span>${counts.active}</span><strong>En reporte</strong></div>
      <div><span>${counts.removed}</span><strong>Removidos</strong></div>
      <div><span>$${counts.owed.toFixed(2)}</span><strong>Por cobrar</strong></div>
      <div><span>${counts.lettersActive}</span><strong>Cartas activas</strong></div>
    </div>
  `;
  container.appendChild(hero);

  const nav = document.createElement("nav");
  nav.className = "cf7-client-tabs";
  const tabs = [
    ["resumen","Resumen"],
    ["reporte","Reporte"],
    ["negativos","Negativos"],
    ["estrategia","Estrategia"],
    ["documentos","Documentos"],
    ["cartas","Cartas"],
    ["historial","Historial y cobros"],
    ["seguridad","Seguridad"],
  ];
  nav.innerHTML = tabs.map(([k,l],i)=>`
    <button class="${i===0?"active":""}" data-tab="${k}">${l}</button>
  `).join("");
  container.appendChild(nav);

  const panels = document.createElement("div");
  panels.className = "cf7-client-panels";

  const overview = panel("resumen","Resumen");
  overview.classList.add("active");
  if (profileGrid) {
    profileGrid.classList.add("cf7-overview-grid");
    overview.appendChild(profileGrid);
  }
  const next = document.createElement("div");
  next.id = "client-case-engine";
  overview.prepend(next);

  const report = panel("reporte","Reporte");
  appendNodes(report, scoreNodes);
  appendNodes(report, addressNodes);

  const negatives = panel("negativos","Negativos");
  appendNodes(negatives, negativeNodes);
  const itemsBox = negatives.querySelector("#client-credit-items");
  const earningsBox = negatives.querySelector("#client-earnings");
  if (itemsBox) await renderClientCreditItemsV7(itemsBox, id, earningsBox);

  const strategy = panel("estrategia","Estrategia");
  strategy.innerHTML = `
    <div class="cf7-strategy-intro card">
      <div>
        <div class="cf7-eyebrow">Case strategy</div>
        <h3>La estrategia debe seguir el resultado, no una ronda automática.</h3>
        <p>Revisa información personal, evidencia, negativos, cartas ya enviadas y el resultado del último reporte antes de generar el siguiente paso.</p>
      </div>
      <button class="btn btn-primary" id="cf7-run-strategy">${icon("spark")} Analizar y preparar siguiente paso</button>
    </div>
    <div class="cf7-strategy-flow">
      <div><span>1</span><strong>Identidad</strong><small>corregir datos incorrectos</small></div>
      <div><span>2</span><strong>Auditoría</strong><small>errores concretos por cuenta</small></div>
      <div><span>3</span><strong>Disputa</strong><small>carta específica + evidencia</small></div>
      <div><span>4</span><strong>Respuesta</strong><small>esperar y clasificar resultado</small></div>
      <div><span>5</span><strong>Follow-up</strong><small>solo si existe nueva base</small></div>
      <div><span>6</span><strong>Resultado</strong><small>remoción, corrección o escalación</small></div>
    </div>
  `;

  const documents = panel("documentos","Documentos");
  appendNodes(documents, docsNodes);

  const letters = panel("cartas","Cartas");
  appendNodes(letters, letterNodes);

  const history = panel("historial","Historial y cobros");
  history.innerHTML = `<div id="cf7-client-history"></div>`;
  await renderClientHistoryV7(history.querySelector("#cf7-client-history"), id);

  const security = panel("seguridad","Seguridad");
  security.innerHTML = `
    <div class="cf7-security-note">
      <strong>Protección de identidad</strong>
      <p>Los freezes se usan para prevenir fraude o nuevas cuentas no autorizadas. No deben usarse como técnica para obstaculizar una investigación de crédito.</p>
    </div>
    <div class="cf7-security-grid"></div>
  `;
  const secGrid = security.querySelector(".cf7-security-grid");
  if (portalCard) secGrid.appendChild(portalCard);
  if (freezeCard) secGrid.appendChild(freezeCard);

  [overview,report,negatives,strategy,documents,letters,history,security].forEach((p)=>panels.appendChild(p));
  container.appendChild(panels);

  await renderCaseEngine(next, {
    client,
    onEdit: () => document.getElementById("edit-client")?.click(),
    onImportReport: () => document.getElementById("import-report-input")?.click(),
    onGenerateLetters: async () => {
      await runSmartGenerateForClient(id, () => {});
      await renderClientDetail(container, id);
    },
  });

  strategy.querySelector("#cf7-run-strategy")?.addEventListener("click", async (e)=>{
    const btn=e.currentTarget;
    btn.disabled=true;
    const old=btn.innerHTML;
    btn.textContent="Analizando…";
    await runSmartGenerateForClient(id,()=>{});
    btn.disabled=false;
    btn.innerHTML=old;
  });

  nav.querySelectorAll("[data-tab]").forEach((btn)=>{
    btn.addEventListener("click", async ()=>{
      nav.querySelectorAll("button").forEach((x)=>x.classList.remove("active"));
      btn.classList.add("active");
      panels.querySelectorAll(".cf7-client-panel").forEach((p)=>p.classList.toggle("active",p.dataset.panel===btn.dataset.tab));
      if (btn.dataset.tab==="historial") {
        await renderClientHistoryV7(history.querySelector("#cf7-client-history"), id);
      }
      if (btn.dataset.tab==="negativos" && itemsBox) {
        await renderClientCreditItemsV7(itemsBox, id, earningsBox);
      }
    });
  });
}
