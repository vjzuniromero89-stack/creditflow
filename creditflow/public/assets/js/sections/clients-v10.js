import { renderClientsList as renderListV91, renderClientDetail as renderDetailV91 } from "./clients-v9-1.js";
import { renderCaseIntelligenceV10 } from "./case-intelligence-v10.js";
export async function renderClientsList(container){await renderListV91(container)}
export async function renderClientDetail(container,id){
 await renderDetailV91(container,id);
 const history=container.querySelector('[data-panel="historial"]');
 if(history){
  const old=[...history.children];
  history.innerHTML=`<div id="cf10-intelligence"></div><div id="cf10-old-history"></div>`;
  old.forEach(n=>history.querySelector("#cf10-old-history").appendChild(n));
  await renderCaseIntelligenceV10(history.querySelector("#cf10-intelligence"),id);
 }
}