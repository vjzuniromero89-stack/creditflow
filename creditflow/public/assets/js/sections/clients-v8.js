import {
  renderClientsList as renderClientsListV7,
  renderClientDetail as renderClientDetailV7,
} from "./clients-v7.js";
import { renderRepairWorkflowV8 } from "./repair-workflow-v8.js";

export async function renderClientsList(container) {
  await renderClientsListV7(container);
}

export async function renderClientDetail(container, id) {
  await renderClientDetailV7(container, id);

  // El workflow v8 reemplaza el case-engine antiguo para que exista una sola
  // fuente de verdad sobre "qué toca hacer ahora".
  document.getElementById("client-case-engine")?.remove();

  const hero = container.querySelector(".cf7-client-hero");
  const overview = container.querySelector('[data-panel="resumen"]');
  const tabs = container.querySelector(".cf7-client-tabs");
  const panels = container.querySelector(".cf7-client-panels");

  const workflow = document.createElement("div");
  workflow.id = "cf8-repair-workflow";
  if (overview) overview.prepend(workflow);

  function openTab(key) {
    tabs?.querySelectorAll("[data-tab]").forEach((b)=>b.classList.toggle("active", b.dataset.tab===key));
    panels?.querySelectorAll(".cf7-client-panel").forEach((p)=>p.classList.toggle("active",p.dataset.panel===key));
  }

  await renderRepairWorkflowV8(workflow, id, {
    openTab,
    onChanged: async () => {
      const state = await fetch(`/api/repair-cases/${id}`, { credentials:"same-origin" }).then(r=>r.json()).catch(()=>null);
      const old = hero?.querySelector(".cf8-hero-repair-btn");
      if (old && state?.case) {
        old.textContent = state.case.current_stage === "completed" ? "Reparación completada" : "Continuar reparación";
      }
    },
  });

  if (hero) {
    const identity = hero.querySelector(".cf7-client-identity");
    const state = await fetch(`/api/repair-cases/${id}`, { credentials:"same-origin" }).then(r=>r.json()).catch(()=>null);
    const btn = document.createElement("button");
    btn.className = "btn btn-primary cf8-hero-repair-btn";
    btn.innerHTML = state?.case ? "Continuar reparación" : "Empezar reparación";
    btn.addEventListener("click",()=>{
      openTab("resumen");
      workflow.scrollIntoView({behavior:"smooth",block:"start"});
    });
    identity?.insertAdjacentElement("afterend",btn);
  }
}
