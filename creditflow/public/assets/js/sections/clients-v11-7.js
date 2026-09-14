import { renderClientsList as renderListV10, renderClientDetail as renderDetailV10 } from "./clients-v9-1.js";
import { renderCaseIntelligenceV10 } from "./case-intelligence-v10.js";
import { api } from "../api.js";
import { renderRealAuditV117 } from "./audit-v11-7.js";

export async function renderClientsList(container){await renderListV10(container)}

export async function renderClientDetail(container,id){
 await renderDetailV10(container,id);

 const history=container.querySelector('[data-panel="historial"]');
 if(history&&!history.querySelector("#cf10-intelligence")){
   const old=[...history.children];
   history.innerHTML=`<div id="cf10-intelligence"></div><div id="cf10-old-history"></div>`;
   old.forEach(n=>history.querySelector("#cf10-old-history").appendChild(n));
   await renderCaseIntelligenceV10(history.querySelector("#cf10-intelligence"),id);
 }

 let rs=null; try{rs=await api.get(`/repair-cases/${id}`)}catch{}
 let stage=rs?.case?.current_stage;
 const workflow=container.querySelector("#cf8-repair-workflow");
 if(!workflow)return;

 let strategy=null; try{strategy=await api.get(`/strategy/client/${id}`)}catch{}
 const active=(strategy?.items||[]).filter(x=>x.removed_status!=="eliminado");
 const total=active.length;
 const assessed=active.filter(x=>x.assessment?.human_verified).length;

 if(["strategy_ready","approval_required"].includes(stage)&&total>0&&assessed<total){
   try{
     await api.post(`/audit-v11-7/${id}/reopen`);
     rs=await api.get(`/repair-cases/${id}`);
     stage=rs?.case?.current_stage;
   }catch{}
 }

 if(stage==="report_audit"){
   workflow.classList.add("cf117-audit-mode");

   // Critical v11.7.1 fix:
   // put the real audit BEFORE the legacy workflow grid instead of appending
   // it after the entire workflow where it could be clipped/hidden.
   const grid=workflow.querySelector(".cf8-workflow-grid");
   let host=workflow.querySelector("#cf117-audit-host");
   if(!host){
     host=document.createElement("div");
     host.id="cf117-audit-host";
     if(grid) grid.insertAdjacentElement("beforebegin",host);
     else workflow.appendChild(host);
   }

   // The old "Confirmar auditoría" panel is intentionally hidden while
   // real item-by-item audit is active.
   if(grid) grid.hidden=true;

   await renderRealAuditV117(host,id,{
     onComplete:async()=>renderClientDetail(container,id)
   });

   host.scrollIntoView({behavior:"smooth",block:"start"});
 }else{
   workflow.classList.remove("cf117-audit-mode");
 }
}
