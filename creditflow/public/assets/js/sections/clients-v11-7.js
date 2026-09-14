import { renderClientsList as renderListV10, renderClientDetail as renderDetailV10 } from "./clients-v9-1.js";
import { renderCaseIntelligenceV10 } from "./case-intelligence-v10.js";
import { api } from "../api.js";
import { renderRealAuditV117 } from "./audit-v11-7.js";
import { renderStrategyIntelligenceV122 } from "./strategy-intelligence-v12-2.js";
import { applyWorkflowGuardV124 } from "./workflow-guard-v12-4.js";
import { installAggressiveComplianceTab } from "./aggressive-compliance-v13.js";

export async function renderClientsList(container){await renderListV10(container)}
export async function renderClientDetail(container,id){
 await renderDetailV10(container,id);
 await installAggressiveComplianceTab(container,id);
 const strategyPanel=container.querySelector('[data-panel="estrategia"]');
 if(strategyPanel&&!strategyPanel.querySelector("#cf122-intelligence")){
   const host=document.createElement("div");host.id="cf122-intelligence";
   strategyPanel.insertAdjacentElement("afterbegin",host);await renderStrategyIntelligenceV122(host,id);
 }
 const history=container.querySelector('[data-panel="historial"]');
 if(history&&!history.querySelector("#cf10-intelligence")){
   const old=[...history.children];history.innerHTML=`<div id="cf10-intelligence"></div><div id="cf10-old-history"></div>`;
   old.forEach(n=>history.querySelector("#cf10-old-history").appendChild(n));
   await renderCaseIntelligenceV10(history.querySelector("#cf10-intelligence"),id);
 }
 let rs=null;try{rs=await api.get(`/repair-cases/${id}`)}catch{}
 let stage=rs?.case?.current_stage;
 const workflow=container.querySelector("#cf8-repair-workflow");
 if(!workflow){await applyWorkflowGuardV124(container,id);return}
 let strategy=null;try{strategy=await api.get(`/strategy/client/${id}`)}catch{}
 const active=(strategy?.items||[]).filter(x=>x.removed_status!=="eliminado");
 const total=active.length;
 // v12.6: automated audit is a valid completed audit. Never reopen a 21/21 auto-audited case.
 const assessed=active.filter(x=>x.assessment?.human_verified||x.assessment?.auto_ready).length;
 if(["strategy_ready","approval_required"].includes(stage)&&total>0&&assessed<total){
   try{await api.post(`/audit-v11-7/${id}/reopen`);rs=await api.get(`/repair-cases/${id}`);stage=rs?.case?.current_stage}catch{}
 }
 if(stage==="report_audit"&&assessed<total){
   workflow.classList.add("cf117-audit-mode");
   const grid=workflow.querySelector(".cf8-workflow-grid");let host=workflow.querySelector("#cf117-audit-host");
   if(!host){host=document.createElement("div");host.id="cf117-audit-host";grid?grid.insertAdjacentElement("beforebegin",host):workflow.appendChild(host)}
   if(grid)grid.hidden=true;
   await renderRealAuditV117(host,id,{onComplete:async()=>renderClientDetail(container,id)});
 }else{
   workflow.classList.remove("cf117-audit-mode");
   const grid=workflow.querySelector(".cf8-workflow-grid");if(grid)grid.hidden=false;
 }
 await applyWorkflowGuardV124(container,id);
}
