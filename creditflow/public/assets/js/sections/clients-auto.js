import { api } from "../api.js";
import {
  renderClientsList as renderClientsListBase,
  renderClientDetail as renderClientDetailBase,
} from "./clients.js";
import { renderCaseEngine } from "./case-engine.js";
import { runSmartGenerateForClient } from "./collections.js";

function makeSection(title, subtitle, className = "") {
  const section = document.createElement("section");
  section.className = `cf5-section ${className}`.trim();
  section.innerHTML = `
    <div class="cf5-section-title">
      <div>
        <h2>${title}</h2>
        ${subtitle ? `<p>${subtitle}</p>` : ""}
      </div>
    </div>
    <div class="cf5-section-body"></div>
  `;
  return section;
}

function findHeading(container, text) {
  return [...container.querySelectorAll(".section-head")].find((el) =>
    (el.querySelector("h2")?.textContent || "").trim().toLowerCase() === text.toLowerCase()
  );
}

function organizeClientDetail(container) {
  container.classList.add("cf5-client-detail");

  const firstGrid = container.querySelector(":scope > .grid.grid-2");
  if (firstGrid) {
    firstGrid.classList.add("cf5-client-overview");
    const cards = firstGrid.querySelectorAll(":scope > .card");
    cards[0]?.classList.add("cf5-profile-card");
    cards[1]?.classList.add("cf5-activity-card");
  }

  const directCards = [...container.querySelectorAll(":scope > .card")];
  const portalCard = directCards.find((c) => c.textContent.includes("Acceso al portal del cliente"));
  const freezeCard = directCards.find((c) => c.textContent.includes("Congelamiento de identidad"));

  if (portalCard || freezeCard) {
    const adminSection = makeSection(
      "Identidad y acceso",
      "Información sensible, portal del cliente y controles de identidad.",
      "cf5-admin-section"
    );
    const body = adminSection.querySelector(".cf5-section-body");
    body.classList.add("cf5-admin-grid");
    if (portalCard) {
      portalCard.classList.add("cf5-portal-card");
      body.appendChild(portalCard);
    }
    if (freezeCard) {
      freezeCard.classList.add("cf5-freeze-card");
      body.appendChild(freezeCard);
    }
    const anchor = firstGrid?.nextSibling;
    container.insertBefore(adminSection, anchor);
  }

  const configs = [
    {
      heading: "Credit score",
      cls: "cf5-score-section",
      subtitle: "Evolución del crédito por buró y registros importados.",
      contentIds: ["client-credit-score"],
    },
    {
      heading: "Documentos",
      cls: "cf5-docs-section",
      subtitle: "Identificación y documentos que acompañan las disputas.",
      contentIds: ["client-documents"],
    },
    {
      heading: "Colecciones",
      cls: "cf5-items-section",
      subtitle: "Negativos detectados, ganancias y estrategia automática.",
      contentIds: ["client-earnings", "client-credit-items"],
    },
    {
      heading: "Direcciones",
      cls: "cf5-address-section",
      subtitle: "Historial de direcciones reportadas por los burós.",
      contentIds: ["client-addresses"],
    },
    {
      heading: "Cartas",
      cls: "cf5-letters-section",
      subtitle: "Correspondencia preparada y estado de cada disputa.",
      contentIds: ["client-letters"],
    },
  ];

  configs.forEach((cfg) => {
    const head = findHeading(container, cfg.heading);
    if (!head) return;

    const section = document.createElement("section");
    section.className = `cf5-section ${cfg.cls}`;
    const body = document.createElement("div");
    body.className = "cf5-section-body";

    head.classList.add("cf5-original-head");
    section.appendChild(head);

    // Move explanatory paragraph immediately following the old heading.
    const next = head.nextElementSibling;
    if (next?.tagName === "P") {
      next.classList.add("cf5-section-description");
      section.appendChild(next);
    }

    cfg.contentIds.forEach((id) => {
      const el = document.getElementById(id);
      if (el) body.appendChild(el);
    });

    // Cartas is already wrapped by a table-wrap in the original markup.
    if (cfg.heading === "Cartas") {
      const letters = document.getElementById("client-letters");
      const wrap = letters?.closest(".table-wrap");
      if (wrap && wrap.parentElement !== body) body.appendChild(wrap);
    }

    section.appendChild(body);
    container.appendChild(section);
  });

  // Keep the case engine as the first actionable element.
  const caseEngine = document.getElementById("client-case-engine");
  if (caseEngine) container.prepend(caseEngine);
}

function organizeClientList(container) {
  container.classList.add("cf5-clients-list");
  const head = container.querySelector(".section-head");
  const table = container.querySelector(".table-wrap");
  if (head) head.classList.add("cf5-list-toolbar");
  if (table) table.classList.add("cf5-main-table");
}

export async function renderClientsList(container) {
  await renderClientsListBase(container);
  organizeClientList(container);
}

export async function renderClientDetail(container, id) {
  await renderClientDetailBase(container, id);

  let holder = document.getElementById("client-case-engine");
  if (!holder) {
    holder = document.createElement("div");
    holder.id = "client-case-engine";
    container.prepend(holder);
  }

  const { client } = await api.get(`/clients/${id}`);

  await renderCaseEngine(holder, {
    client,
    onEdit: () => document.getElementById("edit-client")?.click(),
    onImportReport: () => document.getElementById("import-report-input")?.click(),
    onGenerateLetters: async () => {
      await runSmartGenerateForClient(id, () => {});
      await renderClientDetail(container, id);
    },
  });

  organizeClientDetail(container);
}
