import { api } from "../api.js";
import {
  renderClientsList as renderClientsListBase,
  renderClientDetail as renderClientDetailBase,
} from "./clients.js";
import { renderCaseEngine } from "./case-engine.js";
import {
  renderProfessionalStrategyPanel,
  runProfessionalStrategyForClient,
} from "./strategy-engine-v2.js";

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
      "Identidad, seguridad y acceso",
      "Portal del cliente y controles de seguridad. Los freezes se usan para protección contra fraude, no como táctica para impedir verificaciones.",
      "cf5-admin-section"
    );
    const body = adminSection.querySelector(".cf5-section-body");
    body.classList.add("cf5-admin-grid");
    if (portalCard) { portalCard.classList.add("cf5-portal-card"); body.appendChild(portalCard); }
    if (freezeCard) {
      freezeCard.classList.add("cf5-freeze-card");
      const p = freezeCard.querySelector("p");
      if (p) p.textContent = "Usa estos controles cuando el cliente necesite protección contra fraude, identity theft o nuevas cuentas no autorizadas. Un security freeze no debe usarse como técnica para obstaculizar la investigación de una disputa.";
      body.appendChild(freezeCard);
    }
    const anchor = firstGrid?.nextSibling;
    container.insertBefore(adminSection, anchor);
  }

  const configs = [
    { heading:"Credit score", cls:"cf5-score-section", contentIds:["client-credit-score"] },
    { heading:"Documentos", cls:"cf5-docs-section", contentIds:["client-documents"] },
    { heading:"Colecciones", cls:"cf5-items-section", contentIds:["client-earnings","client-credit-items"] },
    { heading:"Direcciones", cls:"cf5-address-section", contentIds:["client-addresses"] },
    { heading:"Cartas", cls:"cf5-letters-section", contentIds:["client-letters"] },
  ];

  configs.forEach((cfg)=>{
    const head=findHeading(container,cfg.heading);
    if(!head) return;
    const section=document.createElement("section");
    section.className=`cf5-section ${cfg.cls}`;
    const body=document.createElement("div");
    body.className="cf5-section-body";
    head.classList.add("cf5-original-head");
    section.appendChild(head);
    const next=head.nextElementSibling;
    if(next?.tagName==="P"){ next.classList.add("cf5-section-description"); section.appendChild(next); }
    cfg.contentIds.forEach((id)=>{ const el=document.getElementById(id); if(el) body.appendChild(el); });
    if(cfg.heading==="Cartas"){
      const letters=document.getElementById("client-letters");
      const wrap=letters?.closest(".table-wrap");
      if(wrap && wrap.parentElement!==body) body.appendChild(wrap);
    }
    section.appendChild(body);
    container.appendChild(section);
  });

  const caseEngine=document.getElementById("client-case-engine");
  if(caseEngine) container.prepend(caseEngine);
}

function organizeClientList(container) {
  container.classList.add("cf5-clients-list");
  container.querySelector(".section-head")?.classList.add("cf5-list-toolbar");
  container.querySelector(".table-wrap")?.classList.add("cf5-main-table");
}

function replaceOldBulkButton(container,id) {
  const old=document.getElementById("bulk-gen-btn");
  if(!old) return;
  const btn=old.cloneNode(true);
  btn.id="bulk-gen-btn";
  btn.innerHTML="✦ Analizar y preparar estrategia profesional";
  old.replaceWith(btn);
  btn.addEventListener("click",async()=>{
    btn.disabled=true;
    const original=btn.innerHTML;
    btn.textContent="Analizando…";
    try {
      await runProfessionalStrategyForClient(id,async()=>{
        await renderClientDetail(container,id);
      });
    } finally {
      btn.disabled=false;
      btn.innerHTML=original;
    }
  });
}

export async function renderClientsList(container) {
  await renderClientsListBase(container);
  organizeClientList(container);
}

export async function renderClientDetail(container,id) {
  await renderClientDetailBase(container,id);

  let holder=document.getElementById("client-case-engine");
  if(!holder){ holder=document.createElement("div"); holder.id="client-case-engine"; container.prepend(holder); }

  const {client}=await api.get(`/clients/${id}`);

  await renderCaseEngine(holder,{
    client,
    onEdit:()=>document.getElementById("edit-client")?.click(),
    onImportReport:()=>document.getElementById("import-report-input")?.click(),
    onGenerateLetters:async()=>{
      await runProfessionalStrategyForClient(id,async()=>renderClientDetail(container,id));
    },
  });

  organizeClientDetail(container);
  replaceOldBulkButton(container,id);

  let strategy=document.getElementById("professional-strategy-panel");
  if(!strategy){
    strategy=document.createElement("div");
    strategy.id="professional-strategy-panel";
    const caseHolder=document.getElementById("client-case-engine");
    caseHolder?.insertAdjacentElement("afterend",strategy);
  }
  await renderProfessionalStrategyPanel(strategy,id);
}
