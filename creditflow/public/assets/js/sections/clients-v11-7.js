import { renderClientsList as renderListV10, renderClientDetail as renderDetailV10 } from "./clients-v9-1.js";
import { renderCaseIntelligenceV10 } from "./case-intelligence-v10.js";
import { renderStrategyIntelligenceV122 } from "./strategy-intelligence-v12-2.js";
import { applyWorkflowGuardV124 } from "./workflow-guard-v12-4.js";

export async function renderClientsList(container){await renderListV10(container)}

export async function renderClientDetail(container,id){
  await renderDetailV10(container,id);

  // v13.5: Aggressive Compliance tab removed.
  // v13.5: Audit screen removed from the active workflow.
  const strategyPanel=container.querySelector('[data-panel="estrategia"]');
  if(strategyPanel&&!strategyPanel.querySelector("#cf122-intelligence")){
    const host=document.createElement("div");host.id="cf122-intelligence";
    strategyPanel.insertAdjacentElement("afterbegin",host);
    await renderStrategyIntelligenceV122(host,id);
  }

  const history=container.querySelector('[data-panel="historial"]');
  if(history&&!history.querySelector("#cf10-intelligence")){
    const old=[...history.children];
    history.innerHTML=`<div id="cf10-intelligence"></div><div id="cf10-old-history"></div>`;
    old.forEach(n=>history.querySelector("#cf10-old-history").appendChild(n));
    await renderCaseIntelligenceV10(history.querySelector("#cf10-intelligence"),id);
  }

  await applyWorkflowGuardV124(container,id);
}
