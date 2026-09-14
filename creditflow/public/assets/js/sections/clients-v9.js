import {
  renderClientsList as renderClientsListV8,
  renderClientDetail as renderClientDetailV8,
} from "./clients-v8.js";
import { renderProfessionalStrategyV9 } from "./strategy-v9.js";

export async function renderClientsList(container){
  await renderClientsListV8(container);
}

export async function renderClientDetail(container,id){
  await renderClientDetailV8(container,id);
  const strategyPanel=container.querySelector('[data-panel="estrategia"]');
  if(strategyPanel){
    strategyPanel.innerHTML=`<div id="cf9-professional-strategy"></div>`;
    await renderProfessionalStrategyV9(strategyPanel.querySelector("#cf9-professional-strategy"),id);
  }
}
